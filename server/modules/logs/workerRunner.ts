import { createServer } from "node:http";
import { loadServerEnv } from "../../config/env";
import { resolveKnowledgeEmbeddingClient } from "../knowledge/indexing/embeddingClient";
import { createMetricsRegistry, type MetricsRegistry } from "../../observability/metrics";
import { defaultTracingBoundary } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import { openRuntimeDatabase } from "../../shared/database/runtimeConnection";
import { createObjectStoreFromEnv } from "../../objectStoreFactory";
import type { LogAnalysisAdapter } from "./analyzer";
import { createLogAnalyzerFromEnv } from "./analyzer/analyzerFromEnv";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, type LogAnalysisQueueRuntimeEnv } from "./logAnalysisQueueRuntime";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createLogWebhookDeliverer } from "./webhookDelivery";
import {
  startLogWebhookDeliveryRetentionLoop,
  type LogWebhookDeliveryRetentionLoopStarter
} from "./webhookRetention";
import { startLogWorkerLoop, type LogWorkerWebhooks, type ProcessLogWorkerOptions } from "./worker";

type RawWorkerEnv = {
  DATABASE_URL?: string;
  LOG_ANALYSIS_QUEUE_MODE?: "polling" | "durable";
  REDIS_URL?: string;
  OBJECT_STORE_MODE?: "local" | "s3";
  OBJECT_STORE_ROOT?: string;
  OBJECT_STORAGE_ENDPOINT?: string;
  OBJECT_STORAGE_BUCKET?: string;
  OBJECT_STORAGE_ACCESS_KEY_ID?: string;
  OBJECT_STORAGE_SECRET_ACCESS_KEY?: string;
  OBJECT_STORAGE_REGION?: string;
  LOG_WORKER_OBSERVABILITY_HOST?: string;
  LOG_WORKER_OBSERVABILITY_PORT?: string;
};

type LogWorkerRuntimeOptions = {
  db: Database;
  objectStore: ObjectStore;
  analyzer?: LogAnalysisAdapter;
  startLoop?: (options: ProcessLogWorkerOptions, intervalMs?: number) => () => void | Promise<void>;
  startRetentionLoop?: LogWebhookDeliveryRetentionLoopStarter;
  retention?: { enabled: boolean; keepPerDomain: number };
  createDurableRuntime?: typeof createLogAnalysisQueueRuntime;
  queueMode?: "polling" | "durable";
  env?: LogAnalysisQueueRuntimeEnv;
  workerId?: string;
  leaseTtlMs?: number;
  intervalMs?: number;
  metrics?: Pick<MetricsRegistry, "recordLogAnalysisJobResult">;
  webhooks?: LogWorkerWebhooks;
};

export function createLogWorkerObservabilityServer({ metrics }: { metrics: Pick<MetricsRegistry, "renderPrometheus"> }) {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, service: "wiseeff-log-worker", status: "live" }));
      return;
    }

    if (request.method === "GET" && request.url === "/metrics") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.end(metrics.renderPrometheus());
      return;
    }

    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "not_found" }));
  });
}

export function resolveLogWorkerObservabilityConfig(raw: RawWorkerEnv) {
  const port = Number(raw.LOG_WORKER_OBSERVABILITY_PORT ?? "8788");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("LOG_WORKER_OBSERVABILITY_PORT must be a positive integer.");
  }
  return {
    host: raw.LOG_WORKER_OBSERVABILITY_HOST?.trim() || "127.0.0.1",
    port
  };
}

export function validateLogWorkerConfig(raw: RawWorkerEnv) {
  if (!raw.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to start the log worker.");
  }
  if ((raw.LOG_ANALYSIS_QUEUE_MODE ?? "polling") === "durable" && !raw.REDIS_URL?.trim()) {
    throw new Error("REDIS_URL is required when LOG_ANALYSIS_QUEUE_MODE=durable.");
  }

  if ((raw.OBJECT_STORE_MODE ?? "local") === "s3") {
    if (
      !raw.OBJECT_STORAGE_ENDPOINT?.trim() ||
      !raw.OBJECT_STORAGE_BUCKET?.trim() ||
      !raw.OBJECT_STORAGE_ACCESS_KEY_ID?.trim() ||
      !raw.OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim()
    ) {
      throw new Error("S3 object storage settings are required to start the log worker.");
    }
    return;
  }

  if (!raw.OBJECT_STORE_ROOT?.trim()) {
    throw new Error("OBJECT_STORE_ROOT is required to start the log worker.");
  }
}

