import { registerAuditRoutes } from "./modules/audit/routes";
import { registerAgentRoutes } from "./modules/agent/routes";
import type { AgentProvider } from "./modules/agent/provider";
import { createAuthContextResolver } from "./modules/auth/contextFactory";
import { getAuthContext } from "./modules/auth/repository";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { createTokenVerifier, type TokenVerifier } from "./modules/auth/tokenVerifier";
import { registerJobRoutes } from "./modules/jobs/routes";
import type { DebugDeviceGateway } from "./modules/debugging/gateway";
import { registerDebuggingRoutes } from "./modules/debugging/routes";
import { registerLogRoutes } from "./modules/logs/routes";
import { buildReadyHealth } from "./modules/operations/health";
import { registerOperationsRoutes, type PilotReadinessEnv } from "./modules/operations/routes";
import { createMetricsRegistry } from "./observability/metrics";
import type { ObjectStore, ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import { registerParameterRoutes } from "./modules/parameters/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter, type RouteRequest } from "./shared/http/router";
import type { Database } from "./shared/database/client";
import type { ServerEnv } from "./config/env";

async function getCurrentAuthContext(options: { db?: Database }, request: RouteRequest) {
  const userId = request.headers["x-wiseeff-user"]?.toString() ?? developmentAuthContext.user.id;
  return options.db ? getAuthContext(options.db, userId) : developmentAuthContext;
}

export function createWiseEffServer(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    debugGateway?: DebugDeviceGateway;
    agentProvider?: AgentProvider;
    env?: PilotReadinessEnv;
    auth?: { mode: "development" | "production"; verifier?: TokenVerifier };
  } = {}
) {
  const router = createRouter();
  const metrics = createMetricsRegistry({ serviceName: "wiseeff-api" });
  const authResolver = createAuthContextResolver({
    mode: options.auth?.mode ?? "development",
    verifier: options.auth?.verifier,
    developmentAuthContext,
    getDevelopmentAuthContext: (request) => getCurrentAuthContext(options, request as RouteRequest)
  });

  registerOperationsRoutes(router, {
    db: options.db,
    objectStore: options.objectStoreHealth,
    agentProvider: options.agentProvider,
    debugGateway: options.debugGateway,
    env: options.env,
    getCurrentAuthContext: authResolver
  });

  registerAuthRoutes(router, { getCurrentAuthContext: authResolver });
  registerAuditRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerParameterRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver
  });
  registerLogRoutes(router, {
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
    getCurrentAuthContext: authResolver
  });
  registerAgentRoutes(router, {
    db: options.db,
    getCurrentAuthContext: authResolver,
    provider: options.agentProvider
  });

  router.get("/metrics", async () => {
    const readyHealth = await buildReadyHealth({
      db: options.db,
      objectStore: options.objectStoreHealth,
      includeWorkerQueue: true,
      agentProvider: options.agentProvider
    });
    const readiness = readyHealth.body.status === "ready" ? "ready" : "not_ready";
    metrics.setReadinessStatus(readiness);
    metrics.setDependencyHealth({ dependency: "database", ok: readyHealth.body.dependencies.database.ok });
    metrics.setDependencyHealth({ dependency: "objectStore", ok: readyHealth.body.dependencies.objectStore.ok });
    if (readyHealth.body.dependencies.agentProvider) {
      metrics.setDependencyHealth({ dependency: "agentProvider", ok: readyHealth.body.dependencies.agentProvider.ok });
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

    return {
      status: 200,
      text: metrics.renderPrometheus(),
      contentType: "text/plain; version=0.0.4; charset=utf-8"
    };
  });

  return createHttpServer(router, { metrics });
}

export function createWiseEffServerFromEnv(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    debugGateway?: DebugDeviceGateway;
    agentProvider?: AgentProvider;
    env: ServerEnv;
  }
) {
  const verifier =
    options.env.AUTH_MODE === "production"
      ? createTokenVerifier({ issuer: options.env.AUTH_TOKEN_ISSUER!, secret: options.env.AUTH_TOKEN_HMAC_SECRET! })
      : undefined;
  return createWiseEffServer({
    ...options,
    auth: { mode: options.env.AUTH_MODE, verifier }
  });
}
