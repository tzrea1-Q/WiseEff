import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { Database } from "../../shared/database/client";
import { getLogDomainWebhookConfig } from "./domainsRepository";
import { insertLogWebhookDelivery } from "./webhookRepository";
import {
  signWebhookPayload,
  validateWebhookUrl,
  isBlockedWebhookAddress,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookSsrfOptions
} from "./webhookSecurity";

/**
 * Domain-level result webhook delivery (P3b, glossary: Result webhook).
 *
 * Design choices:
 * - Best-effort and asynchronous: the worker fires delivery AFTER the terminal
 *   state is fully persisted and never awaits it on its main path — a webhook
 *   outage can never fail, retry, or slow down an analysis. The trade-off is
 *   at-most-once semantics per attempt chain (a process crash mid-delivery loses
 *   the remaining retries); consumers that need stronger guarantees poll the API.
 * - The payload is a compact summary (never raw log content or evidence text).
 * - Anti-SSRF: URL shape is validated up front, and the actual TCP connection
 *   resolves the hostname through a validating lookup that rejects private /
 *   loopback / link-local / metadata addresses — closing the DNS-rebinding gap
 *   between "check" and "connect". Redirects are not followed; response bodies
 *   are discarded; only the status code is recorded.
 */

export const WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS = 300;

export type LogAnalysisResultWebhookInput = {
  organizationId: string;
  logDomainId: string;
  logId: string;
  runId: string;
  fileName: string;
  status: "complete" | "failed";
  analysisSource?: string;
  degradedReason?: string;
  severity?: string;
  confidence?: number;
  conclusion?: string;
  occurredAt: string;
};

export type LogWebhookEnv = {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  allowInsecureLocal: boolean;
};

export type WebhookTransportResult = { ok: boolean; httpStatus?: number; error?: string };

export type WebhookTransport = (input: {
  url: URL;
  rawBody: string;
  headers: Record<string, string>;
  timeoutMs: number;
  ssrf: WebhookSsrfOptions;
}) => Promise<WebhookTransportResult>;

type LookupCallback = (error: NodeJS.ErrnoException | null, address: unknown, family?: number) => void;

/**
 * DNS lookup used by the outbound connection itself: resolves all addresses,
 * rejects the whole connection if ANY resolved address is in a blocked range
 * (multi-record answers must not smuggle a private address), then hands the
 * results to the socket. Because this is the socket's own lookup there is no
 * re-resolution window for DNS rebinding.
 */
function createValidatingLookup(ssrf: WebhookSsrfOptions) {
  return (hostname: string, options: unknown, callback: unknown) => {
    const done = (typeof options === "function" ? options : callback) as LookupCallback;
    const lookupOptions = typeof options === "object" && options !== null ? (options as Record<string, unknown>) : {};
    dnsLookup(hostname, { all: true, family: (lookupOptions.family as 0 | 4 | 6 | undefined) ?? 0 }, (error, addresses) => {
      if (error) {
        done(error, undefined as never);
        return;
      }
      const resolved = Array.isArray(addresses) ? addresses : [addresses];
      const blocked = resolved.find((entry) => isBlockedWebhookAddress(entry.address, ssrf));
      if (blocked || resolved.length === 0) {
        const rejection = Object.assign(new Error(`Webhook host resolves to a blocked address range.`), {
          code: "WISEEFF_WEBHOOK_SSRF_BLOCKED"
        });
        done(rejection, undefined as never);
        return;
      }
      if (lookupOptions.all === true) {
        done(null, resolved);
        return;
      }
      done(null, resolved[0].address, resolved[0].family);
    });
  };
}

