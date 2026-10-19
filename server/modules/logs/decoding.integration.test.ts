import JSZip from "jszip";
import { gunzipSync } from "node:zlib";
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
import { createLogSkill, saveLogSkillDraft, publishLogSkill, PARSE_PREVIEW_MAX_MS } from "./skillsService";
import { getLogRecord, uploadLogFile } from "./service";
import { processLogAnalysisJobById } from "./worker";
import { createAgentLoopLogAnalyzer } from "./analyzer/agentLoop";
import { createLlmLogAnalyzer, LogAnalysisProviderError } from "./analyzer/llmAnalyzer";
import { createScriptedLogAnalysisModel } from "./analyzer/scriptedModel";
import { createRuleBasedLogAnalyzer } from "./analyzer";
import { decodedEventSchema, parsingSpecSchema } from "./parsing/spec";
import { logRecordDtoSchema } from "../contracts/dtoSchemas/logs";
import * as workerDecoding from "./parsing/workerDecoding";
import { loadLogFiles } from "./filesRepository";
import { ensureStoredLogIndex } from "./fileReader";

const available = await isTestDatabaseAvailable();
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const authFor = (organizationId = "decode-org", admin = true) => makeTestAuthContext({ organizationId, userId: `${organizationId}-admin`,
  roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze", ...(admin ? ["logs:admin-domains"] : [])] });
const parsing = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "current", pattern: "charge_current_ma=(?P<current>\\d+)", fields: { current: { type: "uint" } } }] });

