import { setTimeout as delay } from "node:timers/promises";
import type { Readable } from "node:stream";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { createEphemeralTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createPostgresDatabase, type RootDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { makeTestAuthContext } from "../../testing/authContext";
import { createMemoryObjectStore } from "../../testing/objectStore";
import { createRuleBasedLogAnalyzer, type AnalyzeLogInput } from "./analyzer";
import { getLogRecord, uploadLogFile } from "./service";
import { processLogAnalysisJobById } from "./worker";
import type { ObjectStore } from "./objectStore";
import { listUserNotifications } from "../notifications/service";
import { createLogDomainRecord } from "./domainsService";

const available = await isTestDatabaseAvailable();

type Fixture = {
  db: RootDatabase;
  auth: ReturnType<typeof makeTestAuthContext>;
  store: ReturnType<typeof createMemoryObjectStore>;
};

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const ephemeral = await createEphemeralTestDatabase("loglease");
  const db = createPostgresDatabase(ephemeral.url);
  const auth = makeTestAuthContext({ organizationId: "lease-org", userId: "lease-admin",
    roles: [{ roleId: "admin", projectId: null }], permissions: ["logs:view", "logs:upload", "logs:analyze"] });
  try {
    await seedCoreGraph(db, { organization: { id: auth.organization.id }, users: [{ id: auth.user.id }] });
    await run({ db, auth, store: createMemoryObjectStore() });
  } finally { await db.close(); await ephemeral.drop(); }
}

async function uploadSingle({ db, auth, store }: Fixture) {
  return uploadLogFile(db, store, auth, { fileName: "lease.log", contentType: "text/plain", bytes: Buffer.from("INFO boot\nERROR code=E_TEST\n") });
}

function abortSignal(input: AnalyzeLogInput): AbortSignal {
  const signal = (input as AnalyzeLogInput & { signal?: AbortSignal }).signal;
  expect(signal, "Worker must propagate cancellation to the analyzer").toBeDefined();
  return signal!;
}

