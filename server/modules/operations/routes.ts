import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { ObjectStoreHealthCheck } from "../logs/objectStore";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { DebugDeviceGateway } from "../debugging/gateway";
import type { DebugDeviceGatewayRegistry } from "../debugging/gatewayRegistry";
import { buildLiveHealth, buildReadyHealth, checkXiaozeLlmConfig, type DurableQueueHealthCheck, type XiaozeLlmEnv } from "./health";
import { buildPilotReadiness, type PilotReadinessGateStatus } from "./pilotReadiness";

export type PilotReadinessEnv = {
  NODE_ENV?: "development" | "test" | "production";
  AUTH_PROVIDER?: "hmac" | "oidc" | "local";
  DEBUG_DEVICE_GATEWAY_MODE?: "simulator" | "hdc" | "adb" | "multi";
  DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION?: boolean;
  HDC_DEVICE_LAB_AVAILABLE?: boolean;
  HDC_SMOKE_PROJECT_ID?: string;
  HDC_SMOKE_DEVICE_ID?: string;
  HDC_SMOKE_TARGET_REF?: string;
  HDC_SMOKE_PARAMETER_ID?: string;
  HDC_SMOKE_NODE_PATH?: string;
  HDC_SMOKE_WRITE_VALUE?: string;
  M5_DEVICE_GATEWAY_EVIDENCE?: string;
  M5_CONTRACT_CHECK_PASSED?: boolean;
  M5_CONTRACT_ARTIFACT_CHECKED_AT?: string;
  /** CI/test-only hook; not part of ServerEnv or .env.example. */
  XIAOZE_DETERMINISTIC?: boolean;
} & XiaozeLlmEnv;

function requireAdminAccess(auth: AuthContext) {
  if (!auth.permissions.includes("admin:access")) {
    throw new ApiError("FORBIDDEN", "Admin access required.", 403, { permission: "admin:access" });
  }
}

function backupDrillGate(): PilotReadinessGateStatus {
  const recordedAt = process.env.M5_BACKUP_RESTORE_DRILL_AT?.trim();

  if (recordedAt) {
    return {
      ok: true,
      status: "ready",
      message: `Backup/restore drill recorded at ${recordedAt}.`
    };
  }

  return {
    ok: false,
    status: "missing",
    message: "Restore drill not recorded."
  };
}

function contractEvidenceGate(env: PilotReadinessEnv): PilotReadinessGateStatus {
  if (env.M5_CONTRACT_CHECK_PASSED === true) {
    return {
      ok: true,
      status: "ready",
      message: "Contract check passed."
    };
  }

  const artifactCheckedAt = env.M5_CONTRACT_ARTIFACT_CHECKED_AT?.trim();
  if (artifactCheckedAt) {
    return {
      ok: true,
      status: "ready",
      message: `Contract artifact checked at ${artifactCheckedAt}.`
    };
  }

  return {
    ok: false,
    status: "missing",
    message: "Contract freshness evidence is not recorded. Set M5_CONTRACT_CHECK_PASSED=true or M5_CONTRACT_ARTIFACT_CHECKED_AT."
  };
}

const hdcSmokeEvidenceFields = [
  "HDC_SMOKE_PROJECT_ID",
  "HDC_SMOKE_DEVICE_ID",
  "HDC_SMOKE_TARGET_REF",
  "HDC_SMOKE_PARAMETER_ID",
  "HDC_SMOKE_NODE_PATH",
  "HDC_SMOKE_WRITE_VALUE"
] as const satisfies readonly (keyof PilotReadinessEnv)[];

function debugGatewayMode(value: unknown): NonNullable<PilotReadinessEnv["DEBUG_DEVICE_GATEWAY_MODE"]> {
  return value === "simulator" || value === "hdc" || value === "adb" || value === "multi" ? value : "multi";
}

