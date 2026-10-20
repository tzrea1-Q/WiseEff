import { describe, expect, it } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRouter } from "../../shared/http/router";
import { createHttpServer } from "../../shared/http/server";
import { requestJson } from "../../test/testClient";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createLogSkill, saveLogSkillDraft, publishLogSkill } from "./skillsService";
import { registerLogRoutes } from "./routes";
import { processLogAnalysisJobById } from "./worker";
import { genericSignalRuleSet } from "./analyzer";
import { LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";
import type { LogSkillSpec } from "./skillSpec";

describe.skipIf(!await isTestDatabaseAvailable())("decoded-value signals through PostgreSQL runs", () => {
  it("uses the pinned register-map meaning in signals, grounded evidence and no-model fallback", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodedsignals");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = makeTestAuthContext({ organizationId: "decoded-signals", userId: "decoded-admin",
      roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Decoded signals" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const invocation = createUserInvocation(auth), context = { requestId: "decoded-signals" };
      const skill = await createLogSkill(db, auth, { name: "BQ25890 fault" }, invocation, context);
      const spec: LogSkillSpec = { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1",
        registers: { REG0C: { width: 8, fields: [{ name: "CHRG_FAULT", bits: [5, 4], enum: { "0": "normal", "2": "thermal_shutdown" } }] } },
        registerMaps: { bq: { selectBy: "addr", cases: { "0x0C": "REG0C" } } },
        extractors: [{ id: "charger", pattern: "addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)",
          fields: { addr: { type: "uint" }, val: { type: "hex", decode: { registerMap: "bq" } } } }] },
        signalRules: { ...genericSignalRuleSet, rules: [{ id: "thermal-shutdown", name: "BQ25890 thermal shutdown", severity: "Critical", stageId: "rootcause",
          anyOf: [{ type: "field", field: "charger.val.fields.CHRG_FAULT.meaning", operator: "equals", value: "thermal_shutdown" }],
          inference: "BQ25890 entered thermal shutdown", suggestedAction: "Inspect cooling", analysis: {
            conclusion: { value: "BQ25890 entered thermal shutdown", priority: 0 }, suggestedActions: []
          } }] } };
      const draft = await saveLogSkillDraft(db, auth, skill.id, spec, null, skill.currentRevision.id, invocation, context);
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const server = createHttpServer(router);
      for (const unavailable of [false, true]) {
        const uploaded = await requestJson<{ log: { id: string }; job: { id: string; runId: string } }>(server, "/api/v1/log-files", {
          method: "POST", body: JSON.stringify({ fileName: "charger.log", contentType: "text/plain", skillId: skill.id,
            contentBase64: Buffer.from("addr=0x0C val=0x00\naddr=0x0C val=0x20\naddr=0x0D val=0x20").toString("base64") })
        });
        expect(uploaded.status).toBe(201);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, maxAttempts: 1,
          ...(unavailable ? { analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } } : {}) })).toEqual({ status: "processed" });
        const response = await requestJson<{ item: unknown }>(server, `/api/v1/logs/${uploaded.body.log.id}`);
        expect(response.status).toBe(200);
        const report = logRecordDtoSchema.parse(response.body.item);
        expect(report).toMatchObject({ status: "complete", conclusion: "BQ25890 entered thermal shutdown", skillRevision: { id: draft.id } });
        if (unavailable) expect(report).toMatchObject({ analysisSource: "rules-fallback", degradedReason: "provider-unavailable" });
        expect(report.signalSummary?.signals.filter((signal) => signal.source === "skill")).toMatchObject([
          { kind: "skill:thermal-shutdown", count: 1, anchors: [{ file: "charger.log", line: 2 }] }
        ]);
        expect(report.evidence).toMatchObject([{ filePath: "charger.log", lineNumbers: [2], ruleHit: "thermal-shutdown",
          decodedFields: [{ extractor: "charger", line: 2, fields: { val: { fields: { CHRG_FAULT: { meaning: "thermal_shutdown" } } } } }] }]);
        expect((await db.query("select signal_summary from log_analysis_reports where run_id=$1", [uploaded.body.job.runId])).rows)
          .toEqual([{ signal_summary: report.signalSummary }]);
      }
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
