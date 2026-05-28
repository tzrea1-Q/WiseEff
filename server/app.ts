import { registerAuditRoutes } from "./modules/audit/routes";
import { registerAgentRoutes } from "./modules/agent/routes";
import { createAuthContextResolver } from "./modules/auth/contextFactory";
import { getAuthContext } from "./modules/auth/repository";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { createTokenVerifier, type TokenVerifier } from "./modules/auth/tokenVerifier";
import { registerJobRoutes } from "./modules/jobs/routes";
import type { DebugDeviceGateway } from "./modules/debugging/gateway";
import { registerDebuggingRoutes } from "./modules/debugging/routes";
import { registerLogRoutes } from "./modules/logs/routes";
import { registerOperationsRoutes } from "./modules/operations/routes";
import type { ObjectStore, ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import { registerParameterRoutes } from "./modules/parameters/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter, type RouteRequest } from "./shared/http/router";
import type { Database } from "./shared/database/client";

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
    auth?: { mode: "development" | "production"; verifier?: TokenVerifier };
  } = {}
) {
  const router = createRouter();
  const authResolver = createAuthContextResolver({
    mode: options.auth?.mode ?? "development",
    verifier: options.auth?.verifier,
    developmentAuthContext,
    getDevelopmentAuthContext: (request) => getCurrentAuthContext(options, request as RouteRequest)
  });

  registerOperationsRoutes(router, { db: options.db, objectStore: options.objectStoreHealth });

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
    getCurrentAuthContext: authResolver
  });

  return createHttpServer(router);
}

export function createWiseEffServerFromEnv(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    debugGateway?: DebugDeviceGateway;
    env: {
      AUTH_MODE: "development" | "production";
      AUTH_TOKEN_ISSUER?: string;
      AUTH_TOKEN_HMAC_SECRET?: string;
    };
  }
) {
  const verifier =
    options.env.AUTH_MODE === "production"
      ? createTokenVerifier({ issuer: options.env.AUTH_TOKEN_ISSUER!, secret: options.env.AUTH_TOKEN_HMAC_SECRET! })
      : undefined;
  return createWiseEffServer({ ...options, auth: { mode: options.env.AUTH_MODE, verifier } });
}
