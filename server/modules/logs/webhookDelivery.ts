import { randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import type { Database, Queryable } from "../../shared/database/client";
import { decideRetry } from "../jobs/retryPolicy";
import { claimLogWebhook, enqueueLogWebhook } from "./webhookOutbox";
import { decryptLogWebhookSecret, LogWebhookSecretDecryptionError } from "./webhookSecrets";
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
 * - Terminal-state transactions enqueue a durable event. Leased workers send
 *   asynchronously with bounded retries; consumers dedupe on the stable eventId.
 * - The payload is a compact summary (never raw log content or evidence text).
 * - Anti-SSRF: URL shape is validated up front, and the actual TCP connection
 *   resolves the hostname through a validating lookup that rejects private /
 *   loopback / link-local / metadata addresses — closing the DNS-rebinding gap
 *   between "check" and "connect". Redirects are not followed; response bodies
 *   are discarded; only the status code is recorded.
 */

import type { LogAnalysisResultWebhookInput } from "./webhookPayload";
export { buildLogResultWebhookPayload, WEBHOOK_CONCLUSION_SUMMARY_MAX_CHARS, type LogAnalysisResultWebhookInput } from "./webhookPayload";

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
    const deadline = setTimeout(() => request.destroy(new Error("Webhook delivery deadline exceeded.")), timeoutMs);
    request.on("close", () => clearTimeout(deadline));
    request.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException & { code?: string }).code;
      resolve({
        ok: false,
        error: code === "WISEEFF_WEBHOOK_SSRF_BLOCKED" ? "Webhook host resolves to a blocked address range." : error.message
      });
    });
    request.end(rawBody);
  });


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
  newId?: () => string;
};

export type LogWebhookDeliveryOutcome = {
  status: "delivered" | "failed" | "skipped" | "retrying";
  attempts: number;
  httpStatus?: number;
  error?: string;
};

export type LogWebhookDeliverer = {
  /** Thin wake-up only; terminal-state repositories durably enqueue the event. */
  notifyAnalysisTerminal(input: LogAnalysisResultWebhookInput): void;
  /** Enqueue durably and process the first due attempt; retries are worker-owned. */
  deliverAnalysisResult(input: LogAnalysisResultWebhookInput): Promise<LogWebhookDeliveryOutcome>;
  sendTestDelivery(input: { organizationId: string; domainId: string }): Promise<LogWebhookDeliveryOutcome>;
  processNext(id?: string): Promise<LogWebhookDeliveryOutcome | null>;
  flush(): Promise<void>;
  start(): () => Promise<void>;
};

