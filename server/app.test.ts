import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "./app";
import { createWiseEffServerFromEnv } from "./app";
import { createMetricsRegistry } from "./observability/metrics";
import type { Database, QueryResult } from "./shared/database/client";
import { createHttpServer } from "./shared/http/server";
import { requestJson } from "./test/testClient";

type QueryCall = {
  text: string;
  values: unknown[];
};

const oidcNow = new Date("2026-06-02T00:00:00.000Z");

function createOidcKey(kid: string) {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = createPrivateKey(pair.privateKey.export({ format: "pem", type: "pkcs8" }));
  const publicKey = createPublicKey(pair.publicKey.export({ format: "pem", type: "spki" }));
  return {
    kid,
    privateKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig", kty: "RSA" }
  };
}

function createOidcJwt(input: { kid: string; privateKey: KeyObject; claims: Record<string, unknown> }) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: input.kid }), "utf8").toString("base64url");
  const payload = Buffer.from(JSON.stringify(input.claims), "utf8").toString("base64url");
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), input.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

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

function createProductionIdentityDb(input: {
  dbUserId: string;
  email: string;
  isActive?: boolean;
  roleId: string;
  organizationId?: string;
  organizationName?: string;
}) {
  const calls: QueryCall[] = [];
  const db: Database = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      calls.push({ text, values });

      if (text.includes("from users")) {
        const requestedOrganizationId = values[0];
        const identityValue = values[1];
        if (requestedOrganizationId !== (input.organizationId ?? "org-chargelab")) {
          return { rows: [], rowCount: 0 };
        }
        if (identityValue !== input.dbUserId && typeof identityValue === "string" && identityValue.toLowerCase() !== input.email.toLowerCase()) {
          return { rows: [], rowCount: 0 };
        }

        return {
          rows: [
            {
              user_id: input.dbUserId,
              organization_id: input.organizationId ?? "org-chargelab",
              organization_name: input.organizationName ?? "ChargeLab",
              name: "Governed User",
              email: input.email,
              title: "Governed",
              is_active: input.isActive ?? true,
              project_id: null,
              role_id: input.roleId
            }
          ] as Row[],
          rowCount: 1
        };
      }

      return { rows: [], rowCount: 0 };
    },
    transaction: async (fn) => fn(db)
  };

  return { calls, db };
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("exposes externally recorded worker metrics from the shared registry", async () => {
    const metrics = createMetricsRegistry({ serviceName: "wiseeff-api" });
    metrics.recordLogAnalysisJobResult({
      status: "complete",
      stage: "report",
      durationMs: 42
    });

    const response = await requestJson(createWiseEffServer({ metrics }), "/metrics");

    expect(response.status).toBe(200);
    expect(response.bodyText).toContain('wiseeff_log_analysis_job_duration_ms_sum{stage="report",status="complete"} 42');
  });

  it("renders labeled Pi Agent provider readiness metrics when evidence is available", async () => {
    const response = await requestJson(
      createWiseEffServer({
        db: createObservabilityDb(),
        objectStoreHealth: {
          checkHealth: async () => ({ ok: true as const, status: "ready" as const })
        },
        agentProvider: {
          metadata: () => ({
            provider: "live" as const,
            model: "model-a",
            promptVersion: "m7-pi-agent-v1",
            evidence: {
              provider: "live" as const,
              format: "pi" as const,
              piProvider: "minimax",
              model: "model-a",
              promptVersion: "m7-pi-agent-v1"
            }
          }),
          planTurn: async () => ({
            assistantDraft: { content: "ready", citations: [], confidence: 0.9 },
            toolRequests: [],
            provider: "live" as const,
            model: "model-a",
            promptVersion: "m7-pi-agent-v1"
          }),
          checkHealth: async () => ({ ok: true as const, status: "ready" as const })
        }
      }),
      "/metrics"
    );

    expect(response.status).toBe(200);
    expect(response.bodyText).toContain("wiseeff_agent_provider_ready 1");
    expect(response.bodyText).toContain('wiseeff_agent_provider_ready{provider="live",format="pi",piProvider="minimax"} 1');
    expect(response.bodyText).not.toContain("model-a");
    expect(response.bodyText).not.toContain("m7-pi-agent-v1");
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

  it("allows alternate local Vite ports without allowing arbitrary origins", async () => {
    const server = createHttpServer({
      handle: async () => ({
        status: 200,
        body: { ok: true }
      })
    });

    const localResponse = await requestJson(server, "/api/v1/me", {
      method: "OPTIONS",
      headers: {
        Origin: "http://127.0.0.1:5174",
        "Access-Control-Request-Method": "GET"
      }
    });
    const remoteResponse = await requestJson(server, "/api/v1/me", {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET"
      }
    });

    expect(localResponse.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5174");
    expect(remoteResponse.headers.get("access-control-allow-origin")).toBeNull();
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
    const { db } = createProductionIdentityDb({
      dbUserId: "u-prod",
      email: "prod@example.com",
      roleId: "admin",
      organizationId: "org-prod",
      organizationName: "Pilot Org"
    });
    const response = await requestJson<{ user: { id: string }; organization: { id: string } }>(
      createWiseEffServer({
        db,
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

  it("uses WiseEff DB roles instead of production OIDC token roles", async () => {
    const { calls, db } = createProductionIdentityDb({
      dbUserId: "u-governed",
      email: "governed@example.com",
      roleId: "hardware-user"
    });

    const response = await requestJson<{ user: { id: string }; roles: Array<{ roleId: string }>; permissions: string[] }>(
      createWiseEffServer({
        db,
        auth: {
          mode: "production",
          verifier: {
            verify: async () => ({
              user: {
                id: "oidc-sub-123",
                organizationId: "org-chargelab",
                name: "Token Admin",
                email: "governed@example.com",
                emailVerified: true,
                title: "Token",
                isActive: true
              },
              organization: { id: "org-chargelab", name: "ChargeLab" },
              roles: [{ projectId: null, roleId: "admin" }],
              permissions: ["admin:access", "users:manage"]
            })
          }
        }
      }),
      "/api/v1/me",
      { headers: { Authorization: "Bearer signed-token" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("u-governed");
    expect(response.body.roles).toEqual([{ projectId: null, roleId: "hardware-user" }]);
    expect(response.body.permissions).not.toContain("users:manage");
    expect(calls[0].values).toEqual(["org-chargelab", "oidc-sub-123"]);
    expect(calls[1].values).toEqual(["org-chargelab", "governed@example.com"]);
  });

  it("uses WiseEff DB active state instead of production OIDC token active claims", async () => {
    const { db } = createProductionIdentityDb({
      dbUserId: "u-disabled",
      email: "disabled@example.com",
      isActive: false,
      roleId: "admin"
    });

    const response = await requestJson<{ error: { code: string; message: string } }>(
      createWiseEffServer({
        db,
        auth: {
          mode: "production",
          verifier: {
            verify: async () => ({
              user: {
                id: "oidc-disabled",
                organizationId: "org-chargelab",
                name: "Token Active",
                email: "disabled@example.com",
                emailVerified: true,
                title: "Token",
                isActive: true
              },
              organization: { id: "org-chargelab", name: "ChargeLab" },
              roles: [{ projectId: null, roleId: "admin" }],
              permissions: ["admin:access", "users:manage"]
            })
          }
        }
      }),
      "/api/v1/me",
      { headers: { Authorization: "Bearer signed-token" } }
    );

    expect(response.status).toBe(403);
    expect(response.body.error).toMatchObject({ code: "FORBIDDEN", message: "User is inactive." });
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

  it("uses OIDC verifier when AUTH_PROVIDER=oidc in environment wiring", async () => {
    const { db } = createProductionIdentityDb({
      dbUserId: "oidc-user",
      email: "oidc@example.com",
      roleId: "admin"
    });
    const response = await requestJson<{ user: { id: string } }>(
      createWiseEffServerFromEnv({
        db,
        env: {
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: 8787,
          AUTH_MODE: "production",
          AUTH_PROVIDER: "oidc",
          AUTH_TOKEN_ISSUER: undefined,
          AUTH_TOKEN_HMAC_SECRET: undefined,
          AUTH_OIDC_ISSUER: "https://id.example.com/realms/wiseeff",
          AUTH_OIDC_AUDIENCE: "wiseeff-api",
          AUTH_OIDC_JWKS_URI: "https://id.example.com/realms/wiseeff/protocol/openid-connect/certs",
          DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
          OBJECT_STORE_MODE: "s3",
          OBJECT_STORE_ROOT: ".wiseeff-object-store",
          OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
          OBJECT_STORAGE_BUCKET: "wiseeff",
          OBJECT_STORAGE_ACCESS_KEY_ID: "key",
          OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
          OBJECT_STORAGE_REGION: undefined,
          DEBUG_DEVICE_GATEWAY_MODE: "simulator",
          HDC_TIMEOUT_MS: 5000,
          DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: true,
          AGENT_PROVIDER: "live",
          AGENT_API_FORMAT: "openai",
          AGENT_MODEL: "pilot-model",
          AGENT_API_KEY: "agent-key",
          AGENT_API_BASE_URL: "https://agent.example.com",
          AGENT_API_TIMEOUT_MS: 5000,
          AGENT_PROMPT_VERSION: "m5-agent-v1",
          LOG_WORKER_ENABLED: false,
          LOG_ANALYSIS_QUEUE_MODE: "polling",
          LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
          LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
          LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
          LOG_ANALYSIS_QUEUE_CONCURRENCY: 1,
          MOCK_RUNTIME_ENABLED: false
        },
        authVerifierFactory: () => ({
          verify: async () => ({
            user: {
              id: "oidc-user",
              organizationId: "org-chargelab",
              name: "OIDC User",
              email: "oidc@example.com",
              title: "Pilot Admin",
              isActive: true
            },
            organization: { id: "org-chargelab", name: "ChargeLab" },
            roles: [{ projectId: null, roleId: "admin" }],
            permissions: ["admin:access", "users:manage"]
          })
        })
      }),
      "/api/v1/me",
      { headers: { Authorization: "Bearer oidc-token" } }
    );

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("oidc-user");
  });

  it("discovers JWKS from the OIDC issuer when AUTH_OIDC_JWKS_URI is not configured", async () => {
    const { db } = createProductionIdentityDb({
      dbUserId: "u-oidc-discovered",
      email: "u-oidc-discovered@org-chargelab",
      roleId: "admin"
    });
    const key = createOidcKey("issuer-key");
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
      const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
      if (href.startsWith("http://127.0.0.1:")) {
        return originalFetch(url, init);
      }
      if (href === "https://id.example.com/realms/wiseeff/.well-known/openid-configuration") {
        return new Response(
          JSON.stringify({ jwks_uri: "https://id.example.com/realms/wiseeff/protocol/openid-connect/certs" }),
          { status: 200 }
        );
      }
      if (href === "https://id.example.com/realms/wiseeff/protocol/openid-connect/certs") {
        return new Response(JSON.stringify({ keys: [key.jwk] }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const token = createOidcJwt({
      kid: key.kid,
      privateKey: key.privateKey,
      claims: {
        iss: "https://id.example.com/realms/wiseeff",
        aud: "wiseeff-api",
        sub: "u-oidc-discovered",
        exp: 9999999999,
        organization_id: "org-chargelab",
        organization_name: "ChargeLab",
        wiseeff_roles: [{ projectId: null, roleId: "admin" }]
      }
    });

    const response = await requestJson<{ user: { id: string } }>(
      createWiseEffServerFromEnv({
        db,
        env: {
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          PORT: 8787,
          AUTH_MODE: "production",
          AUTH_PROVIDER: "oidc",
          AUTH_TOKEN_ISSUER: undefined,
          AUTH_TOKEN_HMAC_SECRET: undefined,
          AUTH_OIDC_ISSUER: "https://id.example.com/realms/wiseeff",
          AUTH_OIDC_AUDIENCE: "wiseeff-api",
          AUTH_OIDC_JWKS_URI: undefined,
          DATABASE_URL: "postgres://wiseeff:wiseeff@localhost:5432/wiseeff",
          OBJECT_STORE_MODE: "s3",
          OBJECT_STORE_ROOT: ".wiseeff-object-store",
          OBJECT_STORAGE_ENDPOINT: "https://storage.example.com",
          OBJECT_STORAGE_BUCKET: "wiseeff",
          OBJECT_STORAGE_ACCESS_KEY_ID: "key",
          OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
          OBJECT_STORAGE_REGION: undefined,
          DEBUG_DEVICE_GATEWAY_MODE: "simulator",
          HDC_TIMEOUT_MS: 5000,
          DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: true,
          AGENT_PROVIDER: "live",
          AGENT_API_FORMAT: "openai",
          AGENT_MODEL: "pilot-model",
          AGENT_API_KEY: "agent-key",
          AGENT_API_BASE_URL: "https://agent.example.com",
          AGENT_API_TIMEOUT_MS: 5000,
          AGENT_PROMPT_VERSION: "m5-agent-v1",
          LOG_WORKER_ENABLED: false,
          LOG_ANALYSIS_QUEUE_MODE: "polling",
          LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
          LOG_ANALYSIS_QUEUE_ATTEMPTS: 4,
          LOG_ANALYSIS_QUEUE_BACKOFF_MS: 1000,
          LOG_ANALYSIS_QUEUE_CONCURRENCY: 1,
          MOCK_RUNTIME_ENABLED: false
        }
      }),
      "/api/v1/me",
      { headers: { Authorization: `Bearer ${token}` } }
    );

    expect(response.status).toBe(200);
    expect(response.body.user.id).toBe("u-oidc-discovered");
    expect(fetchMock).toHaveBeenCalledWith("https://id.example.com/realms/wiseeff/.well-known/openid-configuration", {
      headers: { Accept: "application/json" }
    });
  });
});
