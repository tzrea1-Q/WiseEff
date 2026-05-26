import { registerAuditRoutes } from "./modules/audit/routes";
import { getAuthContext } from "./modules/auth/repository";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { registerParameterRoutes } from "./modules/parameters/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter, type RouteRequest } from "./shared/http/router";
import type { Database } from "./shared/database/client";

async function getCurrentAuthContext(options: { db?: Database }, request: RouteRequest) {
  const userId = request.headers["x-wiseeff-user"]?.toString() ?? developmentAuthContext.user.id;
  return options.db ? getAuthContext(options.db, userId) : developmentAuthContext;
}

export function createWiseEffServer(options: { db?: Database } = {}) {
  const router = createRouter();

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));

  registerAuthRoutes(router, { db: options.db });
  registerAuditRoutes(router, {
    db: options.db,
    getCurrentAuthContext: () => developmentAuthContext
  });
  registerParameterRoutes(router, {
    db: options.db,
    getCurrentAuthContext: (request) => getCurrentAuthContext(options, request)
  });

  return createHttpServer(router);
}