function deviceGatewayEvidenceGate(env: PilotReadinessEnv): PilotReadinessGateStatus {
  const acceptanceEvidence = env.M5_DEVICE_GATEWAY_EVIDENCE?.trim();
  if (acceptanceEvidence) {
    return {
      ok: true,
      status: "ready",
      message: `Device gateway evidence recorded: ${acceptanceEvidence}.`
    };
  }

  if (env.HDC_DEVICE_LAB_AVAILABLE !== true) {
    return {
      ok: false,
      status: "missing",
      message:
        "HDC device-lab evidence is not recorded. Set HDC_DEVICE_LAB_AVAILABLE=true and the required HDC_SMOKE_* values, or provide M5_DEVICE_GATEWAY_EVIDENCE."
    };
  }

  const missingFields = hdcSmokeEvidenceFields.filter((field) => !env[field]?.trim());
  if (missingFields.length > 0) {
    return {
      ok: false,
      status: "missing",
      message: `HDC device-lab smoke evidence is incomplete. Missing: ${missingFields.join(", ")}.`
    };
  }

  return {
    ok: true,
    status: "ready",
    message: "HDC device-lab smoke evidence is recorded."
  };
}

function adbDeviceGatewayEvidenceGate(env: PilotReadinessEnv, mode: "adb" | "multi"): PilotReadinessGateStatus {
  const acceptanceEvidence = env.M5_DEVICE_GATEWAY_EVIDENCE?.trim();
  if (acceptanceEvidence) {
    return {
      ok: true,
      status: "ready",
      message: `Device gateway evidence recorded: ${acceptanceEvidence}.`
    };
  }

  return {
    ok: false,
    status: "missing",
    message: `${mode.toUpperCase()} device gateway evidence is not recorded. Set M5_DEVICE_GATEWAY_EVIDENCE after a hardware smoke.`
  };
}

function deviceGatewayGate(options: {
  debugGateway?: DebugDeviceGateway;
  debugGatewayRegistry?: DebugDeviceGatewayRegistry;
  env: PilotReadinessEnv;
}): PilotReadinessGateStatus {
  if (!options.debugGateway && !options.debugGatewayRegistry) {
    return {
      ok: false,
      status: "missing",
      message: "Debug device gateway is not configured for this API process."
    };
  }

  const mode = debugGatewayMode(options.env.DEBUG_DEVICE_GATEWAY_MODE);

  if (mode === "simulator") {
    return {
      ok: false,
      status: "blocked",
      message: "Simulator device gateway mode is not acceptable for pilot readiness."
    };
  }
  const requiredProtocols = mode === "multi" ? (["hdc", "adb"] as const) : ([mode] as const);
  if (options.debugGatewayRegistry) {
    const missingProtocols = requiredProtocols.filter((protocol) => !options.debugGatewayRegistry?.hasGateway(protocol));
    if (missingProtocols.length > 0) {
      return {
        ok: false,
        status: "missing",
        message: `${missingProtocols.map((protocol) => protocol.toUpperCase()).join("/")} debug device gateway is not configured for this API process.`
      };
    }
  } else if (requiredProtocols.includes("adb")) {
    return {
      ok: false,
      status: "missing",
      message: "ADB debug device gateway is not configured for this API process."
    };
  }

  return mode === "hdc" ? deviceGatewayEvidenceGate(options.env) : adbDeviceGatewayEvidenceGate(options.env, mode);
}

function xiaozeLlmGate(env: PilotReadinessEnv): PilotReadinessGateStatus {
  if (env.XIAOZE_DETERMINISTIC) {
    return {
      ok: false,
      status: "blocked",
      message: "Deterministic Xiaoze mode is not acceptable for pilot readiness."
    };
  }

  const health = checkXiaozeLlmConfig(env);
  if (!health) {
    return {
      ok: false,
      status: "missing",
      message: "Xiaoze LLM environment is not configured for this API process."
    };
  }

  return {
    ok: health.ok,
    status: health.status,
    message: health.message ?? "Xiaoze LLM configuration is available.",
    ...(health.details ? { details: health.details } : {})
  };
}

