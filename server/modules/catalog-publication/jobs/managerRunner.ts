import { createServer } from "node:http";

import { createUserInvocation } from "../../auth/trustedInvocation";
import { getAuthContext } from "../../auth/repository";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import {
  assertPublicationManagerProcessFence,
  resolvePublicationManagerOptions,
  readPublicationManagerHealth,
  startPublicationManagerLoop,
} from "./manager";

const redact = (fields: Record<string, string | number | boolean | null>) => {
  const copy = { ...fields };
  for (const key of Object.keys(copy)) {
    const lower = key.toLowerCase();
    if (lower.includes("dsn") || lower.includes("password") || lower.includes("url") || lower.includes("sql")) {
      delete copy[key];
    }
  }
  return copy;
};

const log = (fields: Record<string, string | number | boolean | null>) => {
  process.stdout.write(`${JSON.stringify(redact(fields))}\n`);
};

const databaseUrl = process.env.WISEEFF_PUBLICATION_MANAGER_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("WISEEFF_PUBLICATION_MANAGER_DATABASE_URL or DATABASE_URL is required");
}

assertPublicationManagerProcessFence(process.env);

const db = createPostgresDatabase(databaseUrl);
const pool = getRootPostgresPool(db);
if (!pool) {
  throw new Error("publication manager requires a root PostgreSQL pool");
}

const resolved = resolvePublicationManagerOptions(process.env);
const installer = createCatalogInstaller(pool);
const stop = startPublicationManagerLoop({
  db,
  pool,
  installer,
  resolvePublisherActor: async (principalId) => {
    try {
      return createUserInvocation(await getAuthContext(db, principalId));
    } catch {
      return null;
    }
  },
  ...resolved,
  log,
});

const healthPort = Number(process.env.WISEEFF_PUBLICATION_MANAGER_HEALTH_PORT ?? "8791");
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health/live") {
    try {
      const health = await readPublicationManagerHealth(db);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, service: "wiseeff-publication-manager", ...health }));
    } catch {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, service: "wiseeff-publication-manager" }));
    }
    return;
  }
  response.statusCode = 404;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(healthPort, "127.0.0.1");

const shutdown = () => {
  stop();
  server.close();
  void db.close();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
