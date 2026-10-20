import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { registerLogRoutes } from "./routes";
import { provisionChargingSkill } from "./provisionChargingSkill";
import { getLogSkill, saveLogSkillDraft, publishLogSkill } from "./skillsService";
import { createUserInvocation } from "../auth/trustedInvocation";
import { processLogAnalysisJobById } from "./worker";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { logRecordDtoSchema, logSkillRecommendationResponseSchema } from "../contracts/dtoSchemas/logs";
import type { LogRecordDto } from "./types";

const available = await isTestDatabaseAvailable();
type Upload = { log: LogRecordDto; fileObject: { id: string }; job: { id: string } };

describe.skipIf(!available)("skill recommendation upload routing over PostgreSQL", () => {
  it("routes stored bundles, preserves explicit choices, and records reasons through worker/report readback", async () => {
    const ephemeral = await createEphemeralTestDatabase("recommend");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = makeTestAuthContext({ organizationId: "recommend-org", userId: "recommend-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    let currentAuth = auth;
    try {
      for (const organizationId of [auth.organization.id, "foreign-org"]) {
        await seedCoreGraph(db, { organization: { id: organizationId, name: organizationId },
          users: [{ id: organizationId === auth.organization.id ? auth.user.id : "foreign-user", name: "Admin" }] });
        await provisionChargingSkill(db, organizationId);
      }
      const chargingId = `seed-charging:${auth.organization.id}`;
      const publishFiles = async (skillId: string, files: Array<{ glob: string; role: string }>) => {
        const skill = await getLogSkill(db, auth, skillId), invocation = createUserInvocation(auth);
        const draft = await saveLogSkillDraft(db, auth, skillId, { ...skill.currentRevision.spec, files }, null,
          skill.currentRevision.id, invocation, { requestId: "recommend-files" });
        await publishLogSkill(db, auth, skillId, draft.id, invocation, { requestId: "recommend-files" });
      };
      await publishFiles(chargingId, [{ glob: "charger/**", role: "充电" }]);
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => currentAuth });
      const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path,
        { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const sample = readFileSync("test-fixtures/logs/charging-foldback.log", "utf8");
      const zip = new JSZip().file("charger/kernel.log", sample).file("system/info.log", "INFO web request complete\n");
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      const uploadBody = { fileName: "sample.zip", contentType: "application/zip", contentBase64: bytes.toString("base64") };
      const rankedResponse = await request("/api/v1/log-skills/recommend", "POST", {
        files: [{ path: "charger/kernel.log", head: sample.trim().split("\n") }]
      });
      expect(rankedResponse.status).toBe(200);
      const ranked = logSkillRecommendationResponseSchema.parse(rankedResponse.body);
      expect(ranked.recommendedSkillId).toBe(chargingId);
      expect(ranked.recommendations.map(({ skillId }) => skillId)).toEqual([chargingId]);
      expect(ranked.recommendations[0].reasons).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "pattern", file: "charger/kernel.log", detail: expect.stringContaining("thermal-foldback"),
          source: "signal", ref: "热降额" })
      ]));
      const recommended = await request<Upload>("/api/v1/log-files", "POST", uploadBody);
      expect(recommended.status).toBe(201);
      expect(recommended.body.log).toMatchObject({ logDomainId: chargingId,
        skillSelection: { mode: "recommended", reasons: ranked.recommendations[0].reasons } });
      const chargingFiles = [
        { path: "charger/kernel.log", role: "充电", skillMatched: true },
        { path: "system/info.log", role: null, skillMatched: false }
      ];
      expect(recommended.body.log.files).toMatchObject(chargingFiles);
      expect((await db.query("select path, role, skill_matched from log_files where record_id=$1 order by path",
        [recommended.body.log.id])).rows).toEqual(chargingFiles.map(({ path, role, skillMatched }) => ({ path, role, skill_matched: skillMatched })));

      // The two-stage /logs API reads the original stored bundle, not its zip name.
      const replay = await request<Upload>("/api/v1/logs", "POST", {
        fileObjectId: recommended.body.fileObject.id, fileName: "sample.zip"
      });
      expect(replay.status).toBe(201);
      expect(replay.body.log).toMatchObject({ logDomainId: chargingId, skillSelection: { mode: "recommended" } });
      expect(replay.body.log.files).toMatchObject(chargingFiles);
      for (const log of [recommended.body.log, replay.body.log]) {
        const originals = await db.query<{ object_key: string }>("select object_key from log_original_uploads where record_id=$1", [log.id]);
        expect(originals.rows).toHaveLength(1);
        expect(await objectStore.get(originals.rows[0].object_key)).toEqual(bytes);
      }

      const unrelated = await request<Upload>("/api/v1/log-files", "POST", { fileName: "web.log", contentType: "text/plain",
        contentBase64: Buffer.from("INFO web request complete\nERROR invalid password\n").toString("base64") });
      expect(unrelated.status).toBe(201);
      expect(unrelated.body.log.logDomainId).toBeUndefined();
      expect(unrelated.body.log).toMatchObject({ skillRevision: null, skillSelection: { mode: "generic", reasons: [] } });
      const explicitSkill = await request<{ item: { id: string; skillKey: string } }>("/api/v1/log-skills", "POST", { name: "Explicit custom skill" });
      expect(explicitSkill.status).toBe(201);
      await publishFiles(explicitSkill.body.item.id, [{ glob: "system/**", role: "系统" }]);
      const explicit = await request<Upload>("/api/v1/log-files", "POST", { ...uploadBody,
        skillId: explicitSkill.body.item.id, skillSelection: "generic" });
      expect(explicit.status).toBe(201);
      expect(explicit.body.log).toMatchObject({ logDomainId: explicitSkill.body.item.id, skillSelection: { mode: "explicit", reasons: [] } });
      const explicitFiles = [
        { path: "charger/kernel.log", role: null, skillMatched: false },
        { path: "system/info.log", role: "系统", skillMatched: true }
      ];
      expect(explicit.body.log.files).toMatchObject(explicitFiles);
      for (const [path, body] of [["/api/v1/log-files", uploadBody], ["/api/v1/logs", {
        fileObjectId: recommended.body.fileObject.id, fileName: "sample.zip"
      }]] as const) {
        const keyed = await request<Upload>(path, "POST", { ...body, skillKey: explicitSkill.body.item.skillKey, skillSelection: "generic" });
        expect(keyed.status).toBe(201);
        expect(keyed.body.log).toMatchObject({ logDomainId: explicitSkill.body.item.id, skillSelection: { mode: "explicit", reasons: [] } });
        expect(keyed.body.log.files).toMatchObject(explicitFiles);
        for (const selectors of [{ skillKey: explicitSkill.body.item.skillKey, skillId: chargingId },
          { skillKey: explicitSkill.body.item.skillKey, logDomainId: chargingId },
          { skillId: explicitSkill.body.item.id, logDomainId: chargingId }]) {
          const conflict = await request<{ error: { code: string } }>(path, "POST", { ...body, ...selectors });
          expect(conflict.status).toBe(400);
          expect(conflict.body.error.code).toBe("VALIDATION_FAILED");
        }
      }
      const none = await request<Upload>("/api/v1/log-files", "POST", { ...uploadBody, skillSelection: "generic" });
      expect(none.status).toBe(201);
      expect(none.body.log).toMatchObject({ skillRevision: null, skillSelection: { mode: "generic", reasons: [] } });
      expect(none.body.log.logDomainId).toBeUndefined();

      for (const upload of [recommended.body, replay.body, unrelated.body, explicit.body, none.body]) {
        const file = upload.log.fileName === "web.log" ? "web.log" : "charger/kernel.log";
        const model = createScriptedLogAnalysisModel([
          { content: { action: "tool", tool: "read_line_range", args: { file, startLine: 1, endLine: 2 } } },
          { content: { action: "final", conclusion: "Inspected uploaded bundle.", impact: "Check source context.", severity: "Info", confidence: 0.7,
            suggestedActions: ["Inspect source."], evidence: [{ filePath: file, lineNumbers: [1], inference: "Source inspected.", suggestedAction: "Inspect source." }] } }
        ]);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: upload.job.id,
          analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "recommend-scripted", tokenBudget: 16_000, maxSteps: 3 }) })).toEqual({ status: "processed" });
        const readback = await request<{ item: unknown }>(`/api/v1/logs/${upload.log.id}`);
        expect(readback.status).toBe(200);
        const report = logRecordDtoSchema.parse(readback.body.item);
        expect(report).toMatchObject({ status: "complete", analysisSource: "agent", skillSelection: upload.log.skillSelection });
        expect(report.logDomainId).toBe(upload.log.logDomainId);
        expect(report.skillRevision).toEqual(upload.log.skillRevision);
      }
      const decision = await db.query<{ skill_selection: unknown }>("select skill_selection from log_records where organization_id=$1 and id=$2",
        [auth.organization.id, recommended.body.log.id]);
      expect(decision.rows[0].skill_selection).toEqual(recommended.body.log.skillSelection);

      const rerun = await request<{ log: LogRecordDto }>(`/api/v1/logs/${recommended.body.log.id}/rerun`, "POST", {
        skillId: explicitSkill.body.item.id
      });
      expect(rerun.status).toBe(200);
      expect(rerun.body.log).toMatchObject({ logDomainId: explicitSkill.body.item.id, skillSelection: { mode: "explicit", reasons: [] } });

      // Draft and archived revisions never participate; permissions and tenant remain authoritative.
      await db.query(`insert into log_skill_revisions(id,organization_id,skill_id,revision_number,status,spec,content_hash)
        values ('recommend-draft',$1,$2,3,'draft',$3::jsonb,'draft')`, [auth.organization.id, chargingId,
        JSON.stringify({ schemaVersion: "skill/v1", files: [{ glob: "draft-only.log", role: "draft" }], formatProfile: { severityMap: { error: ["DRAFT"] }, timestampPattern: "DRAFT" } })]);
      const draftOnly = await request<{ recommendedSkillId?: string }>("/api/v1/log-skills/recommend", "POST", { files: [{ path: "draft-only.log", head: ["DRAFT"] }] });
      expect(draftOnly.body.recommendedSkillId).toBeUndefined();
      await db.query("update log_domains set status='archived' where organization_id=$1 and id=$2", [auth.organization.id, chargingId]);
      const archived = await request<{ recommendations: Array<{ skillId: string }> }>("/api/v1/log-skills/recommend", "POST", { files: [{ path: "kernel.log", head: sample.trim().split("\n") }] });
      expect(archived.body.recommendations.map(({ skillId }) => skillId)).not.toContain(chargingId);
      currentAuth = { ...auth, permissions: ["logs:view"] };
      expect((await request("/api/v1/log-skills/recommend", "POST", { files: [] })).status).toBe(403);
      currentAuth = auth;
      expect((await request("/api/v1/log-skills/recommend", "POST", { files: [{ path: "kernel.log", head: ["界".repeat(1000)] }] })).status).toBe(400);
      const foreignSelection = await request("/api/v1/log-files", "POST", { ...uploadBody, skillId: "seed-charging:foreign-org" });
      expect(foreignSelection.status).toBe(400);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