describe.skipIf(!available)("decoded event runs and preview over PostgreSQL", () => {
  it("persists failed artifact counters without a key, cleans partial uploads and completes without decoded evidence", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodeartifact");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Artifacts" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "Artifacts" }, invocation, { requestId: "decode-artifact" });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing }, null, skill.currentRevision.id, invocation, { requestId: "decode-artifact" });
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decode-artifact" });
      for (const failure of ["compression", "upload"]) {
        const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: `${failure}.log`, contentType: "text/plain", bytes: Buffer.from("ERROR code=E_THERMAL_FOLDBACK charge_current_ma=2000"), logDomainId: skill.id });
        // Isolate decoded-artifact failure injection from the separate line-index upload.
        for (const file of await loadLogFiles(db, auth.organization.id, uploaded.log.id)) {
          await ensureStoredLogIndex(db, objectStore, auth.organization.id, uploaded.log.id, file);
        }
        const before = objectStore.entries.size;
        const originalPut = objectStore.put.bind(objectStore);
        const broken = failure === "compression" ? vi.spyOn(workerDecoding, "gzipDecodedEvents").mockRejectedValueOnce(new Error("Compression failed"))
          : vi.spyOn(objectStore, "put").mockImplementationOnce(async (input) => { await originalPut(input); throw new Error("Upload response lost"); });
        try { expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id })).toEqual({ status: "processed" }); }
        finally { broken.mockRestore(); }
        const report = await getLogRecord(db, auth, uploaded.log.id);
        expect(report.status).toBe("complete");
        expect(report.evidence.length).toBeGreaterThan(0);
        expect(report.evidence.every((e) => e.decodedFields === undefined)).toBe(true);
        expect((await db.query("select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows)
          .toEqual([{ decoded_events_object_key: null, decoded_event_counts: { total: 1, byExtractor: { current: 1 }, errors: { artifact_error: 1 } } }]);
        expect(objectStore.entries.size).toBe(before);
      }
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
  it("finishes runs with env event/time caps and persists partial streamed artifacts and counters", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodecaps");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Caps" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "Caps" }, invocation, { requestId: "decode-caps" });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing }, null, skill.currentRevision.id, invocation, { requestId: "decode-caps" });
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decode-caps" });
      for (const cap of ["event_cap", "time_cap"]) {
        vi.stubEnv("LOG_DECODE_MAX_EVENTS", cap === "event_cap" ? "3" : "50000");
        vi.stubEnv("LOG_DECODE_MAX_MS", cap === "time_cap" ? "5" : "60000");
        const zip = new JSZip();
        zip.file("a.log", Array(4000).fill("charge_current_ma=2000").join("\n"));
        zip.file("b.log", Array(2000).fill("charge_current_ma=1000").join("\n"));
        const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: "capped.zip", contentType: "application/zip", bytes: await zip.generateAsync({ type: "nodebuffer" }), logDomainId: skill.id });
        // Only the worker's monotonic decode clock advances; PostgreSQL lease time stays real.
        let time = 0;
        const clock = cap === "time_cap" ? vi.spyOn(performance, "now").mockImplementation(() => time++ / 4000) : undefined;
        try { expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id })).toEqual({ status: "processed" }); }
        finally { clock?.mockRestore(); }
        expect((await getLogRecord(db, auth, uploaded.log.id)).status).toBe("complete");
        const stored = (await db.query<{ decoded_event_counts: { total: number; errors: Record<string, number> }; decoded_events_object_key: string }>(
          "select decoded_event_counts, decoded_events_object_key from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
        const counts = stored.decoded_event_counts;
        expect(counts.total).toBeGreaterThan(0); expect(counts.total).toBeLessThan(6000);
        expect(counts.errors).toEqual(cap === "event_cap" ? { event_cap: 5997 } : { time_cap: 1 });
        if (cap === "event_cap") expect(counts.total).toBe(3);
        const events = gunzipSync(await objectStore.get(stored.decoded_events_object_key)).toString().trim().split("\n").map((line) => decodedEventSchema.parse(JSON.parse(line)));
        expect(events).toHaveLength(counts.total);
        expect(events[0]).toMatchObject({ file: "a.log", line: 1, fields: { current: { value: 2000 } } });
      }
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
  it("pins extractors, stores gzip JSONL and counts, grounds query results, and decorates every analyzer path", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodedruns");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Decoding" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "Current" }, invocation, { requestId: "decoding-test" });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing }, null, skill.currentRevision.id, invocation, { requestId: "decoding-test" });
      const published = await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decoding-test" });
      // Later draft edits must never change the run's pinned extraction.
      await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing: { schemaVersion: "parsing/v1", extractors: [] } }, null, published.currentRevision.id, invocation, { requestId: "decoding-test" });
      const final = { action: "final", conclusion: "Decoded current is 2000 mA", impact: "Charging", severity: "Warning", confidence: 0.9,
        suggestedActions: ["Inspect cooling"], evidence: [{ filePath: "device/a.log", lineNumbers: [2], inference: "Current equals 2000", suggestedAction: "Inspect cooling" }] };
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "describe_event_schema", args: {} } },
        { content: { action: "tool", tool: "query_events", args: { extractor: "current", file: "device/a.log", where: [{ field: "current", op: "gte", value: 1000 }] } } },
        { content: final }
      ]);
      const adapters = [createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 4, tokenBudget: 100_000 }),
        createLlmLogAnalyzer({ model: createScriptedLogAnalysisModel([{ content: final }]), modelLabel: "single", tokenBudget: 8000 }), createRuleBasedLogAnalyzer()];
      for (const analyzer of adapters) {
        const zip = new JSZip(); zip.file("device/a.log", "INFO boot\nERROR code=E_THERMAL_FOLDBACK charge_current_ma=2000"); zip.file("device/b.log", "INFO idle");
        const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: "bundle.zip", contentType: "application/zip", bytes: await zip.generateAsync({ type: "nodebuffer" }), logDomainId: skill.id });
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id, analyzer })).toEqual({ status: "processed" });
        const report = await getLogRecord(db, auth, uploaded.log.id);
        expect(report.status).toBe("complete");
        expect(logRecordDtoSchema.safeParse(report).success).toBe(true);
        expect(report.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: "device/a.log", decodedFields: [expect.objectContaining({
          v: 1, source: "declarative", file: "device/a.log", line: 2, extractor: "current", fields: { current: { raw: "2000", value: 2000 } }
        })] })]));
        const stored = (await db.query<{ decoded_events_object_key: string; decoded_event_counts: unknown; skill_revision_id: string }>(
          "select decoded_events_object_key, decoded_event_counts, skill_revision_id from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
        expect(stored.skill_revision_id).toBe(published.currentRevision.id);
        expect(stored.decoded_event_counts).toEqual({ total: 1, byExtractor: { current: 1 }, errors: {} });
        const artifact = gunzipSync(await objectStore.get(stored.decoded_events_object_key)).toString("utf8").trim().split("\n").map((line) => decodedEventSchema.parse(JSON.parse(line)));
        expect(artifact).toEqual(report.evidence.find((evidence) => evidence.decodedFields)?.decodedFields);
        expect((await db.query("select decoded_fields from log_evidence where run_id=$1 and decoded_fields is not null", [uploaded.job!.runId])).rows).not.toHaveLength(0);
      }
      expect(model.calls[2].at(-1)?.content).toContain('"raw":"2000","value":2000');
      const retrying = await uploadLogFile(db, objectStore, auth, { fileName: "retry.log", contentType: "text/plain", bytes: Buffer.from("charge_current_ma=1000"), logDomainId: skill.id });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: retrying.job!.id, analyzer: { analyze: async () => { throw new LogAnalysisProviderError("provider offline"); } } })).toMatchObject({ status: "retry" });
      const retryArtifact = (await db.query<{ decoded_events_object_key: string; decoded_event_counts: { total: number } }>("select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [retrying.job!.runId])).rows[0];
      expect(retryArtifact.decoded_event_counts.total).toBe(1);
      expect(gunzipSync(await objectStore.get(retryArtifact.decoded_events_object_key)).toString()).toContain('"file":"retry.log"');
      const plain = await uploadLogFile(db, objectStore, auth, { fileName: "plain.log", contentType: "text/plain", bytes: Buffer.from("ERROR code=E_THERMAL_FOLDBACK charge_current_ma=2000") });
      for (const file of await loadLogFiles(db, auth.organization.id, plain.log.id)) {
        await ensureStoredLogIndex(db, objectStore, auth.organization.id, plain.log.id, file);
      }
      const before = objectStore.entries.size;
      await processLogAnalysisJobById({ db, objectStore, jobId: plain.job!.id });
      expect(objectStore.entries.size).toBe(before);
      expect((await getLogRecord(db, auth, plain.log.id)).evidence.every((e) => e.decodedFields === undefined)).toBe(true);
      expect((await db.query("select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [plain.job!.runId])).rows)
        .toEqual([{ decoded_events_object_key: null, decoded_event_counts: null }]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("previews unsaved rules with paths and caps, enforces admin and tenant scope, and validates save/publish", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodepreview");
    const db = createPostgresDatabase(ephemeral.url);
    let auth = authFor();
    try {
      for (const id of ["decode-org", "other-org"]) await seedCoreGraph(db, { organization: { id, name: id }, users: [{ id: `${id}-admin`, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "Preview" }, createUserInvocation(auth), { requestId: "decoding-test" });
      const router = createRouter(); registerLogRoutes(router, { db, getCurrentAuthContext: () => auth });
      const request = <T,>(path: string, body: unknown, method = "POST") => requestJson<T>(createHttpServer(router), path, { method, body: JSON.stringify(body) });
      const path = `/api/v1/log-skills/${skill.id}/parse-preview`;
      const countAudits = async () => (await db.query("select id from audit_events")).rows.length;
      const before = await countAudits();
      expect(await request(path, { parsing, sampleText: "charge_current_ma=2000\nunmatched", fileName: "device.log" })).toMatchObject({ status: 200, body: { valid: true,
        events: [{ file: "device.log", line: 1, fields: { current: { value: 2000 } } }], unmatchedLineCount: 1, counts: { total: 1 } } });
      expect((await request<{ events: unknown[]; counts: { total: number } }>(path, { parsing, sampleText: Array(600).fill("charge_current_ma=1").join("\n") })).body)
        .toMatchObject({ events: expect.any(Array), counts: { total: 600 } });
      expect((await request<{ events: unknown[] }>(path, { parsing, sampleText: Array(501).fill("charge_current_ma=1").join("\n") })).body.events).toHaveLength(500);
      expect(await request(path, { parsing: { ...parsing, extractors: [{ ...parsing.extractors[0], fields: {} }] }, sampleText: "x" })).toMatchObject({ status: 200,
        body: { valid: false, issues: [expect.objectContaining({ path: ["extractors", 0, "fields", "current"] })], events: [] } });
      expect(await countAudits()).toBe(before);
      for (const sampleText of ["a".repeat(1024 * 1024 + 1), "界".repeat(400_000)]) expect((await request(path, { parsing, sampleText })).status).toBe(400);
      const decode = workerDecoding.decodeLogFilesCooperatively;
      // Isolate the line bound from host scheduling; time/watchdog bounds have separate tests.
      const clock = vi.spyOn(workerDecoding, "decodeLogFilesCooperatively").mockImplementationOnce((spec, files, options) =>
        decode(spec, files, { ...options, maxMs: PARSE_PREVIEW_MAX_MS, now: () => 0, hardTimeout: false }));
      try {
        expect(await request(path, { parsing, sampleText: "a\n".repeat(5000) })).toMatchObject({ status: 200, body: { truncated: true, reason: "line_cap" } });
      } finally { clock.mockRestore(); }
      auth = authFor("other-org"); expect((await request(path, { parsing, sampleText: "x" })).status).toBe(404);
      auth = authFor("decode-org", false); expect((await request(path, { parsing, sampleText: "x" })).status).toBe(403);
      auth = authFor();
      const invalid = { schemaVersion: "skill/v1", parsing: { ...parsing, registers: {} } };
      expect(await request(`/api/v1/log-skills/${skill.id}/draft`, { spec: invalid, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id }, "PUT"))
        .toMatchObject({ status: 400, body: { error: { details: { issues: [expect.objectContaining({ path: ["spec", "parsing"] })] } } } });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing }, null, skill.currentRevision.id, createUserInvocation(auth), { requestId: "decoding-test" });
      // Simulate an obsolete invalid draft written before current validation.
      await db.query("update log_skill_revisions set spec=$2::jsonb where id=$1", [draft.id, JSON.stringify(invalid)]);
      expect((await request(`/api/v1/log-skills/${skill.id}/publish`, { draftRevisionId: draft.id })).status).toBe(400);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
