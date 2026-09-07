import { expect, it, vi } from "vitest";
import { buildWiseEffRouter, createWiseEffServer } from "./app";
import * as application from "./app";
import * as parameterSpecRoutes from "./modules/parameter-specs/routes";
import { legacyWriteRouteManifest } from "./modules/parameter-catalog-api/legacy/routes";
import type { HttpMethod } from "./shared/http/router";
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
  const observe = application.observeCatalogHttpWriterControls;
  const actual = observe(router);
  expect(actual.kind).toBe("legacy-http-writes-retired");
  expect(actual.routes.toSorted((a, b) => a.id.localeCompare(b.id))).toEqual(retiredRoutes
    .map(({ id, method, path }) => ({ id, method, path, disposition: "gone-410" }))
    .toSorted((a, b) => a.id.localeCompare(b.id)));
  expect(actual.registrationDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(() => observe({ ...router })).toThrow("PCAT-HTTP-WRITER-CONTROLS-UNISSUED");
});

it.each(["empty", "one-removed"])("keeps the complete owner inventory and actual 410 after public manifest is %s", async fault => {
  const original = legacyWriteRouteManifest.slice();
  try {
    if (fault === "empty") legacyWriteRouteManifest.length = 0;
    else legacyWriteRouteManifest.splice(legacyWriteRouteManifest.findIndex(route => route.id === "parameterSpecs.create"), 1);
    const { router } = buildWiseEffRouter();
    const controls = application.observeCatalogHttpWriterControls(router);
    expect(controls.routes.map(route => route.id).sort()).toEqual(retiredRoutes.map(route => route.id).sort());
    const response = await router.handle({ method: "POST", path: "/api/v2/parameter-specs", params: {}, query: {},
      headers: {}, requestId: "http-controls-mutable-manifest", body: {} });
    expect(response.status).toBe(410);
  } finally { legacyWriteRouteManifest.splice(0, legacyWriteRouteManifest.length, ...original); }
});

it.each(["registration", "dispatch", "method"])("refuses later %s changes to the issued router", fault => {
  const { router } = buildWiseEffRouter();
  const before = application.observeCatalogHttpWriterControls(router);
  if (fault === "registration") router.post("/api/v2/parameter-specs", async () => ({ status: 201, body: {} }));
  if (fault === "dispatch") router.handle = async () => ({ status: 201, body: {} });
  if (fault === "method") router.post = () => {};
  expect(() => application.observeCatalogHttpWriterControls(router)).toThrow("PCAT-HTTP-WRITER-CONTROLS-CHANGED");
  expect(before.routes).toHaveLength(retiredRoutes.length);
});

it.each(["static", "alias", "slashes"])("refuses an actually reachable early %s competitor instead of issuing control evidence", async fault => {
  const retired = retiredRoutes.find(route => route.method === "POST" && route.path.includes(":"))!;
  const actualPath = retired.path.replace(/:[^/]+/g, "shadow");
  const competingPattern = fault === "static" ? actualPath : fault === "alias"
    ? retired.path.replace(/:[^/]+/g, ":differentName") : retired.path.replaceAll("/", "//") + "/";
  const original = parameterSpecRoutes.registerParameterSpecRoutes;
  let calls = 0;
  const registration = vi.spyOn(parameterSpecRoutes, "registerParameterSpecRoutes").mockImplementation((router, options) => {
    original(router, options);
    router.post(competingPattern, async () => { calls++; return { status: 202, body: { fixture: "live competitor" } }; });
  });
  try {
    const { router } = buildWiseEffRouter();
    expect(() => application.observeCatalogHttpWriterControls(router)).toThrow("PCAT-HTTP-WRITER-CONTROLS-UNPROVEN");
    expect(calls).toBe(0); // Observation must never probe unknown handlers.
    const response = await router.handle({ method: retired.method as HttpMethod, path: actualPath, params: {}, query: {},
      headers: {}, requestId: "http-controls-adversary", body: {} });
    expect(response.status).toBe(202); expect(calls).toBe(1);
  } finally { registration.mockRestore(); }
});

it("keeps returned records isolated and follows the router's literal asterisk semantics", async () => {
  const original = parameterSpecRoutes.registerParameterSpecRoutes;
  const register = vi.spyOn(parameterSpecRoutes, "registerParameterSpecRoutes").mockImplementation((router, options) => {
    original(router, options); router.post("/api/v2/*", async () => ({ status: 202, body: {} }));
  });
  try {
    const { router } = buildWiseEffRouter();
    const first = application.observeCatalogHttpWriterControls(router);
    first.routes.length = 0;
    expect(application.observeCatalogHttpWriterControls(router).routes).toHaveLength(retiredRoutes.length);
    expect(router.matchRoutePattern("POST", "/api/v2/parameter-specs")).toBe("/api/v2/parameter-specs");
    expect(router.matchRoutePattern("POST", "/api/v2/*")).toBe("/api/v2/*");
  } finally { register.mockRestore(); }
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