/** Real transport: POST with validating lookup, no redirects, discarded body. */
export const nodeWebhookTransport: WebhookTransport = ({ url, rawBody, headers, timeoutMs, ssrf }) =>
  new Promise<WebhookTransportResult>((resolve) => {
    const requestFn = url.protocol === "http:" ? httpRequest : httpsRequest;
    const request = requestFn(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(rawBody).toString()
        },
        lookup: createValidatingLookup(ssrf)
      },
      (response) => {
        // Only the status code matters; the body is discarded unread.
        response.resume();
        const status = response.statusCode ?? 0;
        if (status >= 200 && status < 300) {
          resolve({ ok: true, httpStatus: status });
          return;
        }
        resolve({
          ok: false,
          httpStatus: status,
          error: status >= 300 && status < 400 ? "Redirects are not followed." : `Receiver responded with HTTP ${status}.`
        });
      }
    );
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Webhook delivery timed out after ${timeoutMs}ms.`));
    });
    request.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException & { code?: string }).code;
      resolve({
        ok: false,
        error: code === "WISEEFF_WEBHOOK_SSRF_BLOCKED" ? "Webhook host resolves to a blocked address range." : error.message
      });
    });
    request.end(rawBody);
  });

function truncateSummary(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const trimmed = text.trim();
  return trimmed.length > WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS
    ? `${trimmed.slice(0, WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS - 1)}…`
    : trimmed;
}

/** Compact result payload; NEVER includes raw log lines or evidence text. */
export function buildLogResultWebhookPayload(input: LogAnalysisResultWebhookInput) {
  return {
    event: input.status === "complete" ? "log-analysis.completed" : "log-analysis.failed",
    recordId: input.logId,
    runId: input.runId,
    fileName: input.fileName,
    logDomainId: input.logDomainId,
    status: input.status,
    analysisSource: input.analysisSource,
    degradedReason: input.degradedReason,
    severity: input.severity,
    confidence: input.confidence,
    conclusionSummary: truncateSummary(input.conclusion),
    occurredAt: input.occurredAt,
    productPath: input.status === "complete" ? `/logs?id=${encodeURIComponent(`report-${input.runId}`)}` : "/logs"
  };
}

export type LogWebhookDeliveryMetrics = {
  recordLogAnalysisWebhookDelivery(input: {
    domain: string;
    outcome: "delivered" | "retrying" | "failed" | "blocked" | "skipped";
    durationMs?: number;
  }): void;
};

export type LogWebhookDelivererOptions = {
  db: Database;
  env: LogWebhookEnv;
  transport?: WebhookTransport;
  metrics?: LogWebhookDeliveryMetrics;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
};

export type LogWebhookDeliveryOutcome = {
  status: "delivered" | "failed" | "skipped";
  attempts: number;
  httpStatus?: number;
  error?: string;
};

export type LogWebhookDeliverer = {
  /** Fire-and-forget entry used by the worker; errors are contained. */
  notifyAnalysisTerminal(input: LogAnalysisResultWebhookInput): void;
  /** Awaitable delivery (tests, direct callers). */
  deliverAnalysisResult(input: LogAnalysisResultWebhookInput): Promise<LogWebhookDeliveryOutcome>;
  /** Single-attempt admin test delivery (kind='test'); returns the observed result. */
  sendTestDelivery(input: { organizationId: string; domainId: string }): Promise<LogWebhookDeliveryOutcome>;
  /** Awaits all in-flight fire-and-forget deliveries (tests, shutdown). */
  flush(): Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createLogWebhookDeliverer({
  db,
  env,
  transport = nodeWebhookTransport,
  metrics,
  now = () => new Date(),
  sleep = defaultSleep,
  newId = randomUUID
}: LogWebhookDelivererOptions): LogWebhookDeliverer {
  const inFlight = new Set<Promise<unknown>>();
  const ssrf: WebhookSsrfOptions = { allowInsecureLocal: env.allowInsecureLocal };

  async function attemptOnce(input: {
    url: URL;
    secret: string;
    payload: unknown;
  }): Promise<WebhookTransportResult> {
    const rawBody = JSON.stringify(input.payload);
    const timestampSeconds = Math.floor(now().getTime() / 1000);
    return transport({
      url: input.url,
      rawBody,
      headers: {
        [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload({ secret: input.secret, timestampSeconds, rawBody }),
        [WEBHOOK_TIMESTAMP_HEADER]: String(timestampSeconds)
      },
      timeoutMs: env.timeoutMs,
      ssrf
    });
  }

  async function recordAttempt(input: {
    organizationId: string;
    logDomainId: string;
    logRecordId?: string;
    runId?: string;
    kind: "result" | "test";
    attempt: number;
    status: "delivered" | "retrying" | "failed";
    httpStatus?: number;
    error?: string;
  }) {
    try {
      await insertLogWebhookDelivery(db, { id: newId(), ...input });
    } catch {
      // Recording is itself best-effort; a bookkeeping failure must not break delivery.
    }
  }

  async function runDelivery(input: {
    organizationId: string;
    logDomainId: string;
    logRecordId?: string;
    runId?: string;
    kind: "result" | "test";
    payload: unknown;
    maxAttempts: number;
  }): Promise<LogWebhookDeliveryOutcome> {
    const config = await getLogDomainWebhookConfig(db, {
      organizationId: input.organizationId,
      domainId: input.logDomainId
    });
    if (!config || !config.enabled || !config.url?.trim() || !config.secret?.trim()) {
      const error =
        input.kind === "test"
          ? "Webhook is not fully configured (URL, secret, and enabled are all required)."
          : undefined;
      if (input.kind === "test") {
        metrics?.recordLogAnalysisWebhookDelivery({ domain: input.logDomainId, outcome: "skipped" });
      }
      return { status: "skipped", attempts: 0, error };
    }

    const validation = validateWebhookUrl(config.url, ssrf);
    if (!validation.ok) {
      await recordAttempt({
        organizationId: input.organizationId,
        logDomainId: input.logDomainId,
        logRecordId: input.logRecordId,
        runId: input.runId,
        kind: input.kind,
        attempt: 1,
        status: "failed",
        error: `${validation.reason}: ${validation.message}`
      });
      metrics?.recordLogAnalysisWebhookDelivery({ domain: input.logDomainId, outcome: "blocked" });
      return { status: "failed", attempts: 1, error: validation.message };
    }

    let lastResult: WebhookTransportResult = { ok: false, error: "not attempted" };
    for (let attempt = 1; attempt <= input.maxAttempts; attempt += 1) {
      const startedAtMs = now().getTime();
      lastResult = await attemptOnce({ url: validation.url, secret: config.secret, payload: input.payload });
      const durationMs = Math.max(0, now().getTime() - startedAtMs);
      const ssrfBlocked = lastResult.error === "Webhook host resolves to a blocked address range.";
      const terminal = lastResult.ok || ssrfBlocked || attempt === input.maxAttempts;
      const status = lastResult.ok ? "delivered" : terminal ? "failed" : "retrying";

      await recordAttempt({
        organizationId: input.organizationId,
        logDomainId: input.logDomainId,
        logRecordId: input.logRecordId,
        runId: input.runId,
        kind: input.kind,
        attempt,
        status,
        httpStatus: lastResult.httpStatus,
        error: lastResult.error
      });
      metrics?.recordLogAnalysisWebhookDelivery({
        domain: input.logDomainId,
        outcome: lastResult.ok ? "delivered" : ssrfBlocked ? "blocked" : terminal ? "failed" : "retrying",
        durationMs
      });

      if (lastResult.ok) {
        return { status: "delivered", attempts: attempt, httpStatus: lastResult.httpStatus };
      }
      if (ssrfBlocked) {
        // A blocked address will not heal by retrying; stop immediately.
        return { status: "failed", attempts: attempt, httpStatus: lastResult.httpStatus, error: lastResult.error };
      }
      if (attempt < input.maxAttempts) {
        await sleep(env.retryBaseDelayMs * 2 ** (attempt - 1));
      }
    }

    return { status: "failed", attempts: input.maxAttempts, httpStatus: lastResult.httpStatus, error: lastResult.error };
  }

  async function deliverAnalysisResult(input: LogAnalysisResultWebhookInput): Promise<LogWebhookDeliveryOutcome> {
    return runDelivery({
      organizationId: input.organizationId,
      logDomainId: input.logDomainId,
      logRecordId: input.logId,
      runId: input.runId,
      kind: "result",
      payload: buildLogResultWebhookPayload(input),
      maxAttempts: Math.max(1, env.maxAttempts)
    });
  }

  return {
    deliverAnalysisResult,
    notifyAnalysisTerminal(input) {
      const pending = deliverAnalysisResult(input).catch(() => {
        // Best-effort channel: a delivery failure never surfaces into the worker.
      });
      inFlight.add(pending);
      void pending.finally(() => inFlight.delete(pending));
    },
    async sendTestDelivery(input) {
      const nowIso = now().toISOString();
      return runDelivery({
        organizationId: input.organizationId,
        logDomainId: input.domainId,
        kind: "test",
        payload: {
          event: "log-analysis.test",
          logDomainId: input.domainId,
          occurredAt: nowIso,
          message: "WiseEff log-analysis webhook test delivery."
        },
        maxAttempts: 1
      });
    },
    async flush() {
      await Promise.all([...inFlight]);
    }
  };
}