export function createLogWorkerRuntime({
  db,
  objectStore,
  analyzer,
  startLoop = startLogWorkerLoop,
  startRetentionLoop = startLogWebhookDeliveryRetentionLoop,
  retention,
  createDurableRuntime = createLogAnalysisQueueRuntime,
  queueMode = "polling",
  env,
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  intervalMs = 1000,
  metrics,
  webhooks
}: LogWorkerRuntimeOptions) {
  return {
    async start() {
      let stopWorker: () => void | Promise<void>;
      if (queueMode === "durable") {
        if (!env) {
          throw new Error("Durable log worker runtime requires Redis queue environment.");
        }
        const runtime = await createDurableRuntime({
          env,
          db,
          objectStore,
          workerId,
          metrics,
          tracing: defaultTracingBoundary,
          ...(analyzer ? { analyzer } : {}),
          ...(webhooks ? { webhooks } : {})
        });
        stopWorker = () => runtime.close();
      } else {
        stopWorker = startLoop(
          { db, objectStore, workerId, leaseTtlMs, metrics, ...(analyzer ? { analyzer } : {}), ...(webhooks ? { webhooks } : {}) },
          intervalMs
        );
      }

      try {
        const stopRetention = retention?.enabled
          ? startRetentionLoop({ db, keepPerDomain: retention.keepPerDomain })
          : undefined;
        let shutdown: Promise<void> | undefined;
        return () => shutdown ??= (async () => {
          // Invoke both callbacks even if one throws synchronously; settle both
          // before the owner can close the database they may still be using.
          const stop = async (callback?: () => void | Promise<void>) => callback?.();
          const results = await Promise.allSettled([stop(stopRetention), stop(stopWorker)]);
          const failed = results.find(result => result.status === "rejected");
          if (failed?.status === "rejected") throw failed.reason;
        })();
      } catch (error) {
        try { await stopWorker(); } catch { /* Preserve the initialization failure. */ }
        throw error;
      }
    }
  };
}

export async function createLogWorkerRuntimeFromEnv(raw: NodeJS.ProcessEnv = process.env) {
  await import("dotenv/config");
  const env = loadServerEnv(raw);
  validateLogWorkerConfig(env);

  const db = await openRuntimeDatabase({
    connectionString: env.DATABASE_URL!,
    nodeEnv: env.NODE_ENV,
    databaseOptions: { tracing: defaultTracingBoundary },
  });
  try {
    return await initializeLogWorkerRuntime(env, raw, db);
  } catch {
    // Initialization has not exposed a runtime or started a consumer. Closing
    // must not replace the static refusal with a credential-bearing DB error.
    await db.close().catch(() => undefined);
    throw new Error("PCAT-RUNTIME-WORKER-INITIALIZATION-FAILED");
  }
}

