import type { Database } from "../../shared/database/client";

export type DependencyHealth = {
  ok: boolean;
  status: "ready" | "missing" | "failed";
  message?: string;
};

export type OperationsHealthBody = {
  ok: boolean;
  service: "wiseeff-api";
  status: "live" | "ready" | "not_ready";
  dependencies?: {
    database: DependencyHealth;
  };
};

export function buildLiveHealth(): OperationsHealthBody {
  return {
    ok: true,
    service: "wiseeff-api",
    status: "live"
  };
}

async function checkDatabase(db?: Pick<Database, "query">): Promise<DependencyHealth> {
  if (!db) {
    return {
      ok: false,
      status: "missing",
      message: "DATABASE_URL is not configured for this API process."
    };
  }

  try {
    await db.query("select 1 as ok");
    return { ok: true, status: "ready" };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      message: error instanceof Error ? error.message : "Database readiness check failed."
    };
  }
}

export async function buildReadyHealth(options: { db?: Pick<Database, "query"> }) {
  const database = await checkDatabase(options.db);
  const ok = database.ok;

  return {
    status: ok ? 200 : 503,
    body: {
      ok,
      service: "wiseeff-api",
      status: ok ? "ready" : "not_ready",
      dependencies: { database }
    } satisfies OperationsHealthBody
  };
}
