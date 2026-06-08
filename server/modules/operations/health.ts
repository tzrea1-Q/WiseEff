import type { Database } from "../../shared/database/client";
import type { AgentProvider } from "../agent/provider";
import { buildDurableQueueHealth, type CombinedDurableQueueHealth } from "../jobs/queueHealth";
import type { DurableQueueHealth } from "../jobs/queuePort";
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
    durableQueue?: CombinedDurableQueueHealth;
    agentProvider?: DependencyHealth;
  };
};

export type DurableQueueHealthCheck = DurableQueueHealth | { checkHealth(): Promise<DurableQueueHealth> };

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
    const health = await objectStore.checkHealth();
    return health.ok ? health : { ...health, message: sanitizeObjectStoreFailure(health.message) };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: sanitizeObjectStoreFailure(error instanceof Error ? error.message : undefined)
    };
  }
}

function sanitizeObjectStoreFailure(message: string | undefined) {
  const value = message ?? "";
  const lower = value.toLowerCase();

  if (lower.includes("accessdenied") || lower.includes("access denied") || lower.includes("permission") || lower.includes("credential")) {
    return "Object store readiness failed: credentials or access policy denied. Verify endpoint, bucket policy, access key, and secret rotation.";
  }

  if (lower.includes("tls") || lower.includes("certificate") || lower.includes("ssl")) {
    return "Object store readiness failed: TLS validation failed. Verify the storage endpoint certificate chain and TLS policy.";
  }

  if (lower.includes("not found") || lower.includes("no such bucket") || lower.includes("bucket missing")) {
    return "Object store readiness failed: bucket was not found. Verify bucket name, region, and provisioning.";
  }

  if (lower.includes("read-back mismatch") || lower.includes("checksum") || lower.includes("metadata")) {
    return "Object store readiness failed: compatibility probe mismatch. Verify S3 metadata, checksum, read, write, and delete support.";
  }

  return "Object store readiness failed. Verify endpoint, bucket, credentials, TLS policy, and S3 compatibility.";
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

async function checkDurableQueue(durableQueue?: DurableQueueHealthCheck): Promise<DurableQueueHealth | undefined> {
  if (!durableQueue) return undefined;
  if ("checkHealth" in durableQueue) {
    return durableQueue.checkHealth();
  }
  return durableQueue;
}

export async function buildReadyHealth(options: {
  db?: Pick<Database, "query">;
  objectStore?: ObjectStoreHealthCheck;
  includeWorkerQueue?: boolean;
  durableQueue?: DurableQueueHealthCheck;
  agentProvider?: AgentProvider;
}) {
  const database = await checkDatabase(options.db);
  const objectStore = await checkObjectStore(options.objectStore);
  const agentProvider = await checkAgentProvider(options.agentProvider);
  const workerQueue = options.includeWorkerQueue ? await checkWorkerQueueHealth(options.db) : undefined;
  const durableQueueTransport = await checkDurableQueue(options.durableQueue);
  const durableQueue =
    durableQueueTransport && workerQueue
      ? buildDurableQueueHealth({ transport: durableQueueTransport, database: workerQueue })
      : undefined;
  const ok = database.ok && objectStore.ok && (workerQueue?.ok ?? true) && (durableQueue?.ok ?? true) && (agentProvider?.ok ?? true);

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
        ...(durableQueue ? { durableQueue } : {}),
        ...(agentProvider ? { agentProvider } : {})
      }
    } satisfies OperationsHealthBody
  };
}