async function initializeLogWorkerRuntime(
  env: ReturnType<typeof loadServerEnv>,
  raw: NodeJS.ProcessEnv,
  db: Awaited<ReturnType<typeof openRuntimeDatabase>>,
) {
  await resolveParameterIdentityMode(db);

  const metrics = createMetricsRegistry({ serviceName: "wiseeff-log-worker" });
  const observability = resolveLogWorkerObservabilityConfig(raw);

  const runtime = createLogWorkerRuntime({
    db,
    objectStore: createObjectStoreFromEnv(env, { tracing: defaultTracingBoundary }),
    analyzer: createLogAnalyzerFromEnv(env, { db, embeddingClient: resolveKnowledgeEmbeddingClient(env) }),
    queueMode: env.LOG_ANALYSIS_QUEUE_MODE,
    env: {
      REDIS_URL: env.REDIS_URL ?? "",
      LOG_ANALYSIS_QUEUE_PREFIX: env.LOG_ANALYSIS_QUEUE_PREFIX,
      LOG_ANALYSIS_QUEUE_ATTEMPTS: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
      LOG_ANALYSIS_QUEUE_BACKOFF_MS: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS,
      LOG_ANALYSIS_QUEUE_CONCURRENCY: env.LOG_ANALYSIS_QUEUE_CONCURRENCY
    },
    webhooks: createLogWebhookDeliverer({
      db,
      env: {
        timeoutMs: env.LOG_WEBHOOK_TIMEOUT_MS,
        maxAttempts: env.LOG_WEBHOOK_MAX_ATTEMPTS,
        retryBaseDelayMs: env.LOG_WEBHOOK_RETRY_BASE_DELAY_MS,
        allowInsecureLocal: env.LOG_WEBHOOK_ALLOW_INSECURE_LOCAL
      }
    }),
    retention: {
      enabled: env.LOG_WEBHOOK_DELIVERY_RETENTION_ENABLED,
      keepPerDomain: env.LOG_WEBHOOK_DELIVERY_RETENTION_PER_DOMAIN
    },
    metrics
  });

  let started: ReturnType<typeof runtime.start> | undefined;
  let shutdown: Promise<void> | undefined;
  const close = () => shutdown ??= (async () => {
    let stop: Awaited<ReturnType<typeof runtime.start>> | undefined;
    try { stop = await started; } catch { /* start reports its original refusal. */ }
    let failed = false;
    try { await stop?.(); } catch { failed = true; }
    try { await db.close(); } catch { failed = true; }
    if (failed) throw new Error("PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED");
  })();
  return { metrics, observability, close, async start() {
    if (started || shutdown) throw new Error("PCAT-RUNTIME-WORKER-START-FAILED");
    started = runtime.start();
    try { await started; return close; }
    catch {
      await close().catch(() => undefined);
      throw new Error("PCAT-RUNTIME-WORKER-START-FAILED");
    }
  } };
}

/** Own the real listener and the admitted runtime together. No consumer starts
 * before the private observability endpoint has bound successfully. */
export async function startLogWorkerProcess(raw: NodeJS.ProcessEnv = process.env) {
  const runtime = await createLogWorkerRuntimeFromEnv(raw);
  const observabilityServer = createLogWorkerObservabilityServer({ metrics: runtime.metrics });
  let shutdown: Promise<void> | undefined;
  const stop = () => shutdown ??= (async () => {
    const results = await Promise.allSettled([runtime.close(), new Promise<void>((resolve, reject) => {
      observabilityServer.close(error => error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" ? reject(error) : resolve());
    })]);
    if (results.some(result => result.status === "rejected")) throw new Error("PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED");
  })();
  let failed = false;
  observabilityServer.on("error", () => { failed = true; void stop().catch(() => undefined); });
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error("PCAT-RUNTIME-WORKER-START-FAILED"));
      observabilityServer.once("error", onError);
      observabilityServer.listen(runtime.observability.port, runtime.observability.host, () => {
        observabilityServer.off("error", onError); resolve();
      });
    });
    await runtime.start();
    if (failed) throw new Error("PCAT-RUNTIME-WORKER-START-FAILED");
    return { stop, observabilityServer, observability: runtime.observability };
  } catch {
    await stop().catch(() => undefined);
    throw new Error("PCAT-RUNTIME-WORKER-START-FAILED");
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  try {
    const service = await startLogWorkerProcess();
    console.log(`WiseEff log worker observability listening on http://${service.observability.host}:${service.observability.port}`);
    const shutdown = () => { void service.stop().catch(() => {
      console.error("PCAT-RUNTIME-WORKER-SHUTDOWN-FAILED"); process.exitCode = 1;
    }).finally(() => { process.off("SIGINT", shutdown); process.off("SIGTERM", shutdown); }); };
    service.observabilityServer.on("error", () => { console.error("PCAT-RUNTIME-WORKER-START-FAILED"); process.exitCode = 1; shutdown(); });
    process.on("SIGINT", shutdown); process.on("SIGTERM", shutdown);
  } catch (error) {
    console.error(error instanceof Error && /^PCAT-[A-Z0-9-]+$/.test(error.message) ? error.message : "PCAT-RUNTIME-WORKER-START-FAILED");
    process.exitCode = 1;
  }
}
