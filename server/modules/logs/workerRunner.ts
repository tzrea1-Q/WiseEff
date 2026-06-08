import { loadServerEnv } from "../../config/env";
import type { MetricsRegistry } from "../../observability/metrics";
import { defaultTracingBoundary } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import { createPostgresDatabase } from "../../shared/database/client";
import { createObjectStoreFromEnv } from "../../objectStoreFactory";
import type { ObjectStore } from "./objectStore";
import { createLogAnalysisQueueRuntime, type LogAnalysisQueueRuntimeEnv } from "./logAnalysisQueueRuntime";
import { startLogWorkerLoop, type ProcessLogWorkerOptions } from "./worker";

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
};

type LogWorkerRuntimeOptions = {
  db: Database;
  objectStore: ObjectStore;
  startLoop?: (options: ProcessLogWorkerOptions, intervalMs?: number) => () => void;
  createDurableRuntime?: typeof createLogAnalysisQueueRuntime;
  queueMode?: "polling" | "durable";
  env?: LogAnalysisQueueRuntimeEnv;
  workerId?: string;
  leaseTtlMs?: number;
  intervalMs?: number;
  metrics?: Pick<MetricsRegistry, "recordLogAnalysisJobResult">;
};

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
  startLoop = startLogWorkerLoop,
  createDurableRuntime = createLogAnalysisQueueRuntime,
  queueMode = "polling",
  env,
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  intervalMs = 1000,
  metrics
}: LogWorkerRuntimeOptions) {
  return {
    start() {
      if (queueMode === "durable") {
        if (!env) {
          throw new Error("Durable log worker runtime requires Redis queue environment.");
        }
        const runtime = createDurableRuntime({ env, db, objectStore, workerId, metrics, tracing: defaultTracingBoundary });
        return () => runtime.close();
      }

      return startLoop({ db, objectStore, workerId, leaseTtlMs, metrics }, intervalMs);
    }
  };
}

export async function createLogWorkerRuntimeFromEnv(raw: NodeJS.ProcessEnv = process.env) {
  await import("dotenv/config");
  const env = loadServerEnv(raw);
  validateLogWorkerConfig(env);

  return createLogWorkerRuntime({
    db: createPostgresDatabase(env.DATABASE_URL!, { tracing: defaultTracingBoundary }),
    objectStore: createObjectStoreFromEnv(env, { tracing: defaultTracingBoundary }),
    queueMode: env.LOG_ANALYSIS_QUEUE_MODE,
    env: {
      REDIS_URL: env.REDIS_URL ?? "",
      LOG_ANALYSIS_QUEUE_PREFIX: env.LOG_ANALYSIS_QUEUE_PREFIX,
      LOG_ANALYSIS_QUEUE_ATTEMPTS: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
      LOG_ANALYSIS_QUEUE_BACKOFF_MS: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS,
      LOG_ANALYSIS_QUEUE_CONCURRENCY: env.LOG_ANALYSIS_QUEUE_CONCURRENCY
    }
  });
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  const runtime = await createLogWorkerRuntimeFromEnv();
  const stop = runtime.start();

  const shutdown = () => {
    stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
