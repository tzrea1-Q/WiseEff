import type { Database } from "../../shared/database/client";
import type { WiseEffRouter } from "../../shared/http/router";
import { buildLiveHealth, buildReadyHealth } from "./health";

export function registerOperationsRoutes(router: WiseEffRouter, options: { db?: Database }) {
  router.get("/health/live", async () => ({
    status: 200,
    body: buildLiveHealth()
  }));

  router.get("/health/ready", async () => buildReadyHealth({ db: options.db }));

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));
}
