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
import { decodedEventSchema, parsingSpecSchema, type DecodedValue } from "./parsing/spec";
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
  it("decodes an uploaded frame into nested stored fields, agent tool results and report evidence", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodeframe");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Frame decoding" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "Frame samples" }, invocation, { requestId: "decode-frame" });
      const frameParsing = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", registers: {
        status: { width: 8, fields: [{ name: "code", bits: [3, 0], enum: { "15": "ready" } }] }
      }, frames: {
        sample: { fields: [{ name: "status", type: "register", register: "status", length: 1 }] },
        packet: { fields: [{ name: "count", type: "uint", length: 1 }, { name: "samples", type: "repeat", count: "count", frame: "sample" }] }
      }, extractors: [{ id: "packet", pattern: "data=(?P<payload>[0-9A-Fa-f]+)", fields: { payload: { type: "hex", decode: { frame: "packet" } } } }] });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing: frameParsing }, null, skill.currentRevision.id, invocation, { requestId: "decode-frame" });
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decode-frame" });
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "query_events", args: { extractor: "packet" } } },
        { content: { action: "final", conclusion: "Frame contains two samples", impact: "Second sample is ready", severity: "Info", confidence: 0.9,
          suggestedActions: ["Inspect the samples"], evidence: [{ filePath: "frame.log", lineNumbers: [1], inference: "Second status code is ready", suggestedAction: "Inspect status" }] } }
      ]);
      const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: "frame.log", contentType: "text/plain", bytes: Buffer.from("data=020a0f"), logDomainId: skill.id });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 3, tokenBudget: 100_000 }) })).toEqual({ status: "processed" });
      const report = await getLogRecord(db, auth, uploaded.log.id);
      expect(report.status).toBe("complete");
      expect(logRecordDtoSchema.safeParse(report).success).toBe(true);
      expect(report.evidence).toMatchObject([{ filePath: "frame.log", lineNumbers: [1], decodedFields: [{ fields: { payload: { fields: {
        count: { value: 2 }, samples: { fields: {
          "0": { fields: { status: { fields: { code: { value: 10 } } } } },
          "1": { fields: { status: { fields: { code: { value: 15, meaning: "ready" } } } } }
        } }
      } } } }] }]);
      const stored = (await db.query<{ decoded_events_object_key: string; decoded_event_counts: unknown }>(
        "select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
      expect(stored.decoded_event_counts).toEqual({ total: 1, byExtractor: { packet: 1 }, errors: {} });
      const artifact = gunzipSync(await objectStore.get(stored.decoded_events_object_key)).toString().trim().split("\n").map((line) => decodedEventSchema.parse(JSON.parse(line)));
      expect(artifact).toEqual(report.evidence[0].decodedFields);
      expect(model.calls[1].at(-1)?.content).toContain('"meaning":"ready"');
      expect((await db.query("select decoded_fields from log_evidence where run_id=$1", [uploaded.job!.runId])).rows).toEqual([{ decoded_fields: artifact }]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);

  it("decodes an uploaded BQ25890 register map into stored events and cited report fields", async () => {
    const ephemeral = await createEphemeralTestDatabase("decoderegister");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Register decoding" }, users: [{ id: auth.user.id, name: "Admin" }] });
      const skill = await createLogSkill(db, auth, { name: "BQ25890" }, invocation, { requestId: "decode-register" });
      const registerParsing = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "fault", pattern: "addr=(?P<addr>0x[0-9A-Fa-f]+) val=(?P<val>0x[0-9A-Fa-f]+)",
        fields: { addr: { type: "uint" }, val: { type: "hex", decode: { registerMap: "charger" } } } }],
      registers: { REG0C: { width: 8, fields: [
        { bits: [7, 7], name: "WATCHDOG_FAULT" }, { bits: [6, 6], name: "BOOST_FAULT" },
        { bits: [5, 4], name: "CHRG_FAULT", enum: { "0": "normal", "1": "input_fault", "2": "thermal_shutdown", "3": "safety_timer" } },
        { bits: [3, 3], name: "BAT_FAULT" }, { bits: [2, 0], name: "NTC_FAULT" }
      ] } }, registerMaps: { charger: { selectBy: "addr", cases: { "0x0C": "REG0C" } } } });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing: registerParsing }, null, skill.currentRevision.id, invocation, { requestId: "decode-register" });
      await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decode-register" });
      const model = createScriptedLogAnalysisModel([
        { content: { action: "tool", tool: "query_events", args: { extractor: "fault" } } },
        { content: { action: "final", conclusion: "Charger thermal shutdown", impact: "Charging stopped", severity: "Warning", confidence: 0.9,
          suggestedActions: ["Inspect charger temperature"], evidence: [{ filePath: "charger.log", lineNumbers: [1], inference: "CHRG_FAULT is thermal_shutdown", suggestedAction: "Inspect cooling" }] } }
      ]);
      const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: "charger.log", contentType: "text/plain", bytes: Buffer.from("addr=0x0C val=0x20"), logDomainId: skill.id });
      expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
        analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 3, tokenBudget: 100_000 }) })).toEqual({ status: "processed" });
      const report = await getLogRecord(db, auth, uploaded.log.id);
      expect(report.status).toBe("complete");
      expect(logRecordDtoSchema.safeParse(report).success).toBe(true);
      const expectedEvent = { file: "charger.log", line: 1, extractor: "fault", fields: { val: { raw: "0x20", value: 32, fields: {
        CHRG_FAULT: { value: 2, meaning: "thermal_shutdown" }, WATCHDOG_FAULT: { value: 0 }, NTC_FAULT: { value: 0 }
      } } } };
      expect(report.evidence).toMatchObject([{ filePath: "charger.log", lineNumbers: [1], decodedFields: [expectedEvent] }]);
      const stored = (await db.query<{ decoded_events_object_key: string; decoded_event_counts: unknown }>(
        "select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
      expect(stored.decoded_event_counts).toEqual({ total: 1, byExtractor: { fault: 1 }, errors: {} });
      const artifact = gunzipSync(await objectStore.get(stored.decoded_events_object_key)).toString().trim().split("\n").map((line) => decodedEventSchema.parse(JSON.parse(line)));
      expect(artifact).toEqual(report.evidence[0].decodedFields);
      expect(model.calls[1].at(-1)?.content).toContain('"meaning":"thermal_shutdown"');
      expect((await db.query("select decoded_fields from log_evidence where run_id=$1", [uploaded.job!.runId])).rows)
        .toEqual([{ decoded_fields: artifact }]);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
  it("bounds register-expanded bundle artifacts, persists truncation and cites completed fields", async () => {
    const ephemeral = await createEphemeralTestDatabase("decodeoutput");
    const db = createPostgresDatabase(ephemeral.url), objectStore = createMemoryObjectStore();
    const auth = authFor(), invocation = createUserInvocation(auth);
    const countFields = (fields: Record<string, DecodedValue>): number => Object.values(fields).reduce<number>((total, value) => total + 1
      + (value && typeof value === "object" && "fields" in value && value.fields ? countFields(value.fields) : 0), 0);
    try {
      await seedCoreGraph(db, { organization: { id: auth.organization.id, name: "Output budgets" }, users: [{ id: auth.user.id, name: "Admin" }] });
      for (const reason of ["output_field_cap", "output_byte_cap"] as const) {
        const skill = await createLogSkill(db, auth, { name: reason }, invocation, { requestId: "decode-output" });
        const bounded = parsingSpecSchema.parse({ schemaVersion: "parsing/v1", extractors: [{ id: "bits", pattern: "(?P<value>1)",
          fields: { value: { type: "uint", decode: { register: "wide" } } } }], registers: { wide: { width: 64,
          fields: Array.from({ length: 64 }, (_, bit) => ({ bits: [bit, bit], name: `BIT${bit}`,
            ...(reason === "output_byte_cap" ? { enum: { "0": "zero".repeat(32), "1": "one_".repeat(32) } } : {}) })) } } });
        const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing: bounded }, null, skill.currentRevision.id, invocation, { requestId: "decode-output" });
        await publishLogSkill(db, auth, skill.id, draft.id, invocation, { requestId: "decode-output" });
        const zip = new JSZip();
        zip.file("a.log", Array(500).fill("1").join("\n")); zip.file("b.log", Array(500).fill("1").join("\n"));
        const uploaded = await uploadLogFile(db, objectStore, auth, { fileName: `${reason}.zip`, contentType: "application/zip",
          bytes: await zip.generateAsync({ type: "nodebuffer" }), logDomainId: skill.id });
        const model = createScriptedLogAnalysisModel([
          { content: { action: "tool", tool: "query_events", args: { extractor: "bits", limit: 1 } } },
          { content: { action: "final", conclusion: "The first register has its low bit set", impact: "Register state", severity: "Info", confidence: 0.9,
            suggestedActions: ["Inspect later raw lines because decoding was bounded"], evidence: [{ filePath: "a.log", lineNumbers: [1],
              inference: "BIT0 is 1", suggestedAction: "Check the raw register dump" }] } }
        ]);
        expect(await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
          analyzer: createAgentLoopLogAnalyzer({ model, modelLabel: "scripted", maxSteps: 3, tokenBudget: 100_000 }) })).toEqual({ status: "processed" });
        const stored = (await db.query<{ decoded_events_object_key: string; decoded_event_counts: { total: number; errors: Record<string, number>; truncated?: boolean; reason?: string } }>(
          "select decoded_events_object_key, decoded_event_counts from log_analysis_runs where id=$1", [uploaded.job!.runId])).rows[0];
        expect(stored.decoded_event_counts).toMatchObject({ truncated: true, reason, errors: { [reason]: 1 } });
        expect(stored.decoded_event_counts.total).toBeGreaterThan(0);
        expect(stored.decoded_event_counts.total).toBeLessThan(1000);
        const jsonl = gunzipSync(await objectStore.get(stored.decoded_events_object_key));
        expect(jsonl.byteLength).toBeLessThanOrEqual(4 * 1024 * 1024);
        const events = jsonl.toString().trim().split("\n").map((line) => decodedEventSchema.parse(JSON.parse(line)));
        expect(events).toHaveLength(stored.decoded_event_counts.total);
        expect(events.reduce((total, event) => total + countFields(event.fields), 0)).toBeLessThanOrEqual(32_768);
        expect(events.every((event) => Buffer.byteLength(JSON.stringify(event)) <= 32 * 1024)).toBe(true);
        const report = await getLogRecord(db, auth, uploaded.log.id);
        expect(report.status).toBe("complete");
        expect(report.evidence).toMatchObject([{ filePath: "a.log", lineNumbers: [1], decodedFields: [{ fields: {
          value: { value: 1, fields: { BIT0: { value: 1 }, BIT63: { value: 0 } } }
        } }] }]);
        expect(report.evidence[0].decodedFields?.[0]).toEqual(events[0]);
        expect(model.calls[1].at(-1)?.content).toContain(reason);
      }
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
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
      const plain = await uploadLogFile(db, objectStore, auth, { fileName: "plain.log", contentType: "text/plain", skillSelection: "generic", bytes: Buffer.from("ERROR code=E_THERMAL_FOLDBACK charge_current_ma=2000") });
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
      const extractorPath = `/api/v1/log-skills/${skill.id}/extractor-preview`;
      const formatPath = `/api/v1/log-skills/${skill.id}/format-preview`;
      const extractorInput = { line: "vbus=9012", segments: [{ start: 5, end: 9, name: "voltage", type: "uint" }], sampleLines: ["vbus=5000", "ibus=5000"] };
      const formatInput = { sampleText: "[12] ERROR bad\n  detail\n[13] INFO ready", formatProfile: { timestampPattern: "^\\[(\\d+)\\]", multiline: { mode: "indent" } } };
      const oversizedProgram = `(?:${"a".repeat(1000)}){1000}`;
      const unsafeProfile = { severityMap: { error: Array(4).fill(oversizedProgram) } };
      expect(await request(formatPath, { sampleText: "a", formatProfile: unsafeProfile })).toMatchObject({ status: 400,
        body: { error: { code: "VALIDATION_FAILED", message: expect.stringContaining("severityMap.error[0]") } } });
      expect(await request(`/api/v1/log-skills/${skill.id}/draft`, {
        spec: { schemaVersion: "skill/v1", formatProfile: unsafeProfile }, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id
      }, "PUT")).toMatchObject({ status: 400,
        body: { error: { details: { issues: [expect.objectContaining({ path: ["spec", "formatProfile", "severityMap", "error", 0] })] } } } });
      expect(await request(extractorPath, extractorInput)).toMatchObject({ status: 200, body: {
        pattern: "^vbus=(?P<voltage>\\d+)$", fields: { voltage: { type: "uint" } }, matchCount: 1, coverage: 0.5,
        matchedLines: [{ line: 1, text: "vbus=5000" }]
      } });
      expect(await request(formatPath, formatInput)).toMatchObject({ status: 200, body: {
        lines: [{ line: 1, timestamp: "12", severity: "error" }, { line: 2, severity: "info" }, { line: 3, timestamp: "13", severity: "info" }],
        entries: [{ lineNumbers: [1, 2], text: "ERROR bad\ndetail" }, { lineNumbers: [3], text: "INFO ready" }]
      } });
      expect((await request(extractorPath, { ...extractorInput, pattern: "(?=x)" })).status).toBe(400);
      expect((await request(extractorPath, { ...extractorInput, sampleLines: Array(501).fill("x") })).status).toBe(400);
      expect((await request(formatPath, { ...formatInput, formatProfile: { timestampPattern: "(?=x)" } })).status).toBe(400);
      expect((await request(formatPath, { ...formatInput, sampleText: "x\n".repeat(501) })).status).toBe(400);
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
      expect((await request(extractorPath, extractorInput)).status).toBe(404);
      expect((await request(formatPath, formatInput)).status).toBe(404);
      auth = authFor("decode-org", false); expect((await request(path, { parsing, sampleText: "x" })).status).toBe(403);
      expect((await request(extractorPath, extractorInput)).status).toBe(403);
      expect((await request(formatPath, formatInput)).status).toBe(403);
      auth = authFor();
      const invalid = { schemaVersion: "skill/v1", parsing: { ...parsing, frames: { broken: { fields: [{ name: "bad", type: "uint", length: 3 }] } } } };
      expect(await request(`/api/v1/log-skills/${skill.id}/draft`, { spec: invalid, baseDraftRevisionId: null, basePublishedRevisionId: skill.currentRevision.id }, "PUT"))
        .toMatchObject({ status: 400, body: { error: { details: { issues: [expect.objectContaining({ path: ["spec", "parsing", "frames", "broken", "fields", 0, "length"] })] } } } });
      const draft = await saveLogSkillDraft(db, auth, skill.id, { schemaVersion: "skill/v1", parsing }, null, skill.currentRevision.id, createUserInvocation(auth), { requestId: "decoding-test" });
      // Simulate an obsolete invalid draft written before current validation.
      await db.query("update log_skill_revisions set spec=$2::jsonb where id=$1", [draft.id, JSON.stringify(invalid)]);
      expect((await request(`/api/v1/log-skills/${skill.id}/publish`, { draftRevisionId: draft.id })).status).toBe(400);
    } finally { await db.close(); await ephemeral.drop(); }
  }, 120_000);
});
