import { registerAuditRoutes } from "./modules/audit/routes";
import { registerNotificationRoutes } from "./modules/notifications/routes";
import { registerXiaozeRoutes } from "./modules/agent/xiaoze/agUiEndpoint";
import { createAuthContextResolver } from "./modules/auth/contextFactory";
import { createLocalAuthService } from "./modules/auth/localAuth";
import { getAuthContext } from "./modules/auth/repository";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import type { AuthContext } from "./modules/auth/types";
import { createOidcVerifier } from "./modules/auth/oidcVerifier";
import { createTokenVerifier, type TokenVerifier } from "./modules/auth/tokenVerifier";
import { registerJobRoutes } from "./modules/jobs/routes";
import type { DebugDeviceGateway } from "./modules/debugging/gateway";
import type { DebugDeviceGatewayRegistry } from "./modules/debugging/gatewayRegistry";
import { registerDebuggingRoutes } from "./modules/debugging/routes";
import { createBridgeConnectionPool } from "./modules/deviceBridge/connectionPool";
import { createDeviceBridgeRepository } from "./modules/deviceBridge/repository";
import type { BridgeRpcClient } from "./modules/deviceBridge/rpc";
import { createPairingService } from "./modules/deviceBridge/pairingService";
import { loadLatestBridgeReleaseManifest } from "./modules/deviceBridge/releaseManifest";
import { loadLatestBridgeToolReleaseManifest } from "./modules/deviceBridge/toolReleaseManifest";
import { registerDeviceBridgeRoutes } from "./modules/deviceBridge/routes";
import { registerDeviceBridgeDownloadRoutes } from "./modules/deviceBridge/downloadRoutes";
import type { DeviceBridgeWsHandler } from "./modules/deviceBridge/wsHandler";
import { attachDeviceBridgeWebSocket, createDeviceBridgeWsHandler } from "./modules/deviceBridge/wsHandler";
import { registerLogRoutes } from "./modules/logs/routes";
import { buildReadyHealth, type DurableQueueHealthCheck } from "./modules/operations/health";
import { registerOperationsRoutes, type PilotReadinessEnv } from "./modules/operations/routes";
import { createMetricsRegistry, type MetricsRegistry } from "./observability/metrics";
import { defaultTracingBoundary, type TracingBoundary } from "./observability/tracing";
import type { ObjectStore, ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import type { LogAnalysisQueue } from "./modules/logs/logAnalysisQueue";
import { registerParameterRoutes } from "./modules/parameters/routes";
import { registerParameterDashboardRoutes } from "./modules/parameters/dashboard/routes";
import { registerProductFeedbackRoutes } from "./modules/product-feedback/routes";
import { registerUserRoutes } from "./modules/users/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter, type RouteRequest } from "./shared/http/router";
import type { Database } from "./shared/database/client";
import type { ServerEnv } from "./config/env";
import type { JsonWebKey } from "node:crypto";

type LocalAuthService = ReturnType<typeof createLocalAuthService>;

async function getCurrentAuthContext(options: { db?: Database }, request: RouteRequest) {
  const userId = request.headers["x-wiseeff-user"]?.toString() ?? developmentAuthContext.user.id;
  return options.db ? getAuthContext(options.db, userId) : developmentAuthContext;
}

function createEnvLocalAuthService(db: Database, env?: PilotReadinessEnv) {
  if (env?.AUTH_PROVIDER !== "local") {
    return undefined;
  }

  return createLocalAuthService(db, {
    ...(env.NODE_ENV === "development"
      ? {
          registrationOrganizationResolver: () => ({
            id: developmentAuthContext.organization.id,
            name: developmentAuthContext.organization.name
          })
        }
      : {})
  });
}

type DeviceBridgeEnv = Pick<
  ServerEnv,
  | "DEVICE_BRIDGE_ARTIFACT_ROOT"
  | "DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT"
  | "DEVICE_BRIDGE_PAIRING_TTL_SECONDS"
  | "DEVICE_BRIDGE_TOKEN_TTL_DAYS"
  | "DEVICE_BRIDGE_WS_PATH"
>;

export function createWiseEffServer(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    logAnalysisQueue?: LogAnalysisQueue;
    debugGateway?: DebugDeviceGateway;
    debugGatewayRegistry?: DebugDeviceGatewayRegistry;
    durableQueue?: DurableQueueHealthCheck;
    env?: PilotReadinessEnv & Partial<DeviceBridgeEnv>;
    auth?: { mode: "development" | "production"; verifier?: TokenVerifier };
    localAuthService?: LocalAuthService;
    tracing?: Pick<TracingBoundary, "withSpan">;
    metrics?: MetricsRegistry;
    deviceBridge?: DeviceBridgeRuntimeOptions;
  } = {}
) {
  const router = createRouter();
  const metrics = options.metrics ?? createMetricsRegistry({ serviceName: "wiseeff-api" });
  const tracing = options.tracing ?? defaultTracingBoundary;
  const localAuthService = options.localAuthService ?? (options.db ? createEnvLocalAuthService(options.db, options.env) : undefined);
  const authResolver = createAuthContextResolver({
    mode: options.auth?.mode ?? "development",
    verifier: options.auth?.verifier,
    db: options.db,
    localAuthResolver: localAuthService?.resolveSession,
    developmentAuthContext,
    getDevelopmentAuthContext: (request) => getCurrentAuthContext(options, request as RouteRequest)
  });

  registerOperationsRoutes(router, {
    db: options.db,
    objectStore: options.objectStoreHealth,
    debugGateway: options.debugGateway,
    debugGatewayRegistry: options.debugGatewayRegistry,
    durableQueue: options.durableQueue,
    env: options.env,
    getCurrentAuthContext: authResolver
  });

  registerAuthRoutes(router, { getCurrentAuthContext: authResolver, localAuthService });
  registerAuditRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerNotificationRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerUserRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerParameterRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerParameterDashboardRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerLogRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    logAnalysisQueue: options.logAnalysisQueue,
    getCurrentAuthContext: authResolver
  });
  registerProductFeedbackRoutes(router, {
    db: options.db,
    objectStore: options.objectStore,
    getCurrentAuthContext: authResolver
  });
  registerJobRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerDebuggingRoutes(router, {
    db: options.db,
    debugGateway: options.debugGateway,
    debugGatewayRegistry: options.debugGatewayRegistry,
    debugGatewayMode: options.env?.DEBUG_DEVICE_GATEWAY_MODE,
    metrics,
    tracing,
    ...(options.deviceBridge?.connectionPool ? { bridgeConnectionPool: options.deviceBridge.connectionPool } : {}),
    ...(options.deviceBridge?.rpcClient ? { bridgeRpcClient: options.deviceBridge.rpcClient } : {}),
    getCurrentAuthContext: authResolver
  });
  registerDeviceBridgeRoutes(router, buildDeviceBridgeRouteOptions(options, authResolver));
  registerDeviceBridgeDownloadRoutes(router, {
    artifactRoot: options.deviceBridge?.artifactRoot ?? options.env?.DEVICE_BRIDGE_ARTIFACT_ROOT,
    toolArtifactRoot: options.deviceBridge?.toolArtifactRoot ?? options.env?.DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT
  });
  registerXiaozeRoutes(router, {
    db: options.db,
    env: options.env as ServerEnv | undefined,
    getCurrentAuthContext: authResolver
  });

  router.get("/metrics", async () => {
    const readyHealth = await buildReadyHealth({
      db: options.db,
      objectStore: options.objectStoreHealth,
      includeWorkerQueue: true,
      includeNotificationOutbox: options.env?.NOTIFICATION_WORKER_ENABLED === true,
      durableQueue: options.durableQueue,
      env: options.env
    });
    const readiness = readyHealth.body.status === "ready" ? "ready" : "not_ready";
    metrics.setReadinessStatus(readiness);
    metrics.setDependencyHealth({ dependency: "database", ok: readyHealth.body.dependencies.database.ok });
    metrics.setDependencyHealth({ dependency: "objectStore", ok: readyHealth.body.dependencies.objectStore.ok });
    if (readyHealth.body.dependencies.xiaozeLlm) {
      metrics.setXiaozeLlmHealth({ ok: readyHealth.body.dependencies.xiaozeLlm.ok });
    }
    if (readyHealth.body.dependencies.workerQueue) {
      metrics.setQueueStats({
        queue: "log-analysis",
        queued: readyHealth.body.dependencies.workerQueue.queued,
        processing: readyHealth.body.dependencies.workerQueue.processing,
        deadLettered: readyHealth.body.dependencies.workerQueue.deadLettered,
        oldestQueuedAgeMs: readyHealth.body.dependencies.workerQueue.oldestQueuedAgeMs
      });
    }
    if (readyHealth.body.dependencies.notificationOutbox) {
      metrics.setQueueStats({
        queue: "notification-outbox",
        queued: readyHealth.body.dependencies.notificationOutbox.queued,
        processing: readyHealth.body.dependencies.notificationOutbox.processing,
        deadLettered: readyHealth.body.dependencies.notificationOutbox.deadLettered,
        oldestQueuedAgeMs: readyHealth.body.dependencies.notificationOutbox.oldestQueuedAgeMs
      });
    }

    return {
      status: 200,
      text: metrics.renderPrometheus(),
      contentType: "text/plain; version=0.0.4; charset=utf-8"
    };
  });

  return attachDeviceBridgeServer(createHttpServer(router, { metrics, tracing }), options);
}

