import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createWiseEffServer } from "../../app";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { routeManifest } from "../contracts/routeManifest";
import { createHttpServer } from "../../shared/http/server";
import { createRouter } from "../../shared/http/router";
import { requestJson } from "../../test/testClient";
import { makeTestAuthContext } from "../../testing/authContext";
import { createManagedInstanceTestDatabase, isTestDatabaseAvailable, withTestClusterRoleCatalogLock } from "../../testing/testDatabase";
import { installParameterModuleRegistryProjectionFixture } from "../../testing/parameterCatalog/registryProjection";
import { captureCurrentCatalogPin, dropLabRuntimeLogins, provisionPublicationRuntimeLogins } from "../catalog-publication/runtime";
import { getAuthContextForExternalIdentity } from "../auth/repository";
import { createTokenVerifier } from "../auth/tokenVerifier";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import { registerParameterModuleRoutes } from "./routes";
import { getModuleDiscoveryHints, getParameterModuleRegistry, listDriverRegistry } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

function fillRoutePath(path: string): string {
  return path
    .replace(":moduleId", "module-adapter")
    .replace(":mappingId", "mapping-adapter")
    .replace(":compatible", "compat-adapter");
}

describe("parameter module HTTP adapter", () => {
  it.skipIf(!databaseAvailable)("adds bounded legacy headers to the winning GET handlers without changing their bodies or state", async () => {
    await withTestClusterRoleCatalogLock(async () => {
      const fixture = await createManagedInstanceTestDatabase("modhdr");
      const bootstrap = createPostgresDatabase(fixture.url);
      const runToken = `modhdr${randomBytes(5).toString("hex")}`;
      let runtime: Awaited<ReturnType<typeof provisionPublicationRuntimeLogins>> | undefined;
      let api: RootDatabase | undefined;
      try {
        const pool = getRootPostgresPool(bootstrap);
        if (!pool) throw new Error("Module HTTP header tests require a root PostgreSQL pool.");
        await installParameterModuleRegistryProjectionFixture(pool);
        await bootstrap.query("insert into organizations (id,name) values ('org-mod-header','Module header fixture')");
        await bootstrap.query("insert into users (id,organization_id,name,title,is_active) values ('user-mod-header','org-mod-header','Module header user','Admin',true)");
        await bootstrap.query("insert into user_role_bindings (id,user_id,organization_id,project_id,role_id) values ('role-mod-header','user-mod-header','org-mod-header',null,'admin')");
        const module = await createParameterModule(pool, { organizationId: "org-mod-header", name: "Header fixture module" });
        runtime = await provisionPublicationRuntimeLogins(fixture.url, { mode: "lab", runToken });
        api = createPostgresDatabase(runtime.apiUrl);
        const identity = (await api.query("select session_user,current_user,rolsuper,rolinherit,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
        expect(identity).toMatchObject({ session_user: runtime.apiRole, current_user: runtime.apiRole, rolsuper: false, rolinherit: false, rolbypassrls: false });
        const auth = await getAuthContextForExternalIdentity(api, { organizationId: "org-mod-header", subject: "user-mod-header" });
        const secret = randomBytes(32).toString("hex");
        const issuer = "mod-header-test";
        const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: auth.user.id, org: auth.organization.id, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
        const authorization = `Bearer ${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
        const server = createWiseEffServer({ db: api, auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) } });
        const headers = {
          Deprecation: "true",
          Sunset: "Fri, 31 Dec 2027 00:00:00 GMT",
          Link: '</api/v2/catalog>; rel="successor-version"',
          Warning: '299 WiseEff "Legacy ParameterModule contract is deprecated"',
          "X-WiseEff-Legacy-Contract": "parameter-module-v2",
        };
        const reads = [
          ["parameterModules.getRegistry", getParameterModuleRegistry],
          ["parameterModules.discoveryHints", getModuleDiscoveryHints],
          ["parameterModules.listDriverRegistry", listDriverRegistry],
        ] as const;
        const snapshot = () => Promise.all([
          ...reads.map(([, read]) => read(api!, auth)),
          captureCurrentCatalogPin(pool),
        ]);
        const before = await snapshot();
        expect((await getParameterModuleRegistry(api, auth)).item.modules).toEqual(expect.arrayContaining([expect.objectContaining({ id: module.id })]));
        for (const [id, read] of reads) {
          const route = routeManifest.find((item) => item.id === id);
          expect(route, id).toBeDefined();
          const expected = await read(api, auth);
          const response = await requestJson(server, route!.path, { headers: { Authorization: authorization } });
          expect(response.status, id).toBe(200);
          expect(response.body, id).toEqual(expected);
          for (const [name, value] of Object.entries(headers)) {
            expect.soft(response.headers.get(name), `${id} ${name}`).toBe(value);
          }
          expect((await requestJson(server, route!.path)).status, `${id} missing authentication`).toBe(401);
        }
        expect(await snapshot()).toEqual(before);
        const dismissal = routeManifest.find((route) => route.id === "parameterModules.dismissCompatible");
        expect(dismissal).toBeDefined();
        const dismissed = await requestJson<{ item: { dismissedCompatibles: Array<{ compatible: string }> } }>(server, dismissal!.path, {
          method: dismissal!.method,
          headers: { Authorization: authorization },
          body: JSON.stringify({ compatible: "header-fixture,device", reason: "Controlled header regression fixture" }),
        });
        expect(dismissed.status).toBe(200);
        expect(dismissed.body.item.dismissedCompatibles).toEqual(expect.arrayContaining([expect.objectContaining({ compatible: "header-fixture,device" })]));
      } finally {
        try {
          try {
            await api?.close();
          } finally {
            if (runtime) {
              const cleanup = await dropLabRuntimeLogins(fixture.url, runToken);
              expect(cleanup.failed).toEqual([]);
              expect(cleanup.dropped).toHaveLength(3);
            }
          }
        } finally {
          try {
            await bootstrap.close();
          } finally {
            await fixture.drop();
          }
        }
      }
    });
  });

  it("does not 410 live module mapping or driver-registry writes", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const writes = ["parameterModules.registerDriver", "parameterModules.createMapping"]
      .map((id) => routeManifest.find((route) => route.id === id))
      .filter((route): route is (typeof routeManifest)[number] => Boolean(route));
    expect(writes).toHaveLength(2);
    for (const route of writes) {
      const response = await requestJson(server, fillRoutePath(route.path), {
        method: route.method,
        body: JSON.stringify({}),
      });
      expect(response.status, route.id).not.toBe(410);
    }
  });

  it("does not intercept GET registry, discovery hints, or driver-registry navigation", async () => {
    const router = createRouter();
    registerParameterModuleRoutes(router, {
      getCurrentAuthContext: () =>
        makeTestAuthContext({
          permissions: ["parameter:view", "parameter:edit", "admin:access"],
        }),
    });
    const server = createHttpServer(router);
    const reads = ["parameterModules.getRegistry", "parameterModules.discoveryHints", "parameterModules.listDriverRegistry"]
      .map((id) => routeManifest.find((route) => route.id === id))
      .filter((route): route is (typeof routeManifest)[number] => Boolean(route));
    expect(reads).toHaveLength(3);
    for (const route of reads) {
      const response = await requestJson<Record<string, unknown>>(server, fillRoutePath(route.path), {
        method: route.method,
      });
      expect(response.status).not.toBe(410);
      expect(response.body).not.toEqual({ items: [] });
    }
  });
});
