import JSZip from "jszip";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { createLogSkill, saveLogSkillDraft } from "./skillsService";
import { createLogAnalyzerFromEnv } from "./analyzer/analyzerFromEnv";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { defaultChargingRuleSet } from "./chargingSignalRules";
import { processLogAnalysisJobById } from "./worker";
import { createLogFromFile, getLogRecord, uploadLogFile } from "./service";
import { createAnalysisCase, exportSkillAnalysisCases, getAnalysisCasePrefill, getAnalysisCaseRun, getAnalysisCaseTrace, importSkillAnalysisCases, listAnalysisCases, startAnalysisCaseRun, readAnalysisCases, updateAnalysisCase, deleteAnalysisCase } from "./analysisCases";
import { startSkillDryRun } from "./dryRuns";
import { replaceLogSkillSample } from "./skillSamplesService";
import type { LogAnalysisAdapter } from "./analyzer";

const available = await isTestDatabaseAvailable();
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const expectations = { domain: "generic", summary: "Thermal foldback", realLog: false, rootCauseCategory: "thermal-protection",
  rootCausePoints: ["过热保护降额"], keyEvidenceLines: [1], expectedActions: ["与负责团队一起核对引用的日志"], expectRefusal: false };
async function harness() {
  const ephemeral = await createEphemeralTestDatabase("analysiscases");
  const db = createPostgresDatabase(ephemeral.url), store = createMemoryObjectStore();
  vi.stubEnv("LOG_ANALYSIS_DETERMINISTIC", "true");
  const auth = makeTestAuthContext({ organizationId: "cases-org", userId: "cases-admin", permissions: ["logs:view", "logs:upload", "logs:analyze", "logs:admin-domains"] });
  const other = makeTestAuthContext({ organizationId: "cases-other", userId: "other-admin", permissions: ["logs:view", "logs:admin-domains"] });
  for (const identity of [auth, other]) await seedCoreGraph(db, { organization: { id: identity.organization.id, name: identity.organization.id }, users: [{ id: identity.user.id, name: "Admin" }] });
  const invocation = createUserInvocation(auth), context = { requestId: "analysis-cases-test" };
  const skill = await createLogSkill(db, auth, { name: "Analysis cases" }, invocation, context);
  const draft = await saveLogSkillDraft(db, auth, skill.id, { ...skill.currentRevision.spec, signalRules: defaultChargingRuleSet, procedure: "Check thermal protection." }, null, skill.currentRevision.id, invocation, context);
  const analyzer = createLogAnalyzerFromEnv({ LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_API_TIMEOUT_MS: 1000, LOG_ANALYSIS_TOKEN_BUDGET: 100_000, LOG_ANALYSIS_MAX_STEPS: 8 }, { db });
  const router = createRouter();
  registerLogRoutes(router, { db, objectStore: store, analyzer, getCurrentAuthContext: () => auth });
  const request = <T,>(path: string, method = "GET", body?: unknown) => requestJson<T>(createHttpServer(router), path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const wait = async (runId: string) => {
    let response = await getAnalysisCaseRun(db, auth, skill.id, runId);
    await vi.waitFor(async () => { response = await getAnalysisCaseRun(db, auth, skill.id, runId); expect(response.run.status).not.toBe("processing"); }, { timeout: 10_000 });
    return response.run;
  };
  return { db, store, auth, other, invocation, context, skill, draft, analyzer, request, wait, async close() { await db.close(); await ephemeral.drop(); } };
}

describe.skipIf(!available)("analysis cases over PostgreSQL", () => {
  it("rolls back case results and traces when the corresponding run audit cannot be written", async () => {
    const h = await harness();
    try {
      const item = await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Audited result", expectations,
        files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal foldback\n") }] }, h.invocation, h.context);
      await h.db.query(`create function reject_case_result_audit() returns trigger language plpgsql as $$ begin
        if new.kind in ('log-analysis-case-run-progress', 'log-analysis-case-run-complete') then raise exception 'result audit unavailable'; end if; return new; end $$;
        create trigger reject_case_result_audit before insert on audit_events for each row execute function reject_case_result_audit()`);
      const started = await startAnalysisCaseRun(h.db, h.store, h.analyzer, h.auth, h.skill.id, undefined, h.invocation, h.context);
      const run = await h.wait(started.run.id);
      expect(run.status).toBe("failed");
      expect(run.results).toEqual([]);
      await expect(getAnalysisCaseTrace(h.db, h.auth, h.skill.id, run.id, item.id, "draft")).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await h.db.query("select kind from audit_events where kind in ('log-analysis-case-run-progress','log-analysis-case-run-complete')")).rows).toEqual([]);
      expect((await h.db.query("select kind from audit_events where kind = 'log-analysis-case-run-failed'")).rows).toHaveLength(1);
    } finally { await h.close(); }
  }, 120_000);

  it("runs real deterministic loop against pinned draft and published specs, persists comparison and trace, isolates tenants and keeps user records untouched", async () => {
    const h = await harness();
    try {
      const created = await h.request<{ item: { id: string } }>(`/api/v1/log-skills/${h.skill.id}/analysis-cases`, "POST", {
        name: "Foldback", expectations: { ...expectations, keyEvidenceLines: [], keyEvidence: [{ file: "fixtures/thermal.log", pattern: "thermal" }] }, files: [{ fileName: "thermal.log", contentBase64: Buffer.from("ERROR thermal foldback protection\n\n").toString("base64") }]
      });
      expect(created.status).toBe(201);
      const keysBeforeMismatch = [...h.store.entries.keys()];
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Mismatched principal", expectations,
        files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal") }] }, createUserInvocation(h.other), h.context)).rejects.toThrow("invocation principal does not match");
      expect([...h.store.entries.keys()]).toEqual(keysBeforeMismatch);
      const invalidPattern = { ...expectations, keyEvidenceLines: [], keyEvidence: [{ file: "thermal.log", pattern: "MISSING_PATTERN" }] };
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Invalid pattern", expectations: invalidPattern, files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal\n") }] }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("第 1 条关键证据的表达式") });
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Invalid profile", expectations: { ...expectations, formatProfile: { timestampPattern: "[" } },
        files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal\n") }] }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("日志格式配置无效") });
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Oversized metadata", expectations: { ...expectations, rootCausePoints: Array<string>(100).fill("温".repeat(4000)) },
        files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal\n") }] }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("1 MiB 上限") });
      for (const invalid of [
        { ...expectations, keyEvidence: [{ file: "thermal.log", line: 2 }] },
        { ...expectations, keyEvidenceLines: [2] },
        { ...expectations, keyEvidence: [{ file: "thermal.log", line: 1, pattern: "MISSING_PATTERN" }] }
      ]) await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Invalid anchor", expectations: invalid, files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal\n\n") }] }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const countVisible = async () => ({
        records: (await h.db.query("select count(*)::int n from log_records")).rows,
        runs: (await h.db.query("select count(*)::int n from log_analysis_runs")).rows,
        jobs: (await h.db.query("select count(*)::int n from jobs")).rows,
        webhooks: (await h.db.query("select count(*)::int n from log_webhook_outbox")).rows
      });
      const before = await countVisible();
      const keysBeforeRefusal = [...h.store.entries.keys()].sort();
      await h.db.query(`create function reject_analysis_case_audit() returns trigger language plpgsql as $$ begin
        if new.kind = 'log-analysis-case-create' then raise exception 'audit unavailable'; end if; return new; end $$;
        create trigger reject_analysis_case_audit before insert on audit_events for each row execute function reject_analysis_case_audit()`);
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Rejected", expectations, files: [{ fileName: "rejected.log", bytes: Buffer.from("ERROR thermal\n") }] }, h.invocation, h.context)).rejects.toThrow("audit unavailable");
      expect([...h.store.entries.keys()].sort()).toEqual(keysBeforeRefusal);
      expect((await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id))).toHaveLength(1);
      await h.db.query("drop trigger reject_analysis_case_audit on audit_events; drop function reject_analysis_case_audit()");
      const started = await h.request<{ run: { id: string } }>(`/api/v1/log-skills/${h.skill.id}/analysis-case-runs`, "POST", {});
      expect(started.status).toBe(202);
      const run = await h.wait(started.body.run.id);
      expect(run).toMatchObject({ status: "complete", progress: 100, skillRevisionId: h.draft.id, publishedRevisionId: h.skill.currentRevision.id });
      expect(run.results).toHaveLength(1);
      expect(run.results[0]).toMatchObject({ caseId: created.body.item.id, draft: { passed: true, score: 100, report: { analysisSource: "agent" } }, published: { passed: false } });
      expect(run.results[0].draft.quality).toMatchObject({ anchorEvidence: { precision: 1, recall: 1,
        hits: [{ file: "fixtures/thermal.log", pattern: "thermal" }], misses: [] } });
      expect(run.results[0].delta).toBeGreaterThan(0);
      const trace = await h.request<{ steps: unknown[] }>(run.results[0].draft.traceReference);
      expect(trace.status).toBe(200); expect(trace.body.steps.length).toBeGreaterThan(0);
      expect(await countVisible()).toEqual(before);
      expect((await h.request<{ items: unknown[] }>("/api/v1/logs")).body.items).toEqual([]);
      expect((await listAnalysisCases(h.db, h.auth, h.skill.id)).current).toBe(true);
      await expect(listAnalysisCases(h.db, h.other, h.skill.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(getAnalysisCaseRun(h.db, h.other, h.skill.id, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createAnalysisCase(h.db, h.store, h.other, h.skill.id, { name: "Cross tenant", expectations, files: [{ fileName: "test.log", bytes: Buffer.from("ERROR thermal") }] }, createUserInvocation(h.other), h.context)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(h.db.query(`insert into log_skill_analysis_cases(id, organization_id, skill_id, name, expectations, uploads, files) values ('cross-case',$1,$2,'No','{}','[]','[]')`, [h.other.organization.id, h.skill.id])).rejects.toMatchObject({ code: "23503" });
      const audits = (await h.db.query<{ kind: string }>("select kind from audit_events where organization_id=$1 and kind like 'log-analysis-case-%' order by created_at", [h.auth.organization.id])).rows.map((row) => row.kind);
      expect(audits).toEqual(expect.arrayContaining(["log-analysis-case-create", "log-analysis-case-run-start", "log-analysis-case-run-complete"]));
      await updateAnalysisCase(h.db, h.store, h.auth, h.skill.id, created.body.item.id, { name: "Edited", expectations }, h.invocation, h.context);
      expect((await listAnalysisCases(h.db, h.auth, h.skill.id)).current).toBe(false);
      await expect(updateAnalysisCase(h.db, h.store, h.auth, h.skill.id, created.body.item.id, { name: "Invalid", expectations: { ...expectations, keyEvidence: [{ file: "missing.log", line: 1 }] } }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(updateAnalysisCase(h.db, h.store, h.auth, h.skill.id, created.body.item.id, { name: "Invalid", expectations: { ...expectations, keyEvidence: [{ file: "thermal.log", line: 999 }] } }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(updateAnalysisCase(h.db, h.store, h.auth, h.skill.id, created.body.item.id, { name: "Invalid", expectations: invalidPattern }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED", message: expect.stringContaining("第 1 条关键证据的表达式") });
      for (const invalid of [
        { ...expectations, keyEvidence: [{ file: "thermal.log", line: 2 }] },
        { ...expectations, keyEvidenceLines: [2] },
        { ...expectations, keyEvidence: [{ file: "thermal.log", line: 1, pattern: "MISSING_PATTERN" }] }
      ]) await expect(updateAnalysisCase(h.db, h.store, h.auth, h.skill.id, created.body.item.id, { name: "Invalid anchor", expectations: invalid }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await deleteAnalysisCase(h.db, h.auth, h.skill.id, created.body.item.id, h.invocation, h.context);
      expect((await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id))).toEqual([]);
      expect((await h.db.query("select kind from audit_events where kind in ('log-analysis-case-update','log-analysis-case-delete')")).rows).toHaveLength(2);
    } finally { await h.close(); }
  }, 120_000);

  it("saves report expectations and the exact original ZIP bytes, and preserves real repository cases across persisted import/export", async () => {
    const h = await harness();
    try {
      const zip = new JSZip(); zip.file("device/thermal.log", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ERROR thermal foldback\r\n", "utf16le")])); zip.file("device/raw.bin", Buffer.from([0, 255, 17]));
      const original = await zip.generateAsync({ type: "nodebuffer" });
      const upload = await uploadLogFile(h.db, h.store, h.auth, { fileName: "device.zip", contentType: "application/zip", bytes: original, logDomainId: h.skill.id }, h.context);
      expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: upload.job!.id, analyzer: h.analyzer })).toEqual({ status: "processed" });
      const report = await getLogRecord(h.db, h.auth, upload.log.id);
      const prefill = await getAnalysisCasePrefill(h.db, h.auth, report.id);
      expect(prefill.expectations.rootCausePoints).toEqual([report.conclusion]);
      expect(prefill.expectations.expectedActions).toEqual(report.suggestedActions);
      expect(prefill.expectations.keyEvidence).toEqual(report.evidence.flatMap((e) => e.lineNumbers.map((line) => ({ file: e.filePath, line }))));
      expect(prefill.originalUploads).toEqual([{ fileName: "device.zip", sizeBytes: original.length }]);
      expect(prefill.files).toMatchObject([{ path: "device/thermal.log", status: "analyzed", lineCount: 1 }]);
      expect(prefill.files).toHaveLength(1);
      const saved = await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: prefill.name, expectations: prefill.expectations, sourceRecordId: report.id }, h.invocation, h.context);
      const stored = (await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id)).find((entry) => entry.id === saved.id)!;
      expect(stored.uploads).toHaveLength(1); expect(stored.files.map((file) => file.path)).toEqual(["device/thermal.log", "device/raw.bin"]);
      expect(await h.store.get(stored.uploads[0].objectKey)).toEqual(original);
      const savedExport = await exportSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id);
      const savedZip = await JSZip.loadAsync(savedExport);
      expect(await savedZip.file(`generic/${saved.id}/fixtures/device.zip`)!.async("nodebuffer")).toEqual(original);
      const savedProjection = await savedZip.file(`generic/${saved.id}/log.txt`)!.async("string");
      expect(savedProjection).toContain("ERROR thermal foldback");
      const cloned = await createLogFromFile(h.db, h.auth, { fileObjectId: upload.fileObject.id, fileName: upload.fileObject.fileName, logDomainId: h.skill.id }, h.context);
      expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: cloned.job!.id, analyzer: h.analyzer })).toEqual({ status: "processed" });
      const clonedPrefill = await getAnalysisCasePrefill(h.db, h.auth, cloned.log.id);
      const clonedCase = await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: clonedPrefill.name, expectations: clonedPrefill.expectations, sourceRecordId: cloned.log.id }, h.invocation, h.context);
      const clonedStored = (await readAnalysisCases(h.db, h.auth.organization.id, h.skill.id)).find((entry) => entry.id === clonedCase.id)!;
      expect(await h.store.get(clonedStored.uploads[0].objectKey)).toEqual(original);
      await deleteAnalysisCase(h.db, h.auth, h.skill.id, clonedCase.id, h.invocation, h.context);
      await expect(createAnalysisCase(h.db, h.store, h.other, h.skill.id, { name: prefill.name, expectations: prefill.expectations, sourceRecordId: report.id }, createUserInvocation(h.other), h.context)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await deleteAnalysisCase(h.db, h.auth, h.skill.id, saved.id, h.invocation, h.context);
      const importedSaved = await importSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id, savedExport, h.invocation, h.context);
      expect(importedSaved.items[0].name).toBe(saved.name);
      await deleteAnalysisCase(h.db, h.auth, h.skill.id, importedSaved.items[0].id, h.invocation, h.context);
      const utf16 = Buffer.concat([Buffer.from([255, 254]), Buffer.from("ERROR thermal foldback\r\n", "utf16le")]);
      const namedLog = await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Distinct author name", expectations, files: [{ fileName: "./log.txt", bytes: utf16 }] }, h.invocation, h.context);
      const namedExport = await JSZip.loadAsync(await exportSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id));
      expect(await namedExport.file(`generic/${namedLog.id}/fixtures/log.txt`)!.async("nodebuffer")).toEqual(utf16);
      expect(await namedExport.file(`generic/${namedLog.id}/log.txt`)!.async("string")).toBe("ERROR thermal foldback");
      await deleteAnalysisCase(h.db, h.auth, h.skill.id, namedLog.id, h.invocation, h.context);
      await expect(createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Bogus selection", expectations: { ...expectations, bundleFiles: ["absent.log"] }, files: [{ fileName: "log.txt", bytes: Buffer.from("ERROR thermal") }] }, h.invocation, h.context)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const fixtures = new JSZip(), expected: Record<string, Buffer> = {}, root = join(process.cwd(), "eval-cases/logs");
      for (const domain of readdirSync(root, { withFileTypes: true }).filter((file) => file.isDirectory())) for (const item of readdirSync(join(root, domain.name), { withFileTypes: true }).filter((file) => file.isDirectory())) {
        for (const file of ["case.yaml", "log.txt"]) { const path = `${domain.name}/${item.name}/${file}`, bytes = readFileSync(join(root, path)); expected[path] = bytes; fixtures.file(path, bytes, { createFolders: false }); }
      }
      const imported = await importSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id, await fixtures.generateAsync({ type: "nodebuffer" }), h.invocation, h.context);
      expect(imported.items.length).toBeGreaterThan(0);
      const keysBeforeDuplicate = [...h.store.entries.keys()].sort();
      await expect(importSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id, await fixtures.generateAsync({ type: "nodebuffer" }), h.invocation, h.context)).rejects.toMatchObject({ code: "CONFLICT" });
      expect([...h.store.entries.keys()].sort()).toEqual(keysBeforeDuplicate);
      const exported = await JSZip.loadAsync(await exportSkillAnalysisCases(h.db, h.store, h.auth, h.skill.id));
      expect(Object.keys(exported.files).sort()).toEqual(Object.keys(expected).sort());
      for (const [path, bytes] of Object.entries(expected)) expect(await exported.file(path)!.async("nodebuffer"), path).toEqual(bytes);
    } finally { await h.close(); }
  }, 120_000);

  it("scores file-aware precision over distinct cited positions while retaining anchor recall", async () => {
    const h = await harness();
    let includeHallucinatedFile = false;
    const analyzer: LogAnalysisAdapter = { analyze: async (input) => {
      const report = await h.analyzer.analyze(input);
      return { ...report, evidence: [...report.evidence, { stageId: "pattern", filePath: "thermal.log", lineNumbers: [1, 2, 2],
        inference: "Additional cited context", suggestedAction: "Review cited lines" },
        ...(includeHallucinatedFile ? [{ stageId: "pattern" as const, filePath: "missing.log", lineNumbers: [1],
          inference: "A citation whose line exists only in the other file", suggestedAction: "Inspect the source" }] : [])] };
    } };
    try {
      await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Precision", expectations: { ...expectations, keyEvidenceLines: [], keyEvidence: [{ file: "thermal.log", line: 1 }] },
        files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal foldback\nINFO unrelated event\n") }] }, h.invocation, h.context);
      const started = await startAnalysisCaseRun(h.db, h.store, analyzer, h.auth, h.skill.id, undefined, h.invocation, h.context);
      const run = await h.wait(started.run.id);
      expect(run.status).toBe("complete");
      expect(run.results[0].draft.quality).toMatchObject({ anchorEvidence: { precision: 0.5, recall: 1,
        hits: [{ file: "thermal.log", line: 1 }], misses: [], hallucinatedLines: [], hallucinationRate: 0 } });
      includeHallucinatedFile = true;
      const hallucinated = await startAnalysisCaseRun(h.db, h.store, analyzer, h.auth, h.skill.id, undefined, h.invocation, h.context);
      const second = await h.wait(hallucinated.run.id);
      expect(second.status).toBe("complete");
      expect(second.results[0].draft.quality).toMatchObject({ anchorEvidence: { precision: 1 / 3, recall: 1,
        hallucinatedLines: [{ file: "missing.log", line: 1 }], hallucinationRate: 1 / 3 } });
    } finally { await h.close(); }
  }, 120_000);

  it("prefills content refusals separately from source provider and budget degradation", async () => {
    const h = await harness();
    const scripted = (conclusion: string, maxSteps = 4) => createAgentLoopLogAnalyzer({ model: createScriptedLogAnalysisModel([
      { content: { action: "tool", tool: "read_line_range", args: { file: "prefill.log", startLine: 1, endLine: 1 } } },
      { content: { action: "final", conclusion, impact: "Investigate the device", confidence: 0.4, severity: "Warning",
        suggestedActions: ["Inspect the device"], evidence: [{ filePath: "prefill.log", lineNumbers: [1], inference: "The recorded event is grounded", suggestedAction: "Inspect the device" }] } }
    ]), modelLabel: "scripted", maxSteps, tokenBudget: 100_000 });
    const budgetAnalyzer = createLogAnalyzerFromEnv({ LOG_ANALYSIS_DETERMINISTIC: true, LOG_ANALYSIS_KERNEL: "loop", LOG_ANALYSIS_API_TIMEOUT_MS: 1000,
      LOG_ANALYSIS_TOKEN_BUDGET: 1, LOG_ANALYSIS_MAX_STEPS: 8 }, { db: h.db });
    try {
      for (const scenario of [
        { analyzer: h.analyzer, content: "INFO WISEEFF_SIMULATE_LLM_PROVIDER_DOWN\n", reason: "provider-unavailable", refused: false, source: "rules-fallback" },
        { analyzer: budgetAnalyzer, content: "INFO device event\n", reason: "token-budget-exhausted", refused: false, source: "rules-fallback" },
        { analyzer: scripted("Insufficient evidence to determine a root cause.", 1), content: "INFO device event\n", reason: "token-budget-exhausted", refused: false, source: "agent" },
        { analyzer: scripted("The thermal sensor failed."), content: "INFO device event\n", reason: undefined, refused: false, source: "agent" },
        { analyzer: scripted("Insufficient evidence to determine a root cause."), content: "INFO device event\n", reason: undefined, refused: true, source: "agent" }
      ]) {
        const uploaded = await uploadLogFile(h.db, h.store, h.auth, { fileName: "prefill.log", contentType: "text/plain", bytes: Buffer.from(scenario.content), logDomainId: h.skill.id }, h.context);
        expect(await processLogAnalysisJobById({ db: h.db, objectStore: h.store, jobId: uploaded.job!.id, analyzer: scenario.analyzer, maxAttempts: 1 })).toEqual({ status: "processed" });
        expect((await getLogRecord(h.db, h.auth, uploaded.log.id)).analysisSource).toBe(scenario.source);
        const prefill = await getAnalysisCasePrefill(h.db, h.auth, uploaded.log.id);
        expect(prefill.expectations.expectRefusal).toBe(scenario.refused);
        expect(prefill.expectations.expectedDegradedReason).toBeUndefined();
        expect(prefill.sourceDegradation).toEqual(scenario.reason ? { reason: scenario.reason, source: scenario.source } : undefined);
        expect(prefill.originalUploads).toEqual([{ fileName: "prefill.log", sizeBytes: Buffer.byteLength(scenario.content) }]);
      }
    } finally { await h.close(); }
  }, 120_000);

  it("shares atomic admission with sample dry runs and keeps a hung model counted after cancellation", async () => {
    const h = await harness();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const analyzer: LogAnalysisAdapter = { analyze: async (input) => { await blocked; return h.analyzer.analyze(input); } };
    try {
      await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Case", expectations, files: [{ fileName: "thermal.log", bytes: Buffer.from("ERROR thermal foldback\n") }] }, h.invocation, h.context);
      await replaceLogSkillSample(h.db, h.store, h.auth, h.skill.id, { fileName: "sample.log", contentBase64: Buffer.from("ERROR thermal").toString("base64") }, h.invocation, h.context);
      const started = await startAnalysisCaseRun(h.db, h.store, analyzer, h.auth, h.skill.id, undefined, h.invocation, h.context);
      await expect(startSkillDryRun(h.db, h.store, analyzer, h.auth, h.skill.id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      // Recovery expires the UI result but deliberately retains the provider's owner slot.
      await h.db.query("update log_skill_analysis_case_runs set deadline_at = now() - interval '1 second' where id=$1", [started.run.id]);
      expect((await getAnalysisCaseRun(h.db, h.auth, h.skill.id, started.run.id)).run.status).toBe("failed");
      await expect(startSkillDryRun(h.db, h.store, analyzer, h.auth, h.skill.id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      release();
      await vi.waitFor(async () => expect((await h.db.query<{ n: number }>("select count(*)::int n from pg_locks where locktype='advisory' and classid=7141230")).rows[0].n).toBe(0));
    } finally { release(); await h.close(); }
  }, 120_000);

  it("bounds parsed previews while the deterministic loop reads and scores evidence beyond the preview", async () => {
    const h = await harness();
    const previews: Array<{ lines: number; entries: number; bytes: number; lineCount?: number; entryCount?: number }> = [];
    const analyzer: LogAnalysisAdapter = { analyze: async (input) => {
      previews.push({ lines: input.parsed.rawLines.length, entries: input.parsed.entries.length,
        bytes: Buffer.byteLength(input.parsed.rawLines.join("\n")), lineCount: input.stats?.lineCount, entryCount: input.stats?.entryCount });
      return h.analyzer.analyze(input);
    } };
    try {
      const lines = Array<string>(50_000).fill("x"); lines[600] = "ERROR thermal foldback protection";
      await createAnalysisCase(h.db, h.store, h.auth, h.skill.id, { name: "Many short lines", expectations: { ...expectations, keyEvidenceLines: [601] },
        files: [{ fileName: "thermal.log", bytes: Buffer.from(`${lines.join("\n")}\n`) }] }, h.invocation, h.context);
      const started = await startAnalysisCaseRun(h.db, h.store, analyzer, h.auth, h.skill.id, undefined, h.invocation, h.context);
      const run = await h.wait(started.run.id);
      expect(run.status).toBe("complete"); expect(previews).toHaveLength(2);
      for (const preview of previews) {
        expect(preview.lines).toBeLessThanOrEqual(400); expect(preview.entries).toBeLessThanOrEqual(400);
        expect(preview.bytes).toBeLessThanOrEqual(128 * 1024);
        expect(preview.lineCount).toBe(50_000); expect(preview.entryCount).toBeGreaterThan(400);
      }
      expect(run.results[0].draft).toMatchObject({ passed: true, score: 100 });
      expect(run.results[0].draft.report.evidence.some((evidence) => evidence.lineNumbers.includes(601))).toBe(true);
    } finally { await h.close(); }
  }, 120_000);
});
