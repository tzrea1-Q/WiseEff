import { expect, it, vi } from "vitest";
import { buildWiseEffRouter, createWiseEffServer } from "./app";
import * as application from "./app";
import { parameterCatalogLegacyWriteRouteIds } from "./modules/contracts/dtoSchemas/parameterCatalog";
import { routeManifest } from "./modules/contracts/routeManifest";
import { createPostgresDatabase, getRootPostgresPool, type Database, type QueryResult } from "./shared/database/client";
import { requestJson } from "./test/testClient";

it("the real app retires spec creation before the legacy service can query its source", async () => {
  const queries: string[] = [];
  const db: Database = {
    async query<Row>(text: string): Promise<QueryResult<Row>> {
      queries.push(text);
      if (text.includes("from users")) return { rows: [{
        user_id: "synthetic-admin", organization_id: "synthetic-org", organization_name: "Synthetic",
        name: "Synthetic", email: null, username: null, title: "", is_active: true,
        project_id: null, role_id: "admin",
      }] as Row[], rowCount: 1 };
      throw new Error("legacy source was reached");
    },
    transaction: async body => body(db),
  };
  const response = await requestJson<{ error: { code: string; details: { reason: string } } }>(
    createWiseEffServer({ db }), "/api/v2/parameter-specs", {
      method: "POST", body: JSON.stringify({ propertyKey: "synthetic-property", attributionSubjectId: "synthetic-subject", displayName: "Synthetic", reason: "synthetic retirement regression" }),
    });
  expect(response.status).toBe(410);
  expect(response.body.error.details.reason).toBe("legacy-surface-retired");
  expect(queries).toEqual([]);
});

const retiredRoutes = parameterCatalogLegacyWriteRouteIds.map(id => {
  const route = routeManifest.find(candidate => candidate.id === id);
  if (!route) throw new Error(`Missing frozen retired route: ${id}`);
  return route;
});

it("reads retired HTTP control evidence only from the actual application registration owner", () => {
  const { router } = buildWiseEffRouter();
  const observe = (application as typeof application & {
    observeCatalogHttpWriterControls(router: typeof router): {
      kind: string; routes: Array<{ id: string; method: string; path: string; disposition: string }>;
      registrationDigest: string;
    };
  }).observeCatalogHttpWriterControls;
  const actual = observe(router);
  expect(actual.kind).toBe("legacy-http-writes-retired");
  expect(actual.routes).toEqual(retiredRoutes.map(({ id, method, path }) => ({ id, method, path, disposition: "gone-410" })));
  expect(actual.registrationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(() => observe({ ...router })).toThrow("PCAT-HTTP-WRITER-CONTROLS-UNISSUED");
});

it("a real branded database root cannot make retirement depend on a Catalog query", async () => {
  const db = createPostgresDatabase("postgresql://synthetic@invalid.invalid/synthetic");
  const pool = getRootPostgresPool(db)!;
  // Exercise the real composition branch, intercepting only the external pool
  // boundary. No network connection or database operation can be made.
  const query = vi.spyOn(pool, "query").mockImplementation(() => { throw new Error("database unavailable"); });
  const connect = vi.spyOn(pool, "connect").mockImplementation(() => { throw new Error("database unavailable"); });
  const end = vi.spyOn(pool, "end");
  try {
    const response = await requestJson(createWiseEffServer({ db }), "/api/v2/parameter-specs", { method: "POST", body: "{}" });
    expect(response.status).toBe(410);
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await db.close();
    expect(end).toHaveBeenCalledOnce();
    query.mockRestore(); connect.mockRestore(); end.mockRestore();
  }
});

it.each(retiredRoutes)("the real app has one 410 owner for $id, including replay", async route => {
  const db = createPostgresDatabase("postgresql://synthetic@invalid.invalid/synthetic");
  const pool = getRootPostgresPool(db)!;
  const query = vi.spyOn(pool, "query").mockImplementation(() => { throw new Error("retired route attempted database access"); });
  const connect = vi.spyOn(pool, "connect").mockImplementation(() => { throw new Error("retired route attempted database access"); });
  const end = vi.spyOn(pool, "end");
  const options = { db, auth: { mode: "production" as const, verifier: {
    async verify(): Promise<never> { throw new Error("retired route attempted authentication-backed legacy work"); },
  } } };
  try {
    const { router } = buildWiseEffRouter(options);
    expect(router.listRoutes().filter(entry => entry.method === route.method && entry.pattern === route.path)).toHaveLength(1);
    const pathname = route.path.replace(/:[^/]+/g, "synthetic-id");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await requestJson<{ error: { code: string; details: { reason: string; retryable: boolean; successor: string } } }>(
        createWiseEffServer(options), pathname, {
          method: route.method,
          headers: { "Idempotency-Key": "synthetic-retired-replay", "If-Match": "synthetic-revision", "X-WiseEff-Catalog-Release": "synthetic-release" },
          ...(route.method === "GET" ? {} : { body: JSON.stringify({ role: "platform-admin", overridePlatform: true }) }),
        });
      expect(response.status).toBe(410);
      expect(response.body.error).toMatchObject({ code: "GONE", details: {
        reason: "legacy-surface-retired", retryable: false, successor: "/api/v2/catalog",
      } });
      expect(response.headers.get("link")).toContain('rel="successor-version"');
    }
    expect(query).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  } finally {
    await db.close();
    expect(end).toHaveBeenCalledOnce();
    query.mockRestore(); connect.mockRestore(); end.mockRestore();
  }
});

it("keeps non-retired business registration and bounded legacy reads outside the retirement filter", async () => {
  const { router } = buildWiseEffRouter();
  expect(router.listRoutes()).toContainEqual({ method: "POST", pattern: "/api/v1/parameter-drafts" });
  expect(router.listRoutes()).toContainEqual({ method: "GET", pattern: "/api/v2/parameter-specs" });
  expect((await requestJson(createWiseEffServer(), "/api/v1/me")).status).toBe(200);
  // This source-dependent bounded read remains its existing old handler. A
  // missing database is a failure, not a fabricated Catalog state or a 410.
  expect((await requestJson(createWiseEffServer(), "/api/v2/parameter-specs")).status).toBe(500);
});
