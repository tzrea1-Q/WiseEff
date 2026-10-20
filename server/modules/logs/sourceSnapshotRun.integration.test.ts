import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { createRuleBasedLogAnalyzer, type AnalyzeLogInput } from "./analyzer";
import { createLogSkill, publishLogSkill, saveLogSkillDraft } from "./skillsService";
import { createLocalObjectStore } from "./objectStore";
import JSZip from "jszip";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { processNextSourceIndexJob } from "./sourceIndexWorker";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createDeterministicLogAnalysisLoopModel } from "./analyzer/deterministicModel";
import { createWorkerLogAnalysisToolBackends } from "./analyzer/tools/workerToolBackends";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";

const available = await isTestDatabaseAvailable();

describe.skipIf(!available)("pinned source snapshot run over PostgreSQL", () => {
  it("selects upload versions within the pinned skill and organization, retaining fallback provenance", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourceversions");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const organizationId = "source-version-org";
    const auth = makeTestAuthContext({ organizationId, userId: "version-admin", roles: [{ roleId: "admin", projectId: null }],
      permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    try {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: "version-admin" }] });
      await seedCoreGraph(db, { organization: { id: "version-other" }, users: [{ id: "version-other-admin" }] });
      const invocation = createUserInvocation(auth), context = { requestId: "source-version-run" };
      const skill = await createLogSkill(db, auth, { name: "Version selection" }, invocation, context);
      const sibling = await createLogSkill(db, auth, { name: "Sibling skill" }, invocation, context);
      const otherAuth = makeTestAuthContext({ organizationId: "version-other", userId: "version-other-admin",
        roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:admin-domains"] });
      const other = await createLogSkill(db, otherAuth, { name: "Other organization" }, createUserInvocation(otherAuth), context);
      for (const [id, org, skillId, label, status] of [
        ["version-default", organizationId, skill.id, "default-v1", "ready"],
        ["version-match", organizationId, skill.id, "release-v2", "ready"],
        ["version-pending", organizationId, skill.id, "release-v3", "indexing"],
        ["version-other-match", "version-other", other.id, "release-v2", "ready"],
        ["version-other-only", "version-other", other.id, "other-only", "ready"],
        ["version-sibling-only", organizationId, sibling.id, "sibling-only", "ready"]
      ]) await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,status,storage_key,file_name)
        values($1,$2,$3,$4,$5,'unused/source.zip','source.zip')`, [id, org, skillId, label, status]);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", defaultSourceSnapshotId: "version-default" },
        null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const server = createHttpServer(router);
      for (const [sourceVersion, expectedId, selection, expectedStatus] of [
        ["release-v2", "version-match", "matched_version", "ready"],
        ["unknown", "version-default", "default", "ready"],
        [undefined, "version-default", "default", "ready"],
        ["other-only", "version-default", "default", "ready"],
        ["sibling-only", "version-default", "default", "ready"],
        ["release-v3", "version-pending", "matched_version", "indexing"]
      ] as const) {
        const upload = await requestJson<{ log: { id: string }; job: { id: string; runId: string } }>(server, "/api/v1/log-files", {
          method: "POST", body: JSON.stringify({ fileName: "run.log", contentType: "text/plain", skillId: skill.id,
            sourceVersion, contentBase64: Buffer.from("INFO ordinary operation\n").toString("base64") })
        });
        expect(upload.status).toBe(201);
        let observed: AnalyzeLogInput["sourceSnapshot"];
        let originalConclusion = "";
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: upload.body.job.id, analyzer: {
          async analyze(input) {
            observed = input.sourceSnapshot;
            const result = await createRuleBasedLogAnalyzer().analyze(input);
            originalConclusion = result.conclusion;
            return result;
          }
        } })).toEqual({ status: "processed" });
        expect(observed).toEqual({ id: expectedId, status: expectedStatus,
          versionLabel: expectedId === "version-match" ? "release-v2" : expectedId === "version-pending" ? "release-v3" : "default-v1" });
        const report = await requestJson<{ item: Record<string, unknown> }>(server, `/api/v1/logs/${upload.body.log.id}`);
        expect(report.status).toBe(200);
        expect(report.body.item).toMatchObject({ sourceSnapshot: observed, sourceSnapshotSelection: selection,
          ...(sourceVersion ? { requestedSourceVersion: sourceVersion } : {}) });
        const conclusion = String(report.body.item.conclusion);
        expect(conclusion).not.toContain("未找到请求版本");
        if (expectedStatus === "ready") expect(conclusion).toBe(originalConclusion);
        expect((await db.query<{ conclusion: string }>(`select conclusion from log_analysis_reports where run_id=$1`,
          [upload.body.job.runId])).rows).toEqual([{ conclusion }]);
        const runs = await requestJson<{ items: Array<{ sourceSnapshot: unknown }> }>(server, `/api/v1/logs/${upload.body.log.id}/runs`);
        expect(runs.body.items[0].sourceSnapshot).toEqual(observed);
        expect(conclusion.includes("仍在索引")).toBe(expectedStatus === "indexing");
        expect((await db.query(`select source_snapshot_id, source_snapshot_selection, requested_source_version
          from log_analysis_runs where id=$1`, [upload.body.job.runId])).rows).toEqual([{
          source_snapshot_id: expectedId, source_snapshot_selection: selection, requested_source_version: sourceVersion ?? null
        }]);
      }
      const upload = await requestJson<{ log: { id: string }; job: { id: string } }>(server, "/api/v1/log-files", {
        method: "POST", body: JSON.stringify({ fileName: "generic.log", contentType: "text/plain", sourceVersion: "unknown", skillSelection: "generic",
          contentBase64: Buffer.from("INFO no skill\n").toString("base64") })
      });
      expect(upload.status).toBe(201);
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: upload.body.job.id, analyzer: createRuleBasedLogAnalyzer() }))
        .toEqual({ status: "processed" });
      const noSource = (await requestJson<{ item: Record<string, unknown> }>(server, `/api/v1/logs/${upload.body.log.id}`)).body.item;
      expect(noSource).toMatchObject({ sourceSnapshotSelection: "none", requestedSourceVersion: "unknown" });
      expect(noSource.conclusion).not.toContain("未找到请求版本");
      expect(noSource.conclusion).not.toContain("未配置默认快照");
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it.each(["scripted", "deterministic"] as const)("%s model locates an indexed warning, persists source evidence and bounds report-viewer access to its cited excerpt", async (mode) => {
    const ephemeral = await createEphemeralTestDatabase("sourcecite");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const organizationId = "source-cite-org";
    const admin = makeTestAuthContext({ organizationId, userId: "source-cite-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    let auth = admin;
    try {
      await seedCoreGraph(db, { organization: { id: organizationId }, users: [{ id: "source-cite-admin" }] });
      await seedCoreGraph(db, { organization: { id: "source-cite-other" }, users: [{ id: "source-other-user" }] });
      const invocation = createUserInvocation(admin), context = { requestId: "source-cite-run" };
      const skill = await createLogSkill(db, admin, { name: "Thermal source" }, invocation, context);
      const source = ["// Thermal control", "void thermal_check(int temp) {", "  if (temp > 70)",
        '    pr_warn("thermal foldback: temp=%d\\n", temp);', "}", "// End", "// Visible context", "// Outside excerpt"].join("\n");
      const zip = new JSZip(); zip.file("src/thermal.c", source);
      const stored = await objectStore.put({ organizationId, fileName: "source.zip", contentType: "application/zip",
        bytes: await zip.generateAsync({ type: "nodebuffer" }) });
      await db.query(`insert into log_source_snapshots(id,organization_id,skill_id,version_label,storage_key,file_name)
        values('thermal-source',$1,$2,'firmware-v7',$3,'source.zip')`, [organizationId, skill.id, stored.storageKey]);
      expect(await processNextSourceIndexJob({ db, objectStore })).toBe("processed");
      expect((await db.query("select status from log_source_snapshots where id='thermal-source'")).rows).toEqual([{ status: "ready" }]);
      const draft = await saveLogSkillDraft(db, admin, skill.id, { schemaVersion: "skill/v1", defaultSourceSnapshotId: "thermal-source" },
        null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, admin, skill.id, draft.id, invocation, context);

      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const request = <T = unknown>(path: string, body?: unknown) => requestJson<T>(createHttpServer(router), path,
        body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
      const locatePath = `/api/v1/log-skills/${skill.id}/source-snapshots/thermal-source/locate`;
      const matches = await request<{ items: Array<{ snapshotId: string; path: string; line: number; excerpt: string }> }>(locatePath,
        { line: "thermal foldback: temp=71" });
      expect(matches.status).toBe(200);
      expect(matches.body.items).toEqual([expect.objectContaining({ snapshotId: "thermal-source", path: "src/thermal.c", line: 4 })]);
      const uploaded = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", {
        fileName: "thermal.log", contentType: "text/plain", skillId: skill.id,
        contentBase64: Buffer.from("thermal foldback: temp=71\n").toString("base64")
      });
      expect(uploaded.status).toBe(201);
      const sourceLocation = { snapshotId: "thermal-source", path: "src/thermal.c", line: 4 };
      const scriptedModel = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "locate_log_statement", args: { line: "thermal foldback: temp=71" } } },
        { content: { action: "final", conclusion: "Thermal protection emitted the warning.", impact: "Charge current is limited.",
          severity: "Warning", confidence: 0.9, suggestedActions: ["Inspect cooling."],
          evidence: [{ lineNumbers: [], sourceLocation, inference: "The warning comes from the temperature guard.", suggestedAction: "Inspect cooling." }] } }
      ]);
      const model = mode === "scripted" ? scriptedModel : createDeterministicLogAnalysisLoopModel();
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: `source-${mode}`, maxSteps: 4, tokenBudget: 100_000,
          bindToolBackends: (input) => createWorkerLogAnalysisToolBackends({ db, organizationId, sourceSnapshot: input.sourceSnapshot }) })
      })).toEqual({ status: "processed" });

      // A report viewer may read its citation without obtaining snapshot-browsing privileges.
      auth = makeTestAuthContext({ organizationId, userId: "source-cite-admin", permissions: ["logs:view"] });
      const response = await request<{ item: unknown }>(`/api/v1/logs/${uploaded.body.log.id}`);
      expect(response.status).toBe(200);
      const report = logRecordDtoSchema.parse(response.body.item);
      expect(report).toMatchObject({ status: "complete", analysisSource: "agent",
        evidence: [{ lineNumbers: mode === "scripted" ? [] : [1], sourceLocation, sourceVersionLabel: "firmware-v7" }] });
      if (mode === "scripted") expect(scriptedModel.calls).toHaveLength(2);
      const evidenceId = report.evidence[0].id;
      const excerptPath = `/api/v1/logs/${uploaded.body.log.id}/evidence/${evidenceId}/source`;
      const excerpt = await request<{ item: { path: string; line: number; startLine: number; excerpt: string; versionLabel: string } }>(excerptPath);
      expect(excerpt.status).toBe(200);
      expect(excerpt.body.item).toMatchObject({ path: "src/thermal.c", line: 4, startLine: 1, versionLabel: "firmware-v7" });
      expect(excerpt.body.item.excerpt).toContain('pr_warn("thermal foldback: temp=%d\\n", temp)');
      expect(excerpt.body.item.excerpt).not.toContain("Outside excerpt");
      expect((await request(locatePath, { line: "thermal foldback: temp=71" })).status).toBe(403);
      expect((await request(`/api/v1/log-skills/${skill.id}/source-snapshots/thermal-source/files/src/thermal.c`)).status).toBe(404);
      expect((await request(`/api/v1/logs/${uploaded.body.log.id}/evidence/not-cited/source`)).status).toBe(404);
      auth = admin;
      const otherRecord = await request<{ log: { id: string } }>("/api/v1/log-files", {
        fileName: "other.log", contentType: "text/plain", contentBase64: Buffer.from("ordinary\n").toString("base64")
      });
      expect(otherRecord.status).toBe(201);
      expect((await request(`/api/v1/logs/${otherRecord.body.log.id}/evidence/${evidenceId}/source`)).status).toBe(404);
      auth = makeTestAuthContext({ organizationId: "source-cite-other", userId: "source-other-user", permissions: ["logs:view", "logs:admin-domains"] });
      expect((await request(excerptPath)).status).toBe(404);
      expect((await request(locatePath, { line: "thermal foldback: temp=71" })).status).toBe(404);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("completes while the pinned default is indexing, recording source provenance and the unavailable note", async () => {
    const ephemeral = await createEphemeralTestDatabase("sourcerun");
    const db = createPostgresDatabase(ephemeral.url);
    const objectRoot = await mkdtemp(join(tmpdir(), "log-source-run-"));
    try {
      await seedCoreGraph(db, { organization: { id: "org-source-run", name: "Source run" },
        users: [{ id: "source-admin", name: "Administrator" }] });
      const auth = makeTestAuthContext({ organizationId: "org-source-run", userId: "source-admin",
        roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
      const invocation = createUserInvocation(auth);
      const context = { requestId: "source-run-test" };
      const skill = await createLogSkill(db, auth, { name: "Source-aware skill" }, invocation, context);
      await db.query(`insert into log_source_snapshots
        (id, organization_id, skill_id, version_label, storage_key, file_name, status)
        values ('source-pinned', $1, $2, 'v1', 'unused/source.tgz', 'source.tgz', 'indexing')`, ["org-source-run", skill.id]);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", defaultSourceSnapshotId: "source-pinned" },
        null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);

      const objectStore = createLocalObjectStore(objectRoot);
      const router = createRouter();
      registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const uploaded = await requestJson<{ job: { id: string; runId: string } }>(createHttpServer(router), "/api/v1/log-files", {
        method: "POST", body: JSON.stringify({ fileName: "run.log", contentType: "text/plain", skillId: skill.id,
          contentBase64: Buffer.from("INFO ordinary operation\n").toString("base64") })
      });
      expect(uploaded.status).toBe(201);
      // A later publication removes the default. This queued run must still use its own revision.
      const replacement = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1" }, null, draft.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, replacement.id, invocation, context);
      let observed: AnalyzeLogInput["sourceSnapshot"];
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer: {
        async analyze(input) { observed = input.sourceSnapshot; return createRuleBasedLogAnalyzer().analyze(input); }
      } })).toEqual({ status: "processed" });
      expect(observed).toEqual({ id: "source-pinned", status: "indexing", versionLabel: "v1" });
      expect((await db.query(`select status, skill_revision_id, source_snapshot_id, source_snapshot_status
        from log_analysis_runs where id = $1`, [uploaded.body.job.runId])).rows).toEqual([{
        status: "complete", skill_revision_id: draft.id, source_snapshot_id: "source-pinned", source_snapshot_status: "indexing"
      }]);
      expect((await db.query<{ conclusion: string }>("select conclusion from log_analysis_reports where run_id = $1", [uploaded.body.job.runId]))
        .rows[0].conclusion).toContain("源码快照仍在索引，本次分析未使用源码");
    } finally {
      await db.close();
      await ephemeral.drop();
      await rm(objectRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
