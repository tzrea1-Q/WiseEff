import type { Database } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import type { AuthContext } from "../auth/types";
import type { ObjectStoreHealthCheck } from "../logs/objectStore";
import type { RouteRequest, WiseEffRouter } from "../../shared/http/router";
import type { AgentProvider } from "../agent/provider";
import type { DebugDeviceGateway } from "../debugging/gateway";
import { buildLiveHealth, buildReadyHealth } from "./health";
import { buildPilotReadiness, type PilotReadinessGateStatus } from "./pilotReadiness";

export type PilotReadinessEnv = {
  NODE_ENV?: "development" | "test" | "production";
  DEBUG_DEVICE_GATEWAY_MODE?: "simulator" | "hdc";
  DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION?: boolean;
  HDC_DEVICE_LAB_AVAILABLE?: boolean;
  HDC_SMOKE_PROJECT_ID?: string;
  HDC_SMOKE_DEVICE_ID?: string;
  HDC_SMOKE_TARGET_REF?: string;
  HDC_SMOKE_PARAMETER_ID?: string;
  HDC_SMOKE_NODE_PATH?: string;
  HDC_SMOKE_WRITE_VALUE?: string;
  M5_DEVICE_GATEWAY_EVIDENCE?: string;
  AGENT_PROVIDER?: "deterministic" | "live";
};

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

const hdcSmokeEvidenceFields = [
  "HDC_SMOKE_PROJECT_ID",
  "HDC_SMOKE_DEVICE_ID",
  "HDC_SMOKE_TARGET_REF",
  "HDC_SMOKE_PARAMETER_ID",
  "HDC_SMOKE_NODE_PATH",
  "HDC_SMOKE_WRITE_VALUE"
] as const satisfies readonly (keyof PilotReadinessEnv)[];

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

function deviceGatewayGate(options: { debugGateway?: DebugDeviceGateway; env: PilotReadinessEnv }): PilotReadinessGateStatus {
  if (!options.debugGateway) {
    return {
      ok: false,
      status: "missing",
      message: "Debug device gateway is not configured for this API process."
    };
  }

  const mode = options.env.DEBUG_DEVICE_GATEWAY_MODE ?? "simulator";

  if (mode !== "hdc") {
    return {
      ok: false,
      status: "blocked",
      message: "Simulator device gateway mode is not acceptable for pilot readiness."
    };
  }

  return deviceGatewayEvidenceGate(options.env);
}

async function agentProviderGate(options: { agentProvider?: AgentProvider; env: PilotReadinessEnv }): Promise<PilotReadinessGateStatus> {
  if (!options.agentProvider) {
    return {
      ok: false,
      status: "missing",
      message: "Agent provider is not configured for this API process."
    };
  }

  const providerMode = options.env.AGENT_PROVIDER ?? options.agentProvider.metadata().provider;
  if (providerMode !== "live") {
    return {
      ok: false,
      status: "blocked",
      message: "Deterministic agent provider mode is not acceptable for pilot readiness."
    };
  }

  if (!options.agentProvider.checkHealth) {
    return {
      ok: false,
      status: "missing",
      message: "Live agent provider health is not available."
    };
  }

  const health = await options.agentProvider.checkHealth();
  return {
    ok: health.ok,
    status: health.status,
    message: health.message ?? "Live agent provider health is available."
  };
}

function defaultPilotReadinessEnv(): PilotReadinessEnv {
  return {
    NODE_ENV: (process.env.NODE_ENV as PilotReadinessEnv["NODE_ENV"]) ?? "development",
    DEBUG_DEVICE_GATEWAY_MODE: process.env.DEBUG_DEVICE_GATEWAY_MODE === "hdc" ? "hdc" : "simulator",
    DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: process.env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION === "true",
    HDC_DEVICE_LAB_AVAILABLE: process.env.HDC_DEVICE_LAB_AVAILABLE === "true",
    HDC_SMOKE_PROJECT_ID: process.env.HDC_SMOKE_PROJECT_ID?.trim() || undefined,
    HDC_SMOKE_DEVICE_ID: process.env.HDC_SMOKE_DEVICE_ID?.trim() || undefined,
    HDC_SMOKE_TARGET_REF: process.env.HDC_SMOKE_TARGET_REF?.trim() || undefined,
    HDC_SMOKE_PARAMETER_ID: process.env.HDC_SMOKE_PARAMETER_ID?.trim() || undefined,
    HDC_SMOKE_NODE_PATH: process.env.HDC_SMOKE_NODE_PATH?.trim() || undefined,
    HDC_SMOKE_WRITE_VALUE: process.env.HDC_SMOKE_WRITE_VALUE?.trim() || undefined,
    M5_DEVICE_GATEWAY_EVIDENCE: process.env.M5_DEVICE_GATEWAY_EVIDENCE?.trim() || undefined,
    AGENT_PROVIDER: process.env.AGENT_PROVIDER === "live" ? "live" : "deterministic"
  };
}

export function registerOperationsRoutes(
  router: WiseEffRouter,
  options: {
    db?: Database;
    objectStore?: ObjectStoreHealthCheck;
    agentProvider?: AgentProvider;
    debugGateway?: DebugDeviceGateway;
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
      agentProvider: options.agentProvider,
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
      agentProvider: options.agentProvider
    });
    const dependencies = readyHealth.body.dependencies;

    const readiness = buildPilotReadiness({
      contract: {
        ok: true,
        status: "ready",
        message: "Route manifest and schema registry are loaded."
      },
      auth: {
        ok: true,
        status: "ready",
        message: "Admin access granted."
      },
      database: dependencies.database,
      objectStore: dependencies.objectStore,
      worker: dependencies.workerQueue ?? {
        ok: false,
        status: "missing",
        message: "Worker queue health is unavailable."
      },
      deviceGateway: deviceGatewayGate({ debugGateway: options.debugGateway, env }),
      agentProvider: await agentProviderGate({ agentProvider: options.agentProvider, env }),
      backups: backupDrillGate()
    });

    return {
      status: 200,
      body: readiness
    };
  });
}
