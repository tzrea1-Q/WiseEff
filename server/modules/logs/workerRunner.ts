import { createServer } from "node:http";
import { loadServerEnv } from "../../config/env";
import { resolveKnowledgeEmbeddingClient } from "../knowledge/indexing/embeddingClient";
import { createMetricsRegistry, type MetricsRegistry } from "../../observability/metrics";
import { defaultTracingBoundary } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import { createPostgresDatabase } from "../../shared/database/client";
import { createObjectStoreFromEnv } from "../../objectStoreFactory";
import type { LogAnalysisAdapter } from "./analyzer";
import { createLogAnalyzerFromEnv } from "./analyzer/analyzerFromEnv";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, type LogAnalysisQueueRuntimeEnv } from "./logAnalysisQueueRuntime";
import { resolveParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { createLogWebhookDeliverer } from "./webhookDelivery";
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
  startLoop?: (options: ProcessLogWorkerOptions, intervalMs?: number) => () => void;
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
    start() {
      if (queueMode === "durable") {
        if (!env) {
          throw new Error("Durable log worker runtime requires Redis queue environment.");
        }
        const runtime = createDurableRuntime({
          env,
          db,
          objectStore,
          workerId,
          metrics,
          tracing: defaultTracingBoundary,
          ...(analyzer ? { analyzer } : {}),
          ...(webhooks ? { webhooks } : {})
        });
        return () => runtime.close();
      }

      return startLoop(
        { db, objectStore, workerId, leaseTtlMs, metrics, ...(analyzer ? { analyzer } : {}), ...(webhooks ? { webhooks } : {}) },
        intervalMs
      );
    }
  };
}

export async function createLogWorkerRuntimeFromEnv(raw: NodeJS.ProcessEnv = process.env) {
  await import("dotenv/config");
  const env = loadServerEnv(raw);
  validateLogWorkerConfig(env);

  const db = createPostgresDatabase(env.DATABASE_URL!, { tracing: defaultTracingBoundary });
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
    metrics
  });

  return { ...runtime, metrics, observability };
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const runtime = await createLogWorkerRuntimeFromEnv();
  const stop = runtime.start();
  const observabilityServer = createLogWorkerObservabilityServer({ metrics: runtime.metrics });
  observabilityServer.listen(runtime.observability.port, runtime.observability.host, () => {
    console.log(
      `WiseEff log worker observability listening on http://${runtime.observability.host}:${runtime.observability.port}`
    );
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    await Promise.resolve(stop());
    observabilityServer.close(() => process.exit(0));
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