function buildDeviceBridgeRouteOptions(
  options: {
    db?: Database;
    env?: PilotReadinessEnv & Partial<DeviceBridgeEnv>;
    deviceBridge?: DeviceBridgeRuntimeOptions;
  },
  getCurrentAuthContext: (request: RouteRequest) => Promise<AuthContext> | AuthContext
) {
  const runtime = resolveDeviceBridgeRuntime(options);
  if (!runtime) {
    return {
      db: options.db,
      getCurrentAuthContext
    };
  }

  return {
    db: options.db,
    getCurrentAuthContext,
    pairingService: runtime.pairingService,
    loadReleaseManifest: runtime.loadReleaseManifest,
    loadToolReleaseManifest: runtime.loadToolReleaseManifest
  };
}

type DeviceBridgeRuntimeOptions = {
  artifactRoot?: string;
  toolArtifactRoot?: string;
  pairingTtlMs?: number;
  tokenTtlDays?: number;
  wsPath?: string;
  wsHandler?: DeviceBridgeWsHandler;
  connectionPool?: ReturnType<typeof createBridgeConnectionPool>;
  rpcClient?: Pick<BridgeRpcClient, "call">;
};

function resolveDeviceBridgeRuntime(options: {
  db?: Database;
  env?: PilotReadinessEnv & Partial<DeviceBridgeEnv>;
  deviceBridge?: DeviceBridgeRuntimeOptions;
}) {
  const artifactRoot = options.deviceBridge?.artifactRoot ?? options.env?.DEVICE_BRIDGE_ARTIFACT_ROOT;
  const toolArtifactRoot = options.deviceBridge?.toolArtifactRoot ?? options.env?.DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT;
  if (!artifactRoot && !toolArtifactRoot) {
    return undefined;
  }

  const loadReleaseManifest = artifactRoot ? () => loadLatestBridgeReleaseManifest(artifactRoot) : undefined;
  const loadToolReleaseManifest = toolArtifactRoot
    ? () => loadLatestBridgeToolReleaseManifest(toolArtifactRoot)
    : undefined;

  if (!options.db) {
    return { loadReleaseManifest, loadToolReleaseManifest };
  }

  const repo = createDeviceBridgeRepository(options.db);
  const pairingTtlMs =
    options.deviceBridge?.pairingTtlMs ??
    (options.env?.DEVICE_BRIDGE_PAIRING_TTL_SECONDS !== undefined
      ? options.env.DEVICE_BRIDGE_PAIRING_TTL_SECONDS * 1000
      : undefined);
  const tokenTtlDays = options.deviceBridge?.tokenTtlDays ?? options.env?.DEVICE_BRIDGE_TOKEN_TTL_DAYS;

  return {
    loadReleaseManifest,
    loadToolReleaseManifest,
    pairingService: createPairingService({
      repo,
      ...(pairingTtlMs !== undefined ? { pairingTtlMs } : {}),
      ...(tokenTtlDays !== undefined ? { tokenTtlDays } : {})
    }),
    repo,
    wsPath: options.deviceBridge?.wsPath ?? options.env?.DEVICE_BRIDGE_WS_PATH ?? "/api/v1/device-bridges/ws",
    wsHandler:
      options.deviceBridge?.wsHandler ??
      (options.deviceBridge?.connectionPool
        ? createDeviceBridgeWsHandler({
            pool: options.deviceBridge.connectionPool,
            repo
          })
        : undefined)
  };
}

