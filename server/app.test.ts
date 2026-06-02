import { describe, expect, it } from "vitest";
import { createWiseEffServer } from "./app";
import type { Database, QueryResult } from "./shared/database/client";
import { createHttpServer } from "./shared/http/server";
import { requestJson } from "./test/testClient";

type QueryCall = {
  text: string;
  values: unknown[];
};

function createAuthBoundaryDb() {
  const calls: QueryCall[] = [];
  const db: Database = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });

      if (text.includes("from users")) {
        return {
          rows: [
            {
              user_id: "user-no-parameter-view",
              organization_id: "org-1",
              organization_name: "ChargeLab",
              name: "No View User",
              email: "noview@example.com",
              title: "No View",
              is_active: true,
              project_id: null,
              role_id: "no-parameter-view"
            }
          ] as Row[],
          rowCount: 1
        };
      }

      if (text.includes("from projects")) {
        return {
          rows: [{ id: "aurora", name: "Aurora", code: "AUR" }] as Row[],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    },
    transaction: async (fn) => fn(db)
  };

  return { calls, db };
}

function createObservabilityDb() {
  const db: Database = {
    query: async <Row,>(text: string): Promise<QueryResult<Row>> => {
      if (text.includes("from jobs")) {
        return {
          rows: [
            {
              queued: "3",
              processing: "1",
              dead_lettered: "0",
              oldest_queued_at: null
            }
          ] as Row[],
          rowCount: 1
        };
      }

      return { rows: [{ ok: 1 } as Row], rowCount: 1 };
    },
    transaction: async (fn) => fn(db)
  };

  return db;
}

describe("WiseEff API", () => {
  it("serves the health endpoint", async () => {
    const response = await requestJson(createWiseEffServer(), "/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, service: "wiseeff-api" });
  });

  it("serves Prometheus metrics and records request outcomes", async () => {
    const server = createWiseEffServer();

    await requestJson(server, "/api/v1/health");
    const response = await requestJson(server, "/metrics");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(response.bodyText).toContain("wiseeff_build_info");
    expect(response.bodyText).toContain('wiseeff_http_requests_total{method="GET",route="/api/v1/health",status="200"} 1');
    expect(response.bodyText).not.toMatch(/authorization|password|secret|token/i);
  });

  it("refreshes dependency and worker readiness metrics before rendering /metrics", async () => {
    const response = await requestJson(
      createWiseEffServer({
        db: createObservabilityDb(),
        objectStoreHealth: {
          checkHealth: async () => ({ ok: true as const, status: "ready" as const })
        },
        agentProvider: {
          metadata: () => ({ provider: "live" as const, model: "pilot", promptVersion: "m6" }),
          planTurn: async () => ({
            assistantDraft: { content: "ready", citations: [], confidence: 0.9 },
            toolRequests: [],
            provider: "live" as const,
            model: "pilot",
            promptVersion: "m6"
          }),
          checkHealth: async () => ({ ok: true as const, status: "ready" as const })
        }
      }),
      "/metrics"
    );

    expect(response.status).toBe(200);
    expect(response.bodyText).toContain('wiseeff_readiness_status{status="ready"} 1');
    expect(response.bodyText).toContain('wiseeff_dependency_health{dependency="database"} 1');
    expect(response.bodyText).toContain('wiseeff_database_ready 1');
    expect(response.bodyText).toContain('wiseeff_object_store_ready 1');
    expect(response.bodyText).toContain('wiseeff_agent_provider_ready 1');
    expect(response.bodyText).toContain('wiseeff_queue_backlog{queue="log-analysis"} 3');
  });

  it("parses query strings with repeated params", async () => {
    const server = createHttpServer({
      handle: async (request) => ({
        status: 200,
        body: {
          risk: request.query.risk,
          q: request.query.q
        }
      })
    });

    const response = await requestJson(server, "/api/v1/search?risk=High&risk=Low&q=thermal");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ risk: ["High", "Low"], q: "thermal" });
  });

  it("serves browser CORS preflight for API mode", async () => {
    const server = createHttpServer({
      handle: async () => ({
        status: 200,
        body: { ok: true }
      })
    });

    const response = await requestJson(server, "/api/v1/parameters", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")).toContain("content-type");
  });

  it("uses request auth context for integrated parameter routes", async () => {
    const { calls, db } = createAuthBoundaryDb();

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({ db }),
      "/api/v1/projects",
      {
        headers: { "X-WiseEff-User": "user-no-parameter-view" }
      }
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({
      code: "FORBIDDEN",
      message: "Parameter view permission is required."
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("from users");
    expect(calls[0].values).toEqual(["user-no-parameter-view"]);
  });

  it("uses production bearer auth for /me without development fallback", async () => {
    const response = await requestJson<{ user: { id: string }; organization: { id: string } }>(
      createWiseEffServer({
        auth: {
          mode: "production",
          verifier: {
            verify: async () => ({
              user: {
                id: "u-prod",
                organizationId: "org-prod",
                name: "Prod User",
                email: "prod@example.com",
                title: "Pilot Admin",
                isActive: true
              },
              organization: { id: "org-prod", name: "Pilot Org" },
              roles: [{ projectId: null, roleId: "admin" }],
              permissions: ["admin:access", "parameter:view"]
            })
          }
        }
      }),
      "/api/v1/me",
      { headers: { Authorization: "Bearer signed-token" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("u-prod");
    expect(response.body.organization.id).toBe("org-prod");
  });

  it("rejects production routes without bearer auth instead of falling back to development auth", async () => {
    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        auth: {
          mode: "production",
          verifier: {
            verify: async () => {
              throw new Error("Authorization bearer token is required.");
            }
          }
        }
      }),
      "/api/v1/me"
    );

    expect(response.status).toBe(401);
    expect(response.body.error).toMatchObject({
      code: "UNAUTHENTICATED",
      message: "Authorization bearer token is required."
    });
  });
});
