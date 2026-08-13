import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "../../shared/database/client";
import { getLogDomainWebhookConfig } from "./domainsRepository";
import { insertLogWebhookDelivery } from "./webhookRepository";
import {
  buildLogResultWebhookPayload,
  createLogWebhookDeliverer,
  nodeWebhookTransport,
  WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS,
  type LogAnalysisResultWebhookInput,
  type LogWebhookEnv,
  type WebhookTransport
} from "./webhookDelivery";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER, WEBHOOK_TIMESTAMP_HEADER } from "./webhookSecurity";

vi.mock("./domainsRepository", () => ({
  getLogDomainWebhookConfig: vi.fn()
}));
vi.mock("./webhookRepository", () => ({
  insertLogWebhookDelivery: vi.fn()
}));

const mockedGetConfig = vi.mocked(getLogDomainWebhookConfig);
const mockedInsertDelivery = vi.mocked(insertLogWebhookDelivery);

const db = {} as Database;
const defaultEnv: LogWebhookEnv = { timeoutMs: 5000, maxAttempts: 3, retryBaseDelayMs: 100, allowInsecureLocal: false };
const secret = "webhook-secret-with-enough-entropy";

function resultInput(overrides: Partial<LogAnalysisResultWebhookInput> = {}): LogAnalysisResultWebhookInput {
  return {
    organizationId: "org-chargelab",
    logDomainId: "domain-1",
    logId: "log-1",
    runId: "run-1",
    fileName: "charging.log",
    status: "complete",
    analysisSource: "agent",
    severity: "Warning",
    confidence: 0.82,
    conclusion: "Charging behavior is consistent with thermal foldback protection.",
    occurredAt: "2026-08-13T02:00:00.000Z",
    ...overrides
  };
}

function configuredWebhook(url = "https://hooks.example.com/wiseeff") {
  mockedGetConfig.mockResolvedValue({ url, secret, enabled: true, domainName: "charging-power" });
}

function recordedStatuses() {
  return mockedInsertDelivery.mock.calls.map(([, row]) => `${row.attempt}:${row.status}`);
}

beforeEach(() => {
  mockedGetConfig.mockReset();
  mockedInsertDelivery.mockReset();
  mockedInsertDelivery.mockResolvedValue(undefined);
});

describe("buildLogResultWebhookPayload", () => {
  it("stays a compact summary and never carries raw log content", () => {
    const payload = buildLogResultWebhookPayload(resultInput());
    expect(payload).toEqual({
      event: "log-analysis.completed",
      recordId: "log-1",
      runId: "run-1",
      fileName: "charging.log",
      logDomainId: "domain-1",
      status: "complete",
      analysisSource: "agent",
      degradedReason: undefined,
      severity: "Warning",
      confidence: 0.82,
      conclusionSummary: "Charging behavior is consistent with thermal foldback protection.",
      occurredAt: "2026-08-13T02:00:00.000Z",
      productPath: "/logs?id=report-run-1"
    });
    expect(Object.keys(payload)).not.toContain("rawLines");
    expect(Object.keys(payload)).not.toContain("evidence");
  });

  it("truncates long conclusions", () => {
    const payload = buildLogResultWebhookPayload(resultInput({ conclusion: "x".repeat(1000) }));
    expect(payload.conclusionSummary).toHaveLength(WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS);
    expect(payload.conclusionSummary!.endsWith("…")).toBe(true);
  });

  it("links failed runs to the log workbench without a report id", () => {
    const payload = buildLogResultWebhookPayload(resultInput({ status: "failed", conclusion: "max-attempts-exhausted" }));
    expect(payload.event).toBe("log-analysis.failed");
    expect(payload.productPath).toBe("/logs");
  });
});