export function createLogWebhookDeliverer({
  db, env, transport = nodeWebhookTransport, metrics, now = () => new Date(), newId = randomUUID
}: LogWebhookDelivererOptions): LogWebhookDeliverer {
  const ssrf: WebhookSsrfOptions = { allowInsecureLocal: env.allowInsecureLocal };

  async function sendAttempt(queryable: Queryable, input: {
    organizationId: string; logDomainId: string; logRecordId?: string; runId?: string;
    kind: "result" | "test"; payload: unknown; attempt: number; maxAttempts: number;
  }): Promise<LogWebhookDeliveryOutcome> {
    const config = await getLogDomainWebhookConfig(queryable, {
      organizationId: input.organizationId, domainId: input.logDomainId
    });
    if (!config?.enabled || !config.url?.trim() || !config.secret?.trim()) {
      if (input.kind === "test") metrics?.recordLogAnalysisWebhookDelivery({ domain: input.logDomainId, outcome: "skipped" });
      return { status: "skipped", attempts: 0, error: input.kind === "test"
        ? "Webhook is not fully configured (URL, secret, and enabled are all required)." : undefined };
    }
    const startedAtMs = now().getTime();
    const validation = validateWebhookUrl(config.url, ssrf);
    let result: WebhookTransportResult;
    let signingFailed = false;
    if (!validation.ok) {
      result = { ok: false, error: `${validation.reason}: ${validation.message}` };
    } else {
      try {
        const secret = config.secretEncrypted
          ? decryptLogWebhookSecret(config.secret, input.organizationId, input.logDomainId)
          : config.secret;
        const rawBody = JSON.stringify(input.payload);
        const timestampSeconds = Math.floor(now().getTime() / 1000);
        result = await transport({
          url: validation.url, rawBody,
          headers: {
            [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload({ secret, timestampSeconds, rawBody }),
            [WEBHOOK_TIMESTAMP_HEADER]: String(timestampSeconds)
          },
          timeoutMs: env.timeoutMs, ssrf
        });
      } catch (error) {
        signingFailed = error instanceof LogWebhookSecretDecryptionError;
        result = { ok: false, error: error instanceof LogWebhookSecretDecryptionError ? error.message : "Webhook signing or transport failed." };
      }
    }
    const blocked = !validation.ok || result.error === "Webhook host resolves to a blocked address range.";
    const status = result.ok ? "delivered" : blocked || signingFailed || input.attempt >= input.maxAttempts ? "failed" : "retrying";
    const recording = insertLogWebhookDelivery(queryable, {
      id: newId(), organizationId: input.organizationId, logDomainId: input.logDomainId,
      logRecordId: input.logRecordId, runId: input.runId, kind: input.kind,
      attempt: input.attempt, status, httpStatus: result.httpStatus, error: result.error
    });
    if (input.kind === "test") await recording.catch(() => { /* keep the observed single-send result */ });
    else await recording;
    metrics?.recordLogAnalysisWebhookDelivery({
      domain: input.logDomainId, outcome: blocked ? "blocked" : status,
      durationMs: Math.max(0, now().getTime() - startedAtMs)
    });
    return { status, attempts: input.attempt, httpStatus: result.httpStatus, error: validation.ok ? result.error : validation.message };
  }

  async function processNext(id?: string): Promise<LogWebhookDeliveryOutcome | null> {
    const row = await claimLogWebhook(db, Math.max(60_000, env.timeoutMs * 2), id);
    if (!row) return null;
    return db.transaction(async (tx) => {
      // Keep the row lock through send + bookkeeping. Even an expired lease cannot
      // cause a second live worker to send this attempt; a crash releases the lock.
      const locked = await tx.query(
        `select id from log_webhook_outbox where id = $1 and lease_token = $2
         and status = 'processing' for update`, [row.id, row.lease_token]
      );
      if (!locked.rows.length) return null;
      const outcome = await sendAttempt(tx, {
        organizationId: row.organization_id, logDomainId: row.log_domain_id,
        logRecordId: row.log_record_id, runId: row.run_id, kind: "result",
        payload: row.payload, attempt: row.attempts + 1, maxAttempts: env.maxAttempts
      });
      const decision = decideRetry({
        attemptCount: outcome.attempts, maxAttempts: env.maxAttempts,
        // Preserve the existing first retry delay (the shared policy starts at 2x).
        baseDelayMs: env.retryBaseDelayMs / 2, now: now()
      });
      await tx.query(
        `update log_webhook_outbox set status = $3, attempts = $4, next_attempt_at = $5,
           lease_token = null, lease_expires_at = null, updated_at = now()
         where id = $1 and lease_token = $2`,
        [row.id, row.lease_token, outcome.status === "retrying" ? "retry" : outcome.status === "delivered" ? "delivered" : "failed",
          outcome.attempts, decision.action === "retry" ? decision.nextRunAt : now().toISOString()]
      );
      return outcome;
    });
  }

  let draining: Promise<void> | undefined;
  function flush(): Promise<void> {
    if (!draining) {
      draining = (async () => { while (await processNext()) { /* drain due rows */ } })()
        .catch(() => { /* durable rows remain due or recover after lease expiry */ })
        .finally(() => { draining = undefined; });
    }
    return draining;
  }

  return {
    processNext, flush,
    async deliverAnalysisResult(input) {
      const id = await enqueueLogWebhook(db, input);
      if (!id) return { status: "skipped", attempts: 0 };
      return (await processNext(id)) ?? { status: "skipped", attempts: 0 };
    },
    notifyAnalysisTerminal() { void flush(); },
    async sendTestDelivery(input) {
      return sendAttempt(db, {
        organizationId: input.organizationId, logDomainId: input.domainId, kind: "test",
        payload: { event: "log-analysis.test", logDomainId: input.domainId,
          occurredAt: now().toISOString(), message: "WiseEff log-analysis webhook test delivery." },
        attempt: 1, maxAttempts: 1
      });
    },
    start() {
      const tick = () => { void flush(); };
      const timer = setInterval(tick, 1000);
      tick();
      return async () => { clearInterval(timer); await draining; };
    }
  };
}
