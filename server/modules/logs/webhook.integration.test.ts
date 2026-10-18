import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import { createEphemeralTestDatabase, isTestDatabaseAvailable, type EphemeralTestDatabase } from "../../testing/testDatabase";
import { createPostgresDatabase, type Database, type RootDatabase } from "../../shared/database/client";
import { claimLogWebhook, enqueueLogWebhook } from "./webhookOutbox";
import { decryptLogWebhookSecret, encryptLogWebhookSecret, ensureLogWebhookSecretsEncrypted } from "./webhookSecrets";
import { resolveLogWebhookSecretKey } from "../../config/logWebhookSecretKey";
import { completeLogAnalysisJobWithReport, failRun } from "./repository";
import { claimJobById, createLogAnalysisJob } from "../jobs/repository";
import {
  createLogDomainRecord,
  listLogDomainWebhookDeliveryRecords,
  sendLogDomainWebhookTestDelivery,
  setLogDomainWebhookRecord
} from "./domainsService";
import { createLogWebhookDeliverer } from "./webhookDelivery";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from "./webhookSecurity";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-log-webhooks";
const ADMIN_ID = "user-log-webhook-admin";
const SECRET = "integration-webhook-secret-0123456789";

const adminPermissions: BackendPermission[] = ["logs:view", "logs:admin-domains"];

function makeAuth(): AuthContext {
  return {
    user: { id: ADMIN_ID, organizationId: ORG_ID, name: ADMIN_ID, title: "Admin", isActive: true },
    organization: { id: ORG_ID, name: ORG_ID },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: [...adminPermissions]
  };
}

