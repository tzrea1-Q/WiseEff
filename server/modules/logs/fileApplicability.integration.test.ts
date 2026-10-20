import JSZip from "jszip";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { createLogSkill, saveLogSkillDraft, publishLogSkill } from "./skillsService";
import { rerunLogAnalysis } from "./service";
import { processLogAnalysisJobById } from "./worker";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { genericSignalRuleSet } from "./analyzer";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";
import { matchSkillFile } from "../../../src/domain/logs/fileApplicability";
import type { LogSkillSpec } from "./skillSpec";

const available = await isTestDatabaseAvailable();
describe.skipIf(!available)("skill applicability through sample preview, upload, worker and report API", () => {
  it("restricts custom rules and decoding while persisting roles and keeping every text file readable", async () => {
    const ephemeral = await createEphemeralTestDatabase("fileglobs");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = makeTestAuthContext({ organizationId: "glob-org", userId: "glob-admin", roles: [{ roleId: "admin", projectId: null }],
      permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Globs" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const invocation = createUserInvocation(auth), context = { requestId: "file-globs" };
      const skill = await createLogSkill(db, auth, { name: "Charging globs" }, invocation, context);
      const spec: LogSkillSpec = { schemaVersion: "skill/v1", files: [{ glob: "charger/**", role: "充电" }],
        // This profile hides ERROR on matching files; generic parsing must survive on siblings.
        formatProfile: { severityMap: { info: ["ERROR"] } },
        parsing: { schemaVersion: "parsing/v1", extractors: [{ id: "sensor", files: ["**/*"],
          pattern: "temperature=(?P<temperature>\\d+)", fields: { temperature: { type: "int" } } }] },
        signalRules: { ...genericSignalRuleSet, rules: [{ id: "charging-high", stageId: "rootcause", name: "Charging high",
          severity: "Warning", anyOf: [{ type: "text", pattern: "CUSTOM" }, { type: "field", field: "sensor.temperature", operator: "range", min: 90, max: 100 }],
          inference: "Charging needs inspection", suggestedAction: "Inspect charger", analysis: { suggestedActions: [] } }] } };
      const draft = await saveLogSkillDraft(db, auth, skill.id, spec, null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const zip = new JSZip();
      for (const path of ["kernel/dmesg.log", "charger/charger.log", "misc/notes.txt"]) zip.file(path, "ERROR CUSTOM temperature=95\nwatchdog reset\n");
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      let currentAuth = auth;
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const base = `/api/v1/log-skills/${skill.id}`;
      expect((await request(`${base}/sample`, "PUT", { fileName: "sample.zip", contentBase64: bytes.toString("base64") })).status).toBe(200);
      const preview = await request<{ valid: boolean; files: Array<{ path: string; skillMatched: boolean; role: string | null }> }>(`${base}/files/preview`, "POST", { files: spec.files });
      expect(preview.status).toBe(200);
      const sortedPreview = [...preview.body.files].sort((a, b) => a.path.localeCompare(b.path));
      expect(sortedPreview).toEqual(["charger/charger.log", "kernel/dmesg.log", "misc/notes.txt"].map((path) => ({ path, ...matchSkillFile(spec.files, path) })));
      const upload = await request<{ log: { id: string }; job: { id: string; runId: string } }>("/api/v1/log-files", "POST",
        { fileName: "bundle.zip", contentType: "application/zip", contentBase64: bytes.toString("base64"), skillId: skill.id });
      expect(upload.status).toBe(201);
      const uploaded = upload.body;
      // An unpublished applicability edit cannot retarget an already queued run.
      await saveLogSkillDraft(db, auth, skill.id, { ...spec, files: [{ glob: "misc/**", role: "配置" }] }, null, draft.id, invocation, context);
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "list_files", args: {} } },
        { content: { action: "tool", tool: "search_lines", args: { pattern: "CUSTOM", neighborhood: 0 } } },
        { content: { action: "final", conclusion: "All files readable", impact: "Inspection", severity: "Warning", confidence: 0.8,
          suggestedActions: ["Inspect"], evidence: [{ filePath: "misc/notes.txt", lineNumbers: [1], inference: "Notes readable", suggestedAction: "Inspect" }] } }
      ]);
      const analyzer = createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", tokenBudget: 16000, maxSteps: 5 });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id, analyzer })).toEqual({ status: "processed" });
      const response = await request<{ item: unknown }>(`/api/v1/logs/${uploaded.log.id}`);
      expect(response.status).toBe(200);
      const report = logRecordDtoSchema.parse(response.body.item);
      expect(report).toMatchObject({ status: "complete", analysisSource: "agent", evidence: [expect.objectContaining({ filePath: "misc/notes.txt" })] });
      expect(report.files?.map(({ path, skillMatched, role }) => ({ path, skillMatched, role }))).toEqual(sortedPreview);
      expect((await db.query("select path, role, skill_matched from log_files where record_id=$1 order by path", [uploaded.log.id])).rows)
        .toEqual(sortedPreview.map(({ path, role, skillMatched }) => ({ path, role, skill_matched: skillMatched })));
      const custom = report.signalSummary!.signals.filter(({ source }) => source === "skill");
      expect(custom).toHaveLength(1);
      expect(custom[0]).toMatchObject({ kind: "skill:charging-high", anchors: [expect.objectContaining({ file: "charger/charger.log" })] });
      for (const path of ["kernel/dmesg.log", "misc/notes.txt"]) expect(report.signalSummary!.signals)
        .toEqual(expect.arrayContaining([expect.objectContaining({ source: "generic", kind: "first-error", anchors: [expect.objectContaining({ file: path })] })]));
      const listing = model.calls[1].find(({ content }) => content.startsWith("Tool result for list_files:"));
      expect(listing).toBeDefined();
      const listed = JSON.parse(listing!.content.slice(listing!.content.indexOf("\n") + 1)) as { files: Array<{ path: string; role: string | null; skillMatched: boolean }> };
      expect(listed.files.map(({ path, role, skillMatched }) => ({ path, role, skillMatched }))).toEqual(sortedPreview);
      expect(model.calls[2].find(({ content }) => content.startsWith("Tool result for search_lines:"))!.content).toContain("misc/notes.txt");
      const artifact = (await db.query<{ decoded_events_object_key: string }>("select decoded_events_object_key from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
      const decoded = gunzipSync(await objectStore.get(artifact.decoded_events_object_key)).toString().trim().split("\n").map((line) => JSON.parse(line) as { file: string });
      expect(decoded.map(({ file }) => file)).toEqual(["charger/charger.log"]);
      // The shared fallback must obey the same assignment as the agent path.
      const rerun = await rerunLogAnalysis(db, auth, { logId: uploaded.log.id, revisionPolicy: "pinned" });
      expect((await db.query("select role, skill_matched from log_files where record_id=$1", [uploaded.log.id])).rows)
        .toEqual(Array.from({ length: 3 }, () => ({ role: null, skill_matched: null })));
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: rerun.job.id, maxAttempts: 1,
        analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } })).toEqual({ status: "processed" });
      const fallback = logRecordDtoSchema.parse((await request<{ item: unknown }>(`/api/v1/logs/${uploaded.log.id}`)).body.item);
      expect(fallback).toMatchObject({ analysisSource: "rules-fallback" });
      expect(fallback.evidence.filter(({ ruleHit }) => ruleHit === "charging-high").map(({ filePath }) => filePath)).toEqual(["charger/charger.log"]);
      expect(fallback.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "kernel/dmesg.log", ruleHit: "generic:first-error" })]));
      currentAuth = { ...auth, permissions: ["logs:view"] };
      expect((await request(`${base}/files/preview`, "POST", { files: spec.files })).status).toBe(403);
      currentAuth = makeTestAuthContext({ organizationId: "another-org", userId: "another-admin", permissions: auth.permissions });
      expect((await request(`${base}/files/preview`, "POST", { files: spec.files })).status).toBe(404);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