function attachDeviceBridgeServer(
  server: ReturnType<typeof createHttpServer>,
  options: {
    db?: Database;
    env?: PilotReadinessEnv & Partial<DeviceBridgeEnv>;
    deviceBridge?: DeviceBridgeRuntimeOptions;
  }
) {
  const runtime = resolveDeviceBridgeRuntime(options);
  const wsHandler = options.deviceBridge?.wsHandler ?? runtime?.wsHandler;
  const wsPath = options.deviceBridge?.wsPath ?? runtime?.wsPath ?? options.env?.DEVICE_BRIDGE_WS_PATH;

  if (wsHandler && wsPath) {
    attachDeviceBridgeWebSocket(server, { path: wsPath, wsHandler });
  }

  return server;
}

export function createWiseEffServerFromEnv(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    logAnalysisQueue?: LogAnalysisQueue;
    debugGateway?: DebugDeviceGateway;
    debugGatewayRegistry?: DebugDeviceGatewayRegistry;
    durableQueue?: DurableQueueHealthCheck;
    env: ServerEnv;
    authVerifierFactory?: (env: ServerEnv) => TokenVerifier;
    metrics?: MetricsRegistry;
    deviceBridge?: DeviceBridgeRuntimeOptions;
  }
) {
  const verifier =
    options.env.AUTH_MODE === "production" && options.env.AUTH_PROVIDER !== "local"
      ? options.authVerifierFactory?.(options.env) ?? createVerifierFromEnv(options.env)
      : undefined;
  return createWiseEffServer({
    ...options,
    auth: { mode: options.env.AUTH_MODE, verifier }
  });
}