describe("createLogWebhookDeliverer", () => {
  it("skips silently when the domain has no webhook configured", async () => {
    mockedGetConfig.mockResolvedValue({ url: null, secret: null, enabled: false, domainName: "d" });
    const transport = vi.fn();
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome.status).toBe("skipped");
    expect(transport).not.toHaveBeenCalled();
    expect(mockedInsertDelivery).not.toHaveBeenCalled();
  });

  it("skips when the webhook is configured but disabled", async () => {
    mockedGetConfig.mockResolvedValue({ url: "https://hooks.example.com/x", secret, enabled: false, domainName: "d" });
    const transport = vi.fn();
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport });

    expect((await deliverer.deliverAnalysisResult(resultInput())).status).toBe("skipped");
    expect(transport).not.toHaveBeenCalled();
  });

  it("delivers with a verifiable signed payload and records the attempt", async () => {
    configuredWebhook();
    const seen: Array<{ rawBody: string; headers: Record<string, string> }> = [];
    const transport: WebhookTransport = async (input) => {
      seen.push({ rawBody: input.rawBody, headers: input.headers });
      return { ok: true, httpStatus: 200 };
    };
    const metrics = { recordLogAnalysisWebhookDelivery: vi.fn() };
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport, metrics, newId: () => "delivery-1" });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome).toMatchObject({ status: "delivered", attempts: 1, httpStatus: 200 });
    expect(seen).toHaveLength(1);
    const timestampSeconds = Number(seen[0].headers[WEBHOOK_TIMESTAMP_HEADER]);
    expect(
      verifyWebhookSignature({
        secret,
        timestampSeconds,
        rawBody: seen[0].rawBody,
        signatureHeader: seen[0].headers[WEBHOOK_SIGNATURE_HEADER],
        nowSeconds: timestampSeconds
      })
    ).toBe(true);
    expect(mockedInsertDelivery).toHaveBeenCalledWith(db, {
      id: "delivery-1",
      organizationId: "org-chargelab",
      logDomainId: "domain-1",
      logRecordId: "log-1",
      runId: "run-1",
      kind: "result",
      attempt: 1,
      status: "delivered",
      httpStatus: 200,
      error: undefined
    });
    expect(metrics.recordLogAnalysisWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "domain-1", outcome: "delivered" })
    );
  });

  it("retries with exponential backoff and succeeds on a later attempt", async () => {
    configuredWebhook();
    const transport = vi
      .fn<WebhookTransport>()
      .mockResolvedValueOnce({ ok: false, httpStatus: 503, error: "Receiver responded with HTTP 503." })
      .mockResolvedValueOnce({ ok: true, httpStatus: 204 });
    const sleeps: number[] = [];
    const deliverer = createLogWebhookDeliverer({
      db,
      env: defaultEnv,
      transport,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome).toMatchObject({ status: "delivered", attempts: 2, httpStatus: 204 });
    expect(sleeps).toEqual([100]);
    expect(recordedStatuses()).toEqual(["1:retrying", "2:delivered"]);
  });

  it("marks the delivery failed after exhausting retries without touching the analysis", async () => {
    configuredWebhook();
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ ok: false, httpStatus: 500, error: "Receiver responded with HTTP 500." });
    const sleeps: number[] = [];
    const deliverer = createLogWebhookDeliverer({
      db,
      env: defaultEnv,
      transport,
      sleep: async (ms) => {
        sleeps.push(ms);
      }
    });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome).toMatchObject({ status: "failed", attempts: 3, httpStatus: 500 });
    expect(sleeps).toEqual([100, 200]);
    expect(recordedStatuses()).toEqual(["1:retrying", "2:retrying", "3:failed"]);
  });

  it("refuses a private-address URL up front without calling the transport", async () => {
    configuredWebhook("https://169.254.169.254/latest/meta-data");
    const transport = vi.fn();
    const metrics = { recordLogAnalysisWebhookDelivery: vi.fn() };
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport, metrics });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome.status).toBe("failed");
    expect(transport).not.toHaveBeenCalled();
    expect(recordedStatuses()).toEqual(["1:failed"]);
    expect(mockedInsertDelivery.mock.calls[0][1].error).toContain("webhook-url-private-address");
    expect(metrics.recordLogAnalysisWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "blocked" })
    );
  });

  it("stops immediately when the host resolves into a blocked range (no retry can heal SSRF)", async () => {
    configuredWebhook("https://rebinding.example.com/hook");
    const transport = vi
      .fn<WebhookTransport>()
      .mockResolvedValue({ ok: false, error: "Webhook host resolves to a blocked address range." });
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport });

    const outcome = await deliverer.deliverAnalysisResult(resultInput());

    expect(outcome.status).toBe("failed");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(recordedStatuses()).toEqual(["1:failed"]);
  });

  it("sends a single-attempt test delivery recorded as kind=test", async () => {
    configuredWebhook();
    const transport = vi.fn<WebhookTransport>().mockResolvedValue({ ok: true, httpStatus: 200 });
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport });

    const outcome = await deliverer.sendTestDelivery({ organizationId: "org-chargelab", domainId: "domain-1" });

    expect(outcome).toMatchObject({ status: "delivered", attempts: 1 });
    expect(mockedInsertDelivery).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: "test", logRecordId: undefined, runId: undefined })
    );
    const body = JSON.parse(transport.mock.calls[0][0].rawBody) as Record<string, unknown>;
    expect(body.event).toBe("log-analysis.test");
  });

  it("reports an unconfigured webhook explicitly for test deliveries", async () => {
    mockedGetConfig.mockResolvedValue({ url: "https://hooks.example.com/x", secret: null, enabled: true, domainName: "d" });
    const deliverer = createLogWebhookDeliverer({ db, env: defaultEnv, transport: vi.fn() });

    const outcome = await deliverer.sendTestDelivery({ organizationId: "org-chargelab", domainId: "domain-1" });

    expect(outcome.status).toBe("skipped");
    expect(outcome.error).toContain("not fully configured");
  });

  it("contains fire-and-forget failures and resolves flush()", async () => {
    configuredWebhook();
    const transport = vi.fn<WebhookTransport>().mockRejectedValue(new Error("boom"));
    const deliverer = createLogWebhookDeliverer({ db, env: { ...defaultEnv, maxAttempts: 1 }, transport, sleep: async () => {} });

    deliverer.notifyAnalysisTerminal(resultInput());
    await expect(deliverer.flush()).resolves.toBeUndefined();
  });
});