function defaultPilotReadinessEnv(): PilotReadinessEnv {
  return {
    NODE_ENV: (process.env.NODE_ENV as PilotReadinessEnv["NODE_ENV"]) ?? "development",
    DEBUG_DEVICE_GATEWAY_MODE: debugGatewayMode(process.env.DEBUG_DEVICE_GATEWAY_MODE),
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: process.env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION === "true",
    HDC_DEVICE_LAB_AVAILABLE: process.env.HDC_DEVICE_LAB_AVAILABLE === "true",
    HDC_SMOKE_PROJECT_ID: process.env.HDC_SMOKE_PROJECT_ID?.trim() || undefined,
    HDC_SMOKE_DEVICE_ID: process.env.HDC_SMOKE_DEVICE_ID?.trim() || undefined,
    HDC_SMOKE_TARGET_REF: process.env.HDC_SMOKE_TARGET_REF?.trim() || undefined,
    HDC_SMOKE_PARAMETER_ID: process.env.HDC_SMOKE_PARAMETER_ID?.trim() || undefined,
    HDC_SMOKE_NODE_PATH: process.env.HDC_SMOKE_NODE_PATH?.trim() || undefined,
    HDC_SMOKE_WRITE_VALUE: process.env.HDC_SMOKE_WRITE_VALUE?.trim() || undefined,
    M5_DEVICE_GATEWAY_EVIDENCE: process.env.M5_DEVICE_GATEWAY_EVIDENCE?.trim() || undefined,
    M5_CONTRACT_CHECK_PASSED: process.env.M5_CONTRACT_CHECK_PASSED === "true",
    M5_CONTRACT_ARTIFACT_CHECKED_AT: process.env.M5_CONTRACT_ARTIFACT_CHECKED_AT?.trim() || undefined,
    XIAOZE_DETERMINISTIC: process.env.XIAOZE_DETERMINISTIC === "true",
    AGENT_API_BASE_URL: process.env.AGENT_API_BASE_URL?.trim() || undefined,
    AGENT_API_KEY: process.env.AGENT_API_KEY?.trim() || undefined,
    AGENT_MODEL: process.env.AGENT_MODEL?.trim() || undefined,
    XIAOZE_MODEL: process.env.XIAOZE_MODEL?.trim() || undefined
  };
}

export function registerOperationsRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStoreHealthCheck;
    debugGateway?: DebugDeviceGateway;
    debugGatewayRegistry?: DebugDeviceGatewayRegistry;
    durableQueue?: DurableQueueHealthCheck;
    env?: PilotReadinessEnv;
    getCurrentAuthContext?: (request: RouteRequest) => Promise<AuthContext> | AuthContext;
  }
) {
  const env = { ...defaultPilotReadinessEnv(), ...(options.env ?? {}) };

  router.get("/health/live", async () => ({
    status: 200,
    body: buildLiveHealth()
  }));

  router.get("/health/ready", async () =>
    buildReadyHealth({
      db: options.db,
      objectStore: options.objectStore,
      env: options.env,
      durableQueue: options.durableQueue,
      includeWorkerQueue: true
    })
  );

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  router.get("/api/v1/operations/pilot-readiness", async (request) => {
    if (!options.getCurrentAuthContext) {
      throw new ApiError("INTERNAL_ERROR", "Auth context resolver is required for pilot readiness checks.", 500);
    }

    const auth = await options.getCurrentAuthContext(request);
    requireAdminAccess(auth);

    const readyHealth = await buildReadyHealth({
      db: options.db,
      objectStore: options.objectStore,
      includeWorkerQueue: true,
      durableQueue: options.durableQueue,
      env: options.env
    });
    const dependencies = readyHealth.body.dependencies;

    const readiness = buildPilotReadiness({
      contract: contractEvidenceGate(env),
      auth: {
        ok: true,
        status: "ready",
        message: "Admin access granted."
      },
      database: dependencies.database,
      objectStore: dependencies.objectStore,
      worker: dependencies.durableQueue ?? dependencies.workerQueue ?? {
        ok: false,
        status: "missing",
        message: "Worker queue health is unavailable."
      },
      deviceGateway: deviceGatewayGate({ debugGateway: options.debugGateway, debugGatewayRegistry: options.debugGatewayRegistry, env }),
      xiaozeLlm: xiaozeLlmGate(env),
      backups: backupDrillGate()
    });

    return {
      status: 200,
      body: readiness
    };
  });
}
