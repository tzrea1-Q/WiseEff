import type { Database } from "../../shared/database/client";
import type { ObjectStoreHealthCheck } from "../logs/objectStore";

export type DependencyHealth = {
  ok: boolean;
  status: "ready" | "missing" | "failed";
  message?: string;
};

export type OperationsHealthBody = {
  ok: boolean;
  service: "wiseeff-api";
  status: "live" | "ready" | "not_ready";
  dependencies?: {
    database: DependencyHealth;
    objectStore: DependencyHealth;
  };
};

export function buildLiveHealth(): OperationsHealthBody {
  return {
    ok: true,
    service: "wiseeff-api",
    status: "live"
  };
}

async function checkDatabase(db?: Pick<Database, "query">): Promise<DependencyHealth> {
  if (!db) {
    return {
      ok: false,
      status: "missing",
      message: "DATABASE_URL is not configured for this API process."
    };
  }

  try {
    await db.query("select 1 as ok");
    return { ok: true, status: "ready" };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Database readiness check failed."
    };
  }
}

async function checkObjectStore(objectStore?: ObjectStoreHealthCheck): Promise<DependencyHealth> {
  if (!objectStore) {
    return {
      ok: false,
      status: "missing",
      message: "OBJECT_STORE_ROOT is not configured for this API process."
    };
  }

  try {
    return await objectStore.checkHealth();
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Object store readiness check failed."
    };
  }
}

export async function buildReadyHealth(options: { db?: Pick<Database, "query">; objectStore?: ObjectStoreHealthCheck }) {
  const database = await checkDatabase(options.db);
  const objectStore = await checkObjectStore(options.objectStore);
  const ok = database.ok && objectStore.ok;

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service: "wiseeff-api",
      status: ok ? "ready" : "not_ready",
      dependencies: { database, objectStore }
    } satisfies OperationsHealthBody
  };
}
