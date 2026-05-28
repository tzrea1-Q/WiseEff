import type { Database } from "../../shared/database/client";
import type { ObjectStoreHealthCheck } from "../logs/objectStore";
import type { WiseEffRouter } from "../../shared/http/router";
import { buildLiveHealth, buildReadyHealth } from "./health";

export function registerOperationsRoutes(router: WiseEffRouter, options: { db?: Database; objectStore?: ObjectStoreHealthCheck }) {
  router.get("/health/live", async () => ({
    status: 200,
    body: buildLiveHealth()
  }));

  router.get("/health/ready", async () => buildReadyHealth({ db: options.db, objectStore: options.objectStore, includeWorkerQueue: true }));

  router.get("/api/v1/health", async () => ({
    status: 200,
    body: { ok: true, service: "wiseeff-api" }
  }));
}