describe("nodeWebhookTransport", () => {
  let server: Server;
  let port: number;
  let received: Array<{ url: string; body: string; signature?: string; timestamp?: string }>;
  let responseStatus: number;

  beforeEach(async () => {
    received = [];
    responseStatus = 200;
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });
      request.on("end", () => {
        received.push({
          url: request.url ?? "",
          body,
          signature: request.headers[WEBHOOK_SIGNATURE_HEADER]?.toString(),
          timestamp: request.headers[WEBHOOK_TIMESTAMP_HEADER]?.toString()
        });
        response.statusCode = responseStatus;
        response.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("delivers to a loopback receiver when the local-development flag is on", async () => {
    const result = await nodeWebhookTransport({
      url: new URL(`http://127.0.0.1:${port}/hook`),
      rawBody: '{"event":"log-analysis.test"}',
      headers: { [WEBHOOK_SIGNATURE_HEADER]: "sha256=deadbeef", [WEBHOOK_TIMESTAMP_HEADER]: "1755000000" },
      timeoutMs: 2000,
      ssrf: { allowInsecureLocal: true }
    });

    expect(result).toEqual({ ok: true, httpStatus: 200 });
    expect(received).toEqual([
      {
        url: "/hook",
        body: '{"event":"log-analysis.test"}',
        signature: "sha256=deadbeef",
        timestamp: "1755000000"
      }
    ]);
  });

  it("reports non-2xx statuses without following redirects", async () => {
    responseStatus = 302;
    const result = await nodeWebhookTransport({
      url: new URL(`http://127.0.0.1:${port}/hook`),
      rawBody: "{}",
      headers: {},
      timeoutMs: 2000,
      ssrf: { allowInsecureLocal: true }
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(302);
    expect(result.error).toContain("Redirects are not followed");
  });

  it("blocks hostnames that resolve to loopback through the validating lookup", async () => {
    // "localhost" resolves through the lookup hook, which must reject loopback
    // when the local-development flag is off — before any TCP connection happens.
    const result = await nodeWebhookTransport({
      url: new URL(`https://localhost:${port}/hook`),
      rawBody: "{}",
      headers: {},
      timeoutMs: 2000,
      ssrf: {}
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("blocked address range");
    expect(received).toHaveLength(0);
  });
});
