import { registerAuditRoutes } from "./modules/audit/routes";
import { registerAgentRoutes } from "./modules/agent/routes";
import type { AgentProvider } from "./modules/agent/provider";
import { createAuthContextResolver } from "./modules/auth/contextFactory";
import { getAuthContext } from "./modules/auth/repository";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { createOidcVerifier } from "./modules/auth/oidcVerifier";
import { createTokenVerifier, type TokenVerifier } from "./modules/auth/tokenVerifier";
import { registerJobRoutes } from "./modules/jobs/routes";
import type { DebugDeviceGateway } from "./modules/debugging/gateway";
import { registerDebuggingRoutes } from "./modules/debugging/routes";
import { registerLogRoutes } from "./modules/logs/routes";
import { registerOperationsRoutes, type PilotReadinessEnv } from "./modules/operations/routes";
import type { ObjectStore, ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import { registerParameterRoutes } from "./modules/parameters/routes";
import { registerUserRoutes } from "./modules/users/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter, type RouteRequest } from "./shared/http/router";
import type { Database } from "./shared/database/client";
import type { ServerEnv } from "./config/env";
import type { JsonWebKey } from "node:crypto";

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
  const authResolver = createAuthContextResolver({
    mode: options.auth?.mode ?? "development",
    verifier: options.auth?.verifier,
    db: options.db,
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
  registerUserRoutes(router, {
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

  return createHttpServer(router);
}

export function createWiseEffServerFromEnv(
  options: {
    db?: Database;
    objectStore?: ObjectStore;
    objectStoreHealth?: ObjectStoreHealthCheck;
    debugGateway?: DebugDeviceGateway;
    agentProvider?: AgentProvider;
    env: ServerEnv;
    authVerifierFactory?: (env: ServerEnv) => TokenVerifier;
  }
) {
  const verifier = options.env.AUTH_MODE === "production" ? options.authVerifierFactory?.(options.env) ?? createVerifierFromEnv(options.env) : undefined;
  return createWiseEffServer({
    ...options,
    auth: { mode: options.env.AUTH_MODE, verifier }
  });
}

function createVerifierFromEnv(env: ServerEnv): TokenVerifier {
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
