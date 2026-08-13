import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext, BackendPermission } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
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

async function seedCore(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, $1) on conflict (id) do nothing`, [ORG_ID]);
  await db.query(
    `insert into users (id, organization_id, name, title, is_active)
     values ($1, $2, $1, 'Admin', true)
     on conflict (id) do update set organization_id = excluded.organization_id`,
    [ADMIN_ID, ORG_ID]
  );
}

async function seedLogRecord(db: InMemoryTestDatabase, logDomainId: string) {
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
  let db: InMemoryTestDatabase;
  let auth: AuthContext;
  let domainId: string;
  let server: Server;
  let receiverUrl: string;
  let received: Array<{ body: string; signature?: string; timestamp?: string }>;
  let responseStatus: number;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
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
    await db.rollback();
  });

  function makeDeliverer() {
    return createLogWebhookDeliverer({
      db,
      env: { timeoutMs: 2000, maxAttempts: 2, retryBaseDelayMs: 1, allowInsecureLocal: true }
    });
  }

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

    const outcome = await deliverer.deliverAnalysisResult({
      organizationId: ORG_ID,
      logDomainId: domainId,
      logId,
      runId: "run-int-2",
      fileName: "charging.log",
      status: "failed",
      conclusion: "Job exhausted 4 attempts.",
      occurredAt: new Date().toISOString()
    });

    expect(outcome).toMatchObject({ status: "failed", attempts: 2, httpStatus: 500 });
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
