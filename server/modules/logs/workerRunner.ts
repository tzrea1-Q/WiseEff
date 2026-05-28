import { loadServerEnv } from "../../config/env";
import type { Database } from "../../shared/database/client";
import { createPostgresDatabase } from "../../shared/database/client";
import { createLocalObjectStore, type ObjectStore } from "./objectStore";
import { startLogWorkerLoop, type ProcessLogWorkerOptions } from "./worker";

type RawWorkerEnv = {
  DATABASE_URL?: string;
  OBJECT_STORE_ROOT?: string;
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
    objectStore: createLocalObjectStore(env.OBJECT_STORE_ROOT)
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
