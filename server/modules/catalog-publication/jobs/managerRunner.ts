import { createServer } from "node:http";

import { createUserInvocation } from "../../auth/trustedInvocation";
import { getAuthContext } from "../../auth/repository";
import { createCatalogInstaller } from "../../catalog-kernel/install/installer";
import { createPostgresDatabase, getRootPostgresPool } from "../../../shared/database/client";
import { resolvePublicationManagerDatabaseUrl } from "../runtime/managerDatabaseUrl";
import {
  assertPublicationManagerEntry,
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

assertPublicationManagerEntry(process.env);

const resolvedUrl = resolvePublicationManagerDatabaseUrl(process.env);
const healthPort = Number(process.env.WISEEFF_PUBLICATION_MANAGER_HEALTH_PORT ?? "8791");

if (!resolvedUrl.ok) {
  log({ event: "unconfigured", code: resolvedUrl.error.code, configured: false });
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      response.statusCode = 503;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ok: false,
          configured: false,
          service: "wiseeff-publication-manager",
          code: resolvedUrl.error.code,
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.listen(healthPort, "127.0.0.1");
  const shutdown = () => {
    server.close();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
} else {
  const db = createPostgresDatabase(resolvedUrl.url);
  const pool = getRootPostgresPool(db);
  if (!pool) {
    throw new Error("publication manager requires a root PostgreSQL pool");
  }
  const superuser = await pool.query<{ rolsuper: boolean }>(
    `select rolsuper from pg_roles where rolname = current_user`,
  );
  if (superuser.rows[0]?.rolsuper === true) {
    throw new Error("publication manager LOGIN must not be a superuser");
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

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health/live") {
      try {
        const health = await readPublicationManagerHealth(db);
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({ ok: true, configured: true, service: "wiseeff-publication-manager", ...health }),
        );
      } catch {
        response.statusCode = 503;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: false, configured: true, service: "wiseeff-publication-manager" }));
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
}