function createVerifierFromEnv(env: ServerEnv): TokenVerifier {
  if (env.AUTH_PROVIDER === "local") {
    throw new Error("Local auth sessions are resolved through the database.");
  }

  if (env.AUTH_PROVIDER === "hmac") {
    return createTokenVerifier({ issuer: env.AUTH_TOKEN_ISSUER!, secret: env.AUTH_TOKEN_HMAC_SECRET! });
  }

  const issuer = env.AUTH_OIDC_ISSUER!.replace(/\/+$/, "");
  return createOidcVerifier({
    issuer,
    audience: env.AUTH_OIDC_AUDIENCE!,
    discovery: async () => {
      if (env.AUTH_OIDC_JWKS_URI?.trim()) {
        return { jwksUri: env.AUTH_OIDC_JWKS_URI.trim() };
      }

      const response = await fetch(`${issuer}/.well-known/openid-configuration`, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`OIDC discovery fetch failed with ${response.status}.`);
      }
      const body = (await response.json()) as { jwks_uri?: unknown };
      if (typeof body.jwks_uri !== "string" || !body.jwks_uri.trim()) {
        throw new Error("OIDC discovery document is missing jwks_uri.");
      }
      return { jwksUri: body.jwks_uri };
    },
    fetchJwks: async (jwksUri) => {
      if (!jwksUri) {
        throw new Error("OIDC JWKS URI is required.");
      }
      const response = await fetch(jwksUri, { headers: { Accept: "application/json" } });
      if (!response.ok) {
        throw new Error(`OIDC JWKS fetch failed with ${response.status}.`);
      }
      return (await response.json()) as { keys: JsonWebKey[] };
    }
  });
}
