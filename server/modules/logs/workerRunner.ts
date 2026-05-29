import { loadServerEnv } from "../../config/env";
import type { Database } from "../../shared/database/client";
import { createPostgresDatabase } from "../../shared/database/client";
import { createObjectStoreFromEnv } from "../../objectStoreFactory";
import type { ObjectStore } from "./objectStore";
import { startLogWorkerLoop, type ProcessLogWorkerOptions } from "./worker";

type RawWorkerEnv = {
  DATABASE_URL?: string;
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
  workerId?: string;
  leaseTtlMs?: number;
  intervalMs?: number;
};

export function validateLogWorkerConfig(raw: RawWorkerEnv) {
  if (!raw.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required to start the log worker.");
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
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  intervalMs = 1000
}: LogWorkerRuntimeOptions) {
  return {
    start() {
      return startLoop({ db, objectStore, workerId, leaseTtlMs }, intervalMs);
    }
  };
}

export async function createLogWorkerRuntimeFromEnv(raw: NodeJS.ProcessEnv = process.env) {
  await import("dotenv/config");
  const env = loadServerEnv(raw);
  validateLogWorkerConfig(env);

  return createLogWorkerRuntime({
    db: createPostgresDatabase(env.DATABASE_URL!),
    objectStore: createObjectStoreFromEnv(env)
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
