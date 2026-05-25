import { registerAuditRoutes } from "./modules/audit/routes";
import { developmentAuthContext, registerAuthRoutes } from "./modules/auth/routes";
import { createHttpServer } from "./shared/http/server";
import { createRouter } from "./shared/http/router";
import type { Queryable } from "./shared/database/client";

export function createWiseEffServer(options: { db?: Queryable } = {}) {
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

  return createHttpServer(router);
}