async function seedCore(db: Database) {
  await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [ORG_ID]);
  await db.query(
    `insert into users (id, organization_id, name, title, is_active)
     values ($1, $2, $1, 'Admin', true)
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [ADMIN_ID, ORG_ID]
  );
}

async function seedLogRecord(db: Database, logDomainId: string) {
  const fileObjectId = randomUUID();
  const logId = randomUUID();
  await db.query(
    `insert into log_file_objects (id, organization_id, storage_key, file_name, content_type, file_size_bytes, checksum_sha256, uploaded_by_user_id)
     values ($1, $2, $3, 'charging.log', 'text/plain', 64, 'checksum', $4)`,
    [fileObjectId, ORG_ID, `logs/${fileObjectId}`, ADMIN_ID]
  );
  await db.query(
    `insert into log_records (id, organization_id, file_object_id, file_name, source, status, submitted_by_user_id, log_domain_id)
     values ($1, $2, $3, 'charging.log', 'api', 'complete', $4, $5)`,
    [logId, ORG_ID, fileObjectId, ADMIN_ID, logDomainId]
  );
  return logId;
}

describe.skipIf(!databaseAvailable)("log domain result webhooks (integration)", () => {
  let db: RootDatabase;
  let ephemeral: EphemeralTestDatabase;
  let auth: AuthContext;
  let domainId: string;
  let server: Server;
  let receiverUrl: string;
  let received: Array<{ body: string; signature?: string; timestamp?: string }>;
  let responseStatus: number;

  beforeEach(async () => {
    ephemeral = await createEphemeralTestDatabase("webhooks");
    db = createPostgresDatabase(ephemeral.url);
    auth = makeAuth();
    await seedCore(db);
    const domain = await createLogDomainRecord(
      db,
      auth,
      { name: "charging-power", description: "Charging subsystem kernel log" },
      { requestId: "req-webhook-setup" }
    );
    domainId = domain.id;

    received = [];
    responseStatus = 200;
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        received.push({
          body,
          signature: request.headers[WEBHOOK_SIGNATURE_HEADER]?.toString(),
          timestamp: request.headers[WEBHOOK_TIMESTAMP_HEADER]?.toString()
        });
        response.statusCode = responseStatus;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    receiverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/wiseeff-hook`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
    await ephemeral.drop();
  });

  function makeDeliverer() {
    return createLogWebhookDeliverer({
      db,
      env: { timeoutMs: 2000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true }
    });
  }

  async function enqueue(runId = "run-recovery") {
    const logId = await seedLogRecord(db, domainId);
    await enqueueLogWebhook(db, { organizationId: ORG_ID, logDomainId: domainId, logId,
      runId, fileName: "charging.log", status: "complete", occurredAt: new Date().toISOString() });
    return { logId, eventId: `log-result:${runId}` };
  }

  it("reclaims an abandoned lease after a crash and delivers only after expiry", async () => {
    await configureWebhook();
    const { eventId } = await enqueue();
    const abandoned = await claimLogWebhook(db, 60_000);
    expect(abandoned?.id).toBe(eventId);
    expect(await makeDeliverer().processNext()).toBeNull();
    await db.query(`update log_webhook_outbox set lease_expires_at = now() - interval '1 second' where id = $1`, [eventId]);
    expect(await makeDeliverer().processNext()).toMatchObject({ status: "delivered", attempts: 1 });
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].body).eventId).toBe(eventId);
  });

  it("persists exponential backoff across worker restarts and exhausts the configured attempts", async () => {
    await configureWebhook();
    const { eventId } = await enqueue();
    const transport = vi.fn().mockResolvedValue({ ok: false, httpStatus: 503 });
    const make = () => createLogWebhookDeliverer({ db, transport,
      env: { timeoutMs: 2000, maxAttempts: 3, retryBaseDelayMs: 30_000, allowInsecureLocal: true } });
    expect(await make().processNext()).toMatchObject({ status: "retrying", attempts: 1 });
    const state = async () => (await db.query<{ status: string; delay: number }>(
      `select status, extract(epoch from (next_attempt_at - updated_at)) * 1000 as delay
       from log_webhook_outbox where id = $1`, [eventId])).rows[0];
    expect(Number((await state()).delay)).toBeGreaterThan(29_000);
    expect(Number((await state()).delay)).toBeLessThan(31_000);
    expect(await make().processNext()).toBeNull();
    await db.query(`update log_webhook_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [eventId]);
    expect(await make().processNext()).toMatchObject({ status: "retrying", attempts: 2 });
    expect(Number((await state()).delay)).toBeGreaterThan(59_000);
    expect(Number((await state()).delay)).toBeLessThan(61_000);
    await db.query(`update log_webhook_outbox set next_attempt_at = now() - interval '1 second' where id = $1`, [eventId]);
    expect(await make().processNext()).toMatchObject({ status: "failed", attempts: 3 });
    expect((await state()).status).toBe("failed");
    expect(await make().processNext()).toBeNull();
    expect(transport).toHaveBeenCalledTimes(3);
    const ids = transport.mock.calls.map(([input]) => JSON.parse(input.rawBody).eventId);
    expect(ids).toEqual([eventId, eventId, eventId]);
  });

  it("replays the same event after the receiver accepts but bookkeeping rolls back", async () => {
    await configureWebhook();
    const { eventId } = await enqueue();
    const crashDb: Database = {
      query: db.query,
      transaction: (fn) => db.transaction(async (tx) => { await fn(tx); throw new Error("crash after send"); })
    };
    const crashed = createLogWebhookDeliverer({ db: crashDb,
      env: { timeoutMs: 2000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true } });
    await expect(crashed.processNext()).rejects.toThrow("crash after send");
    expect(received).toHaveLength(1);
    expect((await db.query(`select id from log_webhook_deliveries where run_id = 'run-recovery'`)).rows).toHaveLength(0);
    await db.query(`update log_webhook_outbox set lease_expires_at = now() - interval '1 second' where id = $1`, [eventId]);
    expect(await makeDeliverer().processNext()).toMatchObject({ status: "delivered" });
    expect(received).toHaveLength(2);
    expect(received[1].body).toBe(received[0].body);
    expect(JSON.parse(received[1].body).eventId).toBe(eventId);
  });

  it("never sends a live claimed attempt twice, even after its lease expires", async () => {
    await configureWebhook();
    const { eventId } = await enqueue();
    // An expired lease is already eligible, but SKIP LOCKED must skip the live sender.
    const row = await claimLogWebhook(db, -1);
    expect(row?.id).toBe(eventId);
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const lockedSend = db.transaction(async (tx) => {
      await tx.query(`select id from log_webhook_outbox where id = $1 for update`, [eventId]);
      entered();
      await hold;
    });
    await started;
    try {
      expect(await makeDeliverer().processNext()).toBeNull();
    } finally { release(); await lockedSend; }
    const results = await Promise.all([makeDeliverer().processNext(), makeDeliverer().processNext()]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(received).toHaveLength(1);
  });

  it("backfills plaintext idempotently, rotates keys, and rejects cross-tenant/domain substitution", async () => {
    await db.query(`update log_domains set webhook_secret = $2 where id = $1`, [domainId, SECRET]);
    await ensureLogWebhookSecretsEncrypted(db);
    const read = async () => (await db.query<{ webhook_secret: string }>(`select webhook_secret from log_domains where id = $1`, [domainId])).rows[0].webhook_secret;
    const encrypted = await read();
    expect(encrypted).not.toContain(SECRET);
    await ensureLogWebhookSecretsEncrypted(db);
    expect(await read()).toBe(encrypted);
    expect(decryptLogWebhookSecret(encrypted, ORG_ID, domainId)).toBe(SECRET);
    expect(() => decryptLogWebhookSecret(encrypted, "another-org", domainId)).toThrow();
    expect(() => decryptLogWebhookSecret(encrypted, ORG_ID, "another-domain")).toThrow();
    const newKey = Buffer.alloc(32, 7);
    await expect(ensureLogWebhookSecretsEncrypted(db, { key: newKey })).rejects.toThrow("key id mismatch");
    expect(await read()).toBe(encrypted);
    await ensureLogWebhookSecretsEncrypted(db, { key: newKey, previousKey: resolveLogWebhookSecretKey() });
    expect(await read()).not.toBe(encrypted);
    expect(decryptLogWebhookSecret(await read(), ORG_ID, domainId, newKey)).toBe(SECRET);
    await ensureLogWebhookSecretsEncrypted(db, { key: newKey });
    expect(() => decryptLogWebhookSecret(encrypted, ORG_ID, domainId, newKey)).toThrow();
    await db.query(`update log_domains set webhook_secret = 'logwh:v2:unknown' where id = $1`, [domainId]);
    await expect(ensureLogWebhookSecretsEncrypted(db, { key: newKey })).rejects.toThrow("version or key id mismatch");
    expect(await read()).toBe("logwh:v2:unknown");
  });

  it.each(["logwh:customer-secret-value", encryptLogWebhookSecret(SECRET, ORG_ID, "legacy-domain")])(
    "backfills a legacy logwh-prefixed plaintext secret and preserves its signature (%#)", async (secret) => {
    await configureWebhook();
    await db.query(`update log_domains set webhook_secret = $2, webhook_secret_encrypted = false where id = $1`, [domainId, secret]);
    await ensureLogWebhookSecretsEncrypted(db);
    const raw = await db.query<{ webhook_secret: string; webhook_secret_encrypted: boolean }>(
      `select webhook_secret, webhook_secret_encrypted from log_domains where id = $1`, [domainId]);
    expect(raw.rows[0].webhook_secret_encrypted).toBe(true);
    expect(raw.rows[0].webhook_secret).not.toBe(secret);
    expect(await makeDeliverer().sendTestDelivery({ organizationId: ORG_ID, domainId })).toMatchObject({ status: "delivered" });
    const timestampSeconds = Number(received[0].timestamp);
    expect(verifyWebhookSignature({ secret, timestampSeconds, rawBody: received[0].body,
      signatureHeader: received[0].signature!, nowSeconds: timestampSeconds })).toBe(true);
  });

  it("isolates a wrong encrypted key id to that domain's failed attempt without blocking startup", async () => {
    await configureWebhook();
    const broken = await createLogDomainRecord(db, auth, { name: "broken-key" }, { requestId: "req-broken-key" });
    await db.query(`update log_domains set webhook_url = $2, webhook_enabled = true,
      webhook_secret = 'logwh:v1:wrong-key-id:ciphertext', webhook_secret_encrypted = true where id = $1`, [broken.id, receiverUrl]);
    await expect(ensureLogWebhookSecretsEncrypted(db)).resolves.toBeUndefined();
    const logId = await seedLogRecord(db, broken.id);
    expect(await makeDeliverer().deliverAnalysisResult({ organizationId: ORG_ID, logDomainId: broken.id, logId,
      runId: "wrong-key-run", fileName: "charging.log", status: "complete", occurredAt: new Date().toISOString() }))
      .toMatchObject({ status: "failed", attempts: 1, error: expect.stringContaining("key id mismatch") });
    expect(received).toHaveLength(0);
    const attempts = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId: broken.id });
    expect(attempts.items).toEqual([expect.objectContaining({ status: "failed", attempt: 1, error: expect.stringContaining("key id mismatch") })]);
    expect(await makeDeliverer().sendTestDelivery({ organizationId: ORG_ID, domainId })).toMatchObject({ status: "delivered" });
    expect(received).toHaveLength(1);
  });

  it("refuses production startup with configured webhooks and no encryption key", async () => {
    await configureWebhook();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOG_WEBHOOK_SECRET_ENCRYPTION_KEY", "");
    try {
      await expect(ensureLogWebhookSecretsEncrypted(db)).rejects.toThrow("LOG_WEBHOOK_SECRET_ENCRYPTION_KEY is required");
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(["complete", "failed"] as const)("atomically persists a %s event with the run state, including rollback", async (status) => {
    await configureWebhook();
    const logId = await seedLogRecord(db, domainId);
    const runId = `run-atomic-${status}`;
    await db.query(`insert into log_analysis_runs (id, organization_id, log_record_id, status, current_stage)
      values ($1, $2, $3, 'processing', 'parse')`, [runId, ORG_ID, logId]);
    await db.query(`update log_records set current_run_id = $2 where id = $1`, [logId, runId]);
    const jobId = `job-atomic-${status}`;
    await createLogAnalysisJob(db, { id: jobId, organizationId: ORG_ID, logId, runId });
    await claimJobById(db, { kind: "log-analysis", jobId, leaseOwner: "atomic-test", leaseTtlMs: 60_000 });
    const terminal = (connection: Database) => status === "complete"
      ? completeLogAnalysisJobWithReport(connection, { organizationId: ORG_ID, logId, runId, jobId, leaseOwner: "atomic-test",
        report: { confidence: 0.8, conclusion: "A compact conclusion", impact: "Limited", severity: "Warning",
          suggestedActions: [], rawLines: ["raw content never sent"], analysisSource: "agent" }, evidence: [] })
      : failRun(connection, { organizationId: ORG_ID, logId, runId, error: "exhausted" });
    await expect(db.transaction(async (tx) => { await terminal(tx); throw new Error("crash"); })).rejects.toThrow("crash");
    expect((await db.query(`select id from log_webhook_outbox where run_id = $1`, [runId])).rows).toHaveLength(0);
    expect((await db.query<{ status: string }>(`select status from log_analysis_runs where id = $1`, [runId])).rows[0].status).toBe("processing");
    await terminal(db);
    await terminal(db);
    expect((await db.query(`select id from log_webhook_outbox where run_id = $1`, [runId])).rows).toHaveLength(1);
    expect(await makeDeliverer().processNext()).toMatchObject({ status: "delivered" });
    expect(JSON.parse(received[0].body).event).toBe(`log-analysis.${status === "complete" ? "completed" : "failed"}`);
    expect(received[0].body).not.toContain("raw content never sent");
  });

  async function configureWebhook() {
    return setLogDomainWebhookRecord(
      db,
      auth,
      { domainId, url: receiverUrl, enabled: true, secret: SECRET },
      { requestId: "req-webhook-config" },
      { allowInsecureLocal: true }
    );
  }

  it("persists webhook config through migration 0108 without echoing the secret", async () => {
    const saved = await configureWebhook();

    expect(saved.webhook).toEqual({
      enabled: true,
      url: receiverUrl,
      secretConfigured: true,
      secretLastFour: SECRET.slice(-4)
    });
    expect(JSON.stringify(saved)).not.toContain(SECRET);
    const raw = await db.query<{ webhook_secret: string; webhook_secret_encrypted: boolean }>(`select webhook_secret, webhook_secret_encrypted from log_domains where id = $1`, [domainId]);
    expect(raw.rows[0].webhook_secret).not.toBe(SECRET);
    expect(raw.rows[0].webhook_secret).toMatch(/^logwh:v1:/);
    expect(raw.rows[0].webhook_secret_encrypted).toBe(true);
  });

  it("delivers a signed result payload end to end and records the delivery attempt", async () => {
    await configureWebhook();
    const logId = await seedLogRecord(db, domainId);
    const deliverer = makeDeliverer();

    const outcome = await deliverer.deliverAnalysisResult({
      organizationId: ORG_ID,
      logDomainId: domainId,
      logId,
      runId: "run-int-1",
      fileName: "charging.log",
      status: "complete",
      analysisSource: "agent",
      severity: "Warning",
      confidence: 0.82,
      conclusion: "Thermal foldback protection reduced the charge output.",
      occurredAt: new Date().toISOString()
    });

    expect(outcome).toMatchObject({ status: "delivered", attempts: 1, httpStatus: 200 });
    expect(received).toHaveLength(1);
    const timestampSeconds = Number(received[0].timestamp);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampSeconds,
        rawBody: received[0].body,
        signatureHeader: received[0].signature!,
        nowSeconds: timestampSeconds
      })
    ).toBe(true);
    const payload = JSON.parse(received[0].body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      event: "log-analysis.completed",
      recordId: logId,
      logDomainId: domainId,
      status: "complete",
      productPath: "/logs?id=report-run-int-1"
    });
    expect(payload).not.toHaveProperty("rawLines");

    const deliveries = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId });
    expect(deliveries.items).toEqual([
      expect.objectContaining({ kind: "result", attempt: 1, status: "delivered", httpStatus: 200, logRecordId: logId })
    ]);
  });

  it("records retrying then failed rows when the receiver keeps erroring", async () => {
    await configureWebhook();
    const logId = await seedLogRecord(db, domainId);
    responseStatus = 500;
    const deliverer = makeDeliverer();

    const first = await deliverer.deliverAnalysisResult({
      organizationId: ORG_ID,
      logDomainId: domainId,
      logId,
      runId: "run-int-2",
      fileName: "charging.log",
      status: "failed",
      conclusion: "Job exhausted 4 attempts.",
      occurredAt: new Date().toISOString()
    });

    expect(first).toMatchObject({ status: "retrying", attempts: 1, httpStatus: 500 });
    await db.query(`update log_webhook_outbox set next_attempt_at = now() - interval '1 second'`);
    expect(await deliverer.processNext()).toMatchObject({ status: "failed", attempts: 2, httpStatus: 500 });
    expect(await makeDeliverer().processNext()).toBeNull();
    const deliveries = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId });
    expect(deliveries.items.map((item) => `${item.attempt}:${item.status}`)).toEqual(["2:failed", "1:retrying"]);
  });

  it("sends an audited admin test delivery through the same guarded path", async () => {
    await configureWebhook();
    const deliverer = makeDeliverer();

    const outcome = await sendLogDomainWebhookTestDelivery(db, auth, domainId, deliverer, {
      requestId: "req-webhook-test"
    });

    expect(outcome).toMatchObject({ status: "delivered", attempts: 1, httpStatus: 200 });
    expect(JSON.parse(received[0].body)).toMatchObject({ event: "log-analysis.test", logDomainId: domainId });

    const deliveries = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId });
    expect(deliveries.items).toEqual([expect.objectContaining({ kind: "test", status: "delivered" })]);
    const audit = await db.query<{ kind: string }>(
      `select kind from audit_events where target_id = $1 and kind = 'log-domain-webhook-test'`,
      [domainId]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it("rejects private webhook URLs at save time with an explicit error code", async () => {
    await expect(
      setLogDomainWebhookRecord(
        db,
        auth,
        { domainId, url: "https://169.254.169.254/latest/meta-data", enabled: false },
        { requestId: "req-webhook-ssrf" }
      )
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { reason: "webhook-url-private-address" } });
  });

  it("keeps loopback receivers blocked at delivery time when the local flag is off", async () => {
    await configureWebhook();
    const strictDeliverer = createLogWebhookDeliverer({
      db,
      env: { timeoutMs: 2000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: false }
    });

    const outcome = await strictDeliverer.sendTestDelivery({ organizationId: ORG_ID, domainId });

    expect(outcome.status).toBe("failed");
    expect(received).toHaveLength(0);
    const deliveries = await listLogDomainWebhookDeliveryRecords(db, auth, { domainId });
    expect(deliveries.items[0]).toMatchObject({ status: "failed", kind: "test" });
  });
});
