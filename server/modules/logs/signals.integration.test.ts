import JSZip from "jszip";
import { readFile } from "node:fs/promises";
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
import { processLogAnalysisJobById } from "./worker";
import { getLogRecord, uploadLogFile } from "./service";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";
import { createRuleBasedLogAnalyzer, genericSignalRuleSet } from "./analyzer";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { createLogSkill, saveLogSkillDraft, publishLogSkill } from "./skillsService";
import { createUserInvocation } from "../auth/trustedInvocation";
import { createDeterministicLogAnalysisLoopModel, createDeterministicLogAnalysisModel } from "./analyzer/deterministicModel";
import { createLlmLogAnalyzer } from "./analyzer/llmAnalyzer";

const available = await isTestDatabaseAvailable();
const authFor = (organizationId = "signals-org") => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze"] });

describe.skipIf(!available)("generic signals through upload, worker and HTTP report", () => {
  it("keeps the pinned charging diagnosis ahead of generic signals through rules, degradation and deterministic models", async () => {
    const ephemeral = await createEphemeralTestDatabase("chargingsignals");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth: ReturnType<typeof authFor> = { ...authFor(), permissions: [...authFor().permissions, "logs:admin-domains"] };
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Charging" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const invocation = createUserInvocation(auth), context = { requestId: "charging-signals" };
      const skill = await createLogSkill(db, auth, { name: "Seed charging", formatProfile: {} }, invocation, context);
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", signalRules: defaultChargingRuleSet }, null, skill.currentRevision.id, invocation, context);
      const published = await publishLogSkill(db, auth, skill.id, draft.id, invocation, context);
      const bytes = await readFile("test-fixtures/logs/charging-foldback.log");
      const adapters = [
        { analyzer: createRuleBasedLogAnalyzer(), confidence: 0.85 },
        { analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } }, confidence: 0.85 },
        { analyzer: createAgentLoopLogAnalyzer({ model: createDeterministicLogAnalysisLoopModel(), modelLabel: "deterministic", maxSteps: 5, tokenBudget: 100_000 }), confidence: 0.82 },
        { analyzer: createLlmLogAnalyzer({ model: createDeterministicLogAnalysisModel(), modelLabel: "deterministic", tokenBudget: 100_000 }), confidence: 0.82 }
      ];
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      for (const { analyzer, confidence } of adapters) for (const skillId of [skill.id, undefined]) {
        const uploaded = await requestJson<{ log: { id: string }; job: { id: string } }>(createHttpServer(router), "/api/v1/log-files", {
          method: "POST", body: JSON.stringify({ fileName: "charging-foldback.log", contentType: "text/plain", skillId, contentBase64: bytes.toString("base64") })
        });
        expect(uploaded.status).toBe(201);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id, analyzer, maxAttempts: 1 })).toEqual({ status: "processed" });
        const response = await requestJson<{ item: unknown }>(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`);
        expect(response.status).toBe(200);
        const report = logRecordDtoSchema.parse(response.body.item);
        expect(report).toMatchObject({ status: "complete", confidence, skillRevision: skillId ? { id: published.currentRevision.id } : null });
        expect(report.conclusion).toMatch(/thermal foldback/i);
        expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "charging-foldback.log", lineNumbers: expect.arrayContaining([4]), inference: expect.stringMatching(/thermal/i) })]));
        expect(report.signalSummary?.signals).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "first-error", source: "generic", anchors: [expect.objectContaining({ file: "charging-foldback.log", line: 4 })] })
        ]));
        if (skillId) expect(report.signalSummary?.signals).toEqual(expect.arrayContaining([
          expect.objectContaining({ kind: "skill:thermal-foldback", source: "skill", anchors: expect.arrayContaining([expect.objectContaining({ file: "charging-foldback.log", line: 4 })]) })
        ]));
      }
      const emptySkill = await createLogSkill(db, auth, { name: "Explicit empty skill", formatProfile: {} }, invocation, context);
      const emptyUpload = await uploadLogFile(db, objectStore, auth, { fileName: "charging-foldback.log", contentType: "text/plain", bytes, logDomainId: emptySkill.id });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: emptyUpload.job!.id })).toEqual({ status: "processed" });
      const emptyReport = await getLogRecord(db, auth, emptyUpload.log.id);
      expect(emptyReport.conclusion).toBe(genericSignalRuleSet.hitDefaults.conclusion);
      expect(emptyReport.confidence).toBe(0.55);
      expect(emptyReport.evidence.some((item) => item.ruleHit === "thermal-foldback")).toBe(false);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
  it("persists no-skill bundle signals, grounds their lines, and retains fallback and tenant boundaries", async () => {
    const ephemeral = await createEphemeralTestDatabase("logsignals");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    let auth = authFor();
    try {
      for (const id of ["signals-org", "signals-other"]) await seedCoreGraph(db, {
        organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }]
      });
      const zip = new JSZip();
      zip.file("kernel.log", "2026-10-19T10:00:00Z INFO Linux version 6.1\n2026-10-19T10:02:00Z kernel panic\n[ 12.0] Oops\n"
        + Array.from({ length: 8 }, (_, i) => `[ ${(12.1 + i * 0.05).toFixed(2)}] usb 1-1: error -71 while reading descriptor`).join("\n"));
      zip.file("app.log", Array.from({ length: 6 }, (_, index) => `2026-10-19T10:02:0${index}Z ERROR request id=${index} failed /tmp/request-${index}`).join("\n"));
      const router = createRouter(); registerLogRoutes(router, { db, objectStore, getCurrentAuthContext: () => auth });
      const uploaded = await requestJson<{ log: { id: string }; job: { id: string; runId: string } }>(createHttpServer(router), "/api/v1/log-files", {
        method: "POST", body: JSON.stringify({ fileName: "signals.zip", contentType: "application/zip",
          contentBase64: (await zip.generateAsync({ type: "nodebuffer" })).toString("base64") })
      });
      expect(uploaded.status).toBe(201);
      const final = { action: "final", conclusion: "Kernel crash and application error burst", impact: "Service disrupted", severity: "Critical", confidence: 0.8,
        suggestedActions: ["Inspect restart context"], evidence: [
          { filePath: "kernel.log", lineNumbers: [2], inference: "Kernel panic after a gap", suggestedAction: "Inspect kernel context" },
          { filePath: "app.log", lineNumbers: [1], inference: "Application errors", suggestedAction: "Inspect application context" }
        ] };
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "get_signals", args: {} } }, { content: final }
      ]);
      await expect(processLogAnalysisJobById({ db, objectStore, jobId: uploaded.body.job.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 4, tokenBudget: 100_000 }) })).resolves.toEqual({ status: "processed" });
      const response = await requestJson<{ item: unknown }>(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`);
      expect(response.status).toBe(200);
      const report = logRecordDtoSchema.parse(response.body.item);
      expect(report).toMatchObject({ status: "complete", skillRevision: null, analysisSource: "agent", confidence: 0.8,
        evidence: [{ filePath: "kernel.log", lineNumbers: [2] }, { filePath: "app.log", lineNumbers: [1] }] });
      const summary = report.signalSummary!;
      expect(summary.signals.filter((signal) => signal.kind === "crash").map((signal) => signal.signature)).toEqual(["Kernel panic", "Oops"]);
      expect(summary.signals).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "error-burst", count: 8,
        anchors: expect.arrayContaining([expect.objectContaining({ file: "kernel.log", line: 4 })]) })]));
      expect(summary.signals.map((signal) => signal.kind)).toEqual(expect.arrayContaining(["crash", "timestamp-gap", "error-burst", "first-error"]));
      expect(summary.signals.every((signal) => signal.source === "generic" && signal.anchors.length > 0)).toBe(true);
      expect(summary.templates.some((template) => template.count >= 5 && template.first.file === "app.log" && template.last.line >= 5)).toBe(true);
      expect((await db.query("select signal_summary from log_analysis_reports where run_id=$1", [uploaded.body.job.runId])).rows)
        .toEqual([{ signal_summary: summary }]);
      auth = authFor("signals-other");
      expect((await requestJson(createHttpServer(router), `/api/v1/logs/${uploaded.body.log.id}`)).status).toBe(404);
      auth = authFor();
      // Exhausted provider retries use the same generic summary and preserve honest degradation.
      const fallback = await uploadLogFile(db, objectStore, auth, { fileName: "fallback.log", contentType: "text/plain", bytes: Buffer.from("kernel panic\nERROR unrelated fault") });
      await processLogAnalysisJobById({ db, objectStore, jobId: fallback.job!.id, maxAttempts: 1,
        analyzer: { analyze: async () => { throw new LogAnalysisProviderError("offline"); } } });
      const degraded = await getLogRecord(db, auth, fallback.log.id);
      expect(degraded).toMatchObject({ status: "complete", analysisSource: "rules-fallback", degradedReason: "provider-unavailable" });
      expect(degraded.conclusion).toBe(genericSignalRuleSet.hitDefaults.conclusion);
      expect(degraded.confidence).toBeLessThanOrEqual(0.6);
      expect(degraded.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ ruleHit: "generic:crash", filePath: "fallback.log", lineNumbers: [1] })]));
      expect(degraded.evidence.some((item) => item.ruleHit === "thermal-foldback")).toBe(false);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