describe.skipIf(!available)("log worker lease heartbeat over PostgreSQL", () => {
  it("notifies the actual submitter and wakes the durable webhook after final analysis failure", async () => {
    await withFixture(async fixture => {
      const { db, auth, store } = fixture;
      const domain = await createLogDomainRecord(db, { ...auth, permissions: [...auth.permissions, "logs:admin-domains"] }, { name: "Failure notifications" }, { requestId: "failure-notification-test" });
      await db.query("update log_domains set webhook_enabled=true,webhook_url='https://callback.example.test/hook',webhook_secret='isolated-test-secret' where id=$1", [domain.id]);
      const uploaded = await uploadLogFile(db, store, auth, { fileName: "failure.log", contentType: "text/plain", bytes: Buffer.from("ERROR controlled failure\n"), logDomainId: domain.id });
      const metrics = { recordLogAnalysisJobResult: vi.fn() }, webhooks = { notifyAnalysisTerminal: vi.fn() };
      const result = await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job!.id, maxAttempts: 1, metrics, webhooks,
        analyzer: { async analyze() { throw new Error("Controlled final analyzer failure"); } } });
      expect(result.status).toBe("dead-lettered");
      expect((await getLogRecord(db, auth, uploaded.log.id)).status).toBe("failed");
      expect((await db.query("select status,lease_owner,lease_expires_at from jobs where id=$1", [uploaded.job!.id])).rows).toEqual([{ status: "failed", lease_owner: null, lease_expires_at: null }]);
      const notifications = await listUserNotifications(db, { organizationId: auth.organization.id, recipientUserId: auth.user.id });
      expect(notifications.items).toContainEqual(expect.objectContaining({ category: "log.analysis.failed", body: expect.stringContaining("Controlled final analyzer failure") }));
      expect((await db.query("select status,payload->>'status' as result from log_webhook_outbox where log_record_id=$1", [uploaded.log.id])).rows).toEqual([{ status: "pending", result: "failed" }]);
      expect(webhooks.notifyAnalysisTerminal).toHaveBeenCalledWith(expect.objectContaining({ logId: uploaded.log.id, status: "failed" }));
      expect(metrics.recordLogAnalysisJobResult).toHaveBeenCalledWith(expect.objectContaining({ status: "dead_lettered" }));
    });
  });
  it("completes analysis longer than its lease without reclaiming the job", async () => {
    await withFixture(async (fixture) => {
      const { db, auth, store } = fixture;
      const uploaded = await uploadSingle(fixture);
      const baseline = createRuleBasedLogAnalyzer();
      const started = performance.now();
      const result = await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job!.id,
        leaseTtlMs: 1_200, maxJobMs: 10_000,
        analyzer: { async analyze(input) {
          await delay(2_200, undefined, { signal: abortSignal(input) });
          return baseline.analyze(input);
        } } });
      expect(result).toEqual({ status: "processed" });
      expect(performance.now() - started).toBeGreaterThan(1_200);
      expect((await getLogRecord(db, auth, uploaded.log.id)).status).toBe("complete");
      expect((await db.query("select status, attempt_count from jobs where id=$1", [uploaded.job!.id])).rows)
        .toEqual([{ status: "complete", attempt_count: 1 }]);
    });
  }, 20_000);

  it("aborts promptly after another owner takes the lease and leaves that owner's job untouched", async () => {
    await withFixture(async (fixture) => {
      const { db, store } = fixture;
      const uploaded = await uploadSingle(fixture);
      let aborted = false;
      const started = performance.now();
      const result = await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job!.id,
        leaseTtlMs: 1_200, maxJobMs: 10_000,
        analyzer: { async analyze(input) {
          const signal = abortSignal(input);
          signal.addEventListener("abort", () => { aborted = true; }, { once: true });
          await db.query("update jobs set lease_owner='replacement-worker', lease_expires_at=now()+interval '1 minute' where id=$1", [uploaded.job!.id]);
          await delay(10_000, undefined, { signal });
          return createRuleBasedLogAnalyzer().analyze(input);
        } } });
      expect(result).toEqual({ status: "idle" });
      expect(aborted).toBe(true);
      expect(performance.now() - started).toBeLessThan(3_000);
      expect((await db.query("select status, lease_owner, attempt_count from jobs where id=$1", [uploaded.job!.id])).rows)
        .toEqual([{ status: "processing", lease_owner: "replacement-worker", attempt_count: 1 }]);
      expect((await db.query("select id from log_analysis_reports where log_record_id=$1", [uploaded.log.id])).rows).toHaveLength(0);
    });
  }, 15_000);

  it("cancels work at the fixed job wall deadline instead of renewing forever", async () => {
    await withFixture(async (fixture) => {
      const { db, store } = fixture;
      const uploaded = await uploadSingle(fixture);
      let aborted = false;
      const started = performance.now();
      const result = await processLogAnalysisJobById({ db, objectStore: store, jobId: uploaded.job!.id,
        leaseTtlMs: 3_000, maxJobMs: 800,
        analyzer: { async analyze(input) {
          const signal = abortSignal(input);
          signal.addEventListener("abort", () => { aborted = true; }, { once: true });
          await delay(10_000, undefined, { signal });
          return createRuleBasedLogAnalyzer().analyze(input);
        } } });
      expect(["retry", "dead-lettered"]).toContain(result.status);
      expect(aborted).toBe(true);
      expect(performance.now() - started).toBeLessThan(3_000);
      expect((await db.query("select id from log_analysis_reports where log_record_id=$1", [uploaded.log.id])).rows).toHaveLength(0);
    });
  }, 15_000);

  it("cancels a stalled preprocessing GET at the job deadline without reaching analysis or writing indexes", async () => {
    await withFixture(async (fixture) => {
      const { db, store } = fixture;
      const uploaded = await uploadSingle(fixture);
      let reads = 0, writes = 0, analyzerCalls = 0;
      const objectStore: ObjectStore = { ...store,
        getStream() { reads++; return new Promise<Readable>(() => undefined); },
        put(input) { writes++; return store.put(input); }
      };
      const started = performance.now();
      const result = await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
        leaseTtlMs: 3_000, maxJobMs: 500,
        analyzer: { async analyze(input) { analyzerCalls++; return createRuleBasedLogAnalyzer().analyze(input); } } });
      expect(["retry", "dead-lettered"]).toContain(result.status);
      expect(performance.now() - started).toBeLessThan(2_000);
      expect(reads).toBeGreaterThan(0);
      expect(analyzerCalls).toBe(0);
      await delay(50);
      expect(writes).toBe(0);
      expect((await db.query("select id from log_analysis_reports where log_record_id=$1", [uploaded.log.id])).rows).toHaveLength(0);
      expect((await db.query("select line_index_key from log_files where record_id=$1", [uploaded.log.id])).rows)
        .toEqual([{ line_index_key: null }]);
    });
  }, 10_000);

  it("finishes a 2,000-file bundle with 20 ms object reads within its job bound", async () => {
    await withFixture(async ({ db, auth, store }) => {
      const archive = new JSZip();
      for (let index = 0; index < 2_000; index++) archive.file(`${String(index).padStart(4, "0")}.log`, "INFO healthy\n");
      const uploaded = await uploadLogFile(db, store, auth, { fileName: "slow-2000.zip", contentType: "application/zip",
        bytes: await archive.generateAsync({ type: "nodebuffer" }) });
      expect(uploaded.job).not.toBeNull();
      expect(uploaded.log.files).toHaveLength(2_000);
      let reads = 0, inFlight = 0, peakConcurrentReads = 0;
      const slowRead = async <T,>(operation: () => Promise<T>): Promise<T> => {
        reads++; inFlight++; peakConcurrentReads = Math.max(peakConcurrentReads, inFlight);
        try { await delay(20); return await operation(); }
        finally { inFlight--; }
      };
      const objectStore: ObjectStore = { ...store,
        get: (key) => slowRead(() => store.get(key)),
        getBounded: (key, maxBytes) => slowRead(() => store.getBounded!(key, maxBytes)),
        getStream: (key, range) => slowRead(() => store.getStream!(key, range))
      };
      const maxJobMs = 60_000, leaseTtlMs = 3_000;
      const started = performance.now();
      const result = await processLogAnalysisJobById({ db, objectStore, jobId: uploaded.job!.id,
        leaseTtlMs, maxJobMs, analyzer: createRuleBasedLogAnalyzer() });
      const elapsedMs = Math.round(performance.now() - started);
      process.stdout.write(`slow-object-store lease probe ${JSON.stringify({ files: 2_000, getDelayMs: 20,
        reads, peakConcurrentReads, elapsedMs, leaseTtlMs, maxJobMs, status: result.status })}\n`);
      expect(result).toEqual({ status: "processed" });
      expect(elapsedMs).toBeGreaterThan(leaseTtlMs);
      expect(elapsedMs).toBeLessThan(maxJobMs);
      expect(peakConcurrentReads).toBeGreaterThan(1);
      expect(peakConcurrentReads).toBeLessThanOrEqual(8);
      expect((await getLogRecord(db, auth, uploaded.log.id)).status).toBe("complete");
      expect((await db.query("select status, attempt_count from jobs where id=$1", [uploaded.job!.id])).rows)
        .toEqual([{ status: "complete", attempt_count: 1 }]);
    });
  }, 90_000);
});
