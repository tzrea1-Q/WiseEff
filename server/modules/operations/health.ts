import type { Database } from "../../shared/database/client";
import type { AgentProvider } from "../agent/provider";
import { checkWorkerQueueHealth, type WorkerQueueHealth } from "../jobs/workerHealth";
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
    workerQueue?: WorkerQueueHealth;
    agentProvider?: DependencyHealth;
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
      message: "Object storage is not configured for this API process."
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

async function checkAgentProvider(agentProvider?: AgentProvider): Promise<DependencyHealth | undefined> {
  if (!agentProvider?.checkHealth) {
    return undefined;
  }

  try {
    const result = await agentProvider.checkHealth();
    return {
      ok: result.ok,
      status: result.status,
      message: result.message
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Agent provider readiness check failed."
    };
  }
}

export async function buildReadyHealth(options: {
  db?: Pick<Database, "query">;
  objectStore?: ObjectStoreHealthCheck;
  includeWorkerQueue?: boolean;
  agentProvider?: AgentProvider;
}) {
  const database = await checkDatabase(options.db);
  const objectStore = await checkObjectStore(options.objectStore);
  const agentProvider = await checkAgentProvider(options.agentProvider);
  const workerQueue = options.includeWorkerQueue ? await checkWorkerQueueHealth(options.db) : undefined;
  const ok = database.ok && objectStore.ok && (workerQueue?.ok ?? true) && (agentProvider?.ok ?? true);

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service: "wiseeff-api",
      status: ok ? "ready" : "not_ready",
      dependencies: {
        database,
        objectStore,
        ...(workerQueue ? { workerQueue } : {}),
        ...(agentProvider ? { agentProvider } : {})
      }
    } satisfies OperationsHealthBody
  };
}
