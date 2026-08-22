import type { Database } from "../../shared/database/client";
import type { ResolvedXiaozeLlmConfig } from "../../config/xiaozeLlmConfig";
import { buildDurableQueueHealth, type CombinedDurableQueueHealth } from "../jobs/queueHealth";
import type { DurableQueueHealth } from "../jobs/queuePort";
import { checkWorkerQueueHealth, type WorkerQueueHealth } from "../jobs/workerHealth";
import type { NotificationOutboxHealth } from "../notifications/outboxHealth";
import { checkNotificationOutboxHealth } from "../notifications/outboxHealth";
import type { ObjectStoreHealthCheck } from "../logs/objectStore";
import { isXiaozeDeterministicMode } from "../agent/xiaoze/runtimeMode";

export type DependencyHealth = {
  ok: boolean;
  status: "ready" | "missing" | "failed";
  message?: string;
  details?: Record<string, string | number | boolean>;
};

export type XiaozeLlmEnv = {
  XIAOZE_LLM_CONFIG?: ResolvedXiaozeLlmConfig;
};

export type LogAnalysisLlmEnv = {
  LOG_ANALYSIS_API_BASE_URL?: string;
  LOG_ANALYSIS_API_KEY?: string;
  LOG_ANALYSIS_MODEL?: string;
  LOG_ANALYSIS_DETERMINISTIC?: boolean;
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
    notificationOutbox?: NotificationOutboxHealth;
    xiaozeLlm?: DependencyHealth;
    logAnalysisLlm?: DependencyHealth;
    dtsToolchain?: DependencyHealth;
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

function readNonBlank(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function checkXiaozeLlmConfig(env?: XiaozeLlmEnv): DependencyHealth | undefined {
  if (isXiaozeDeterministicMode()) {
    return {
      ok: true,
      status: "ready",
      message: "Xiaoze deterministic mode; LLM API not required."
    };
  }

  const config = env?.XIAOZE_LLM_CONFIG?.config;
  if (!config) {
    return undefined;
  }

  const baseUrl = config.apiBaseUrl;
  const apiKey = config.apiKey;
  const missing: string[] = [];
  if (!baseUrl) {
    missing.push("XIAOZE_LLM_API_BASE_URL");
  }
  if (!apiKey) {
    missing.push("XIAOZE_LLM_API_KEY");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      status: "missing",
      message: `Xiaoze LLM configuration is incomplete. Missing: ${missing.join(", ")}.`
    };
  }

  const details: Record<string, string | number | boolean> = {
    baseUrlConfigured: true,
    model: config.model
  };

  return {
    ok: true,
    status: "ready",
    message: "Xiaoze LLM configuration is available.",
    details
  };
}

/** Mirrors the Xiaoze LLM gate for the log-analysis provider family (`LOG_ANALYSIS_*`). */
export function checkLogAnalysisLlmConfig(env?: LogAnalysisLlmEnv): DependencyHealth | undefined {
  if (!env) {
    return undefined;
  }

  if (env.LOG_ANALYSIS_DETERMINISTIC === true) {
    return {
      ok: true,
      status: "ready",
      message: "Log analysis deterministic mode; LLM API not required."
    };
  }

  const baseUrl = readNonBlank(env.LOG_ANALYSIS_API_BASE_URL);
  const apiKey = readNonBlank(env.LOG_ANALYSIS_API_KEY);
  const missing: string[] = [];
  if (!baseUrl) {
    missing.push("LOG_ANALYSIS_API_BASE_URL");
  }
  if (!apiKey) {
    missing.push("LOG_ANALYSIS_API_KEY");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      status: "missing",
      message: `Log analysis LLM configuration is incomplete; analyses degrade to the rule engine. Missing: ${missing.join(", ")}.`
    };
  }

  const details: Record<string, string | number | boolean> = {
    baseUrlConfigured: true
  };
  const model = readNonBlank(env.LOG_ANALYSIS_MODEL);
  if (model) {
    details.model = model;
  }

  return {
    ok: true,
    status: "ready",
    message: "Log analysis LLM configuration is available.",
    details
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

async function checkDurableQueue(durableQueue?: DurableQueueHealthCheck): Promise<DurableQueueHealth | undefined> {
  if (!durableQueue) return undefined;
  if ("checkHealth" in durableQueue) {
    return durableQueue.checkHealth();
  }
  return durableQueue;
}

async function checkDtsToolchain(): Promise<DependencyHealth> {
  try {
    const { probeDtsToolchain, loadPinnedToolchainVersions } = await import(
      "../parameter-files/dtsToolchain"
    );
    const pinned = loadPinnedToolchainVersions();
    const probe = await probeDtsToolchain();
    const ok = Boolean(probe.dtc.path && probe.fdtoverlay.path && probe.dtschema.path);
    return {
      ok,
      status: ok ? "ready" : "missing",
      message: ok
        ? "DTS toolchain (dtc, fdtoverlay, dt-validate) is available."
        : "DTS toolchain incomplete; release validation will fail closed.",
      details: {
        dtc: probe.dtc.version ?? "unavailable",
        fdtoverlay: probe.fdtoverlay.version ?? "unavailable",
        dtschema: probe.dtschema.version ?? "unavailable",
        pinnedDtc: pinned.dtc.version,
        pinnedDtcCommit: pinned.dtc.commit,
        pinnedDtschema: pinned.dtschema
      }
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "DTS toolchain probe failed."
    };
  }
}

export async function buildReadyHealth(options: {
  db?: Pick<Database, "query">;
  objectStore?: ObjectStoreHealthCheck;
  includeWorkerQueue?: boolean;
  includeNotificationOutbox?: boolean;
  includeDtsToolchain?: boolean;
  durableQueue?: DurableQueueHealthCheck;
  env?: XiaozeLlmEnv & LogAnalysisLlmEnv;
}) {
  const database = await checkDatabase(options.db);
  const objectStore = await checkObjectStore(options.objectStore);
  const xiaozeLlm = checkXiaozeLlmConfig(options.env);
  const logAnalysisLlm = checkLogAnalysisLlmConfig(options.env);
  const workerQueue = options.includeWorkerQueue ? await checkWorkerQueueHealth(options.db) : undefined;
  const notificationOutbox = options.includeNotificationOutbox ? await checkNotificationOutboxHealth(options.db) : undefined;
  const durableQueueTransport = await checkDurableQueue(options.durableQueue);
  const durableQueue =
    durableQueueTransport && workerQueue
      ? buildDurableQueueHealth({ transport: durableQueueTransport, database: workerQueue })
      : undefined;
  const dtsToolchain = options.includeDtsToolchain === false ? undefined : await checkDtsToolchain();
  const ok =
    database.ok &&
    objectStore.ok &&
    (workerQueue?.ok ?? true) &&
    (notificationOutbox?.ok ?? true) &&
    (durableQueue?.ok ?? true) &&
    (xiaozeLlm?.ok ?? true) &&
    (logAnalysisLlm?.ok ?? true);
  // dtsToolchain is reported but does not gate process readiness (release gate is fail-closed separately).

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
        ...(notificationOutbox ? { notificationOutbox } : {}),
        ...(durableQueue ? { durableQueue } : {}),
        ...(xiaozeLlm ? { xiaozeLlm } : {}),
        ...(logAnalysisLlm ? { logAnalysisLlm } : {}),
        ...(dtsToolchain ? { dtsToolchain } : {})
      }
    } satisfies OperationsHealthBody
  };
}
