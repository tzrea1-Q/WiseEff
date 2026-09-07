import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../shared/database/client";
import { createRouter } from "../../shared/http/router";
import { createMigratedSelfHostedPg16Database } from "../../testing/selfHostedUpgrade/database";
import { installPublishedCatalogChain } from "../catalog-kernel/runtime/catalogChain.fixture";
import { registerParameterCatalogApi } from "./productionWire";
import type { AuthContext } from "../auth/types";
import { provideCghParameterCatalogComparisonContribution } from "../parameter-specs/parameterCatalogComparisonContribution";

// The parent executes this against its owned test cluster, with the already
// approved additive reader migration. No new domain grant is introduced here.
let target: Awaited<ReturnType<typeof createMigratedSelfHostedPg16Database>>;
let admin: RootDatabase;
let reader: RootDatabase;
let denied: RootDatabase;
let chain: Awaited<ReturnType<typeof installPublishedCatalogChain>>;
const suffix = randomBytes(8).toString("hex");
const readerName = `cgh_reader_${suffix}`;
const deniedName = `cgh_denied_${suffix}`;
const password = randomBytes(24).toString("hex");
const auth: AuthContext = {
  user: { id: "synthetic-cgh-reader", organizationId: "synthetic-cgh-org", name: "Synthetic", email: "synthetic@example.invalid", title: "test", isActive: true },
  organization: { id: "synthetic-cgh-org", name: "Synthetic" },
  roles: [{ projectId: null, roleId: "platform-admin" }],
  permissions: ["parameter:view", "admin:access"],
};
function router(db: RootDatabase) {
  const instance = createRouter();
  registerParameterCatalogApi(instance, { db, resolveAuth: () => auth, requireSeparateGovernancePool: true });
  return instance;
}
const request = (path: string) => ({ method: "GET" as const, path, params: {}, query: {}, headers: {}, requestId: "synthetic-cgh-read", body: undefined });

beforeAll(async () => {
  target = await createMigratedSelfHostedPg16Database("cghreal");
  admin = createPostgresDatabase(target.url);
  // This is the actual existing compiler/installer fixture, not a passed
  // Verification report or an upgrade-controller approval.
  chain = await installPublishedCatalogChain(getRootPostgresPool(admin)!);
  for (const name of [readerName, deniedName]) {
    await admin.query(`create role ${pg.escapeIdentifier(name)} login noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication password '${password}'`);
  }
  await admin.query(`grant catalog_runtime_reader_role to ${pg.escapeIdentifier(readerName)} with inherit true, set false, admin false`);
  const login = (name: string) => {
    const url = new URL(target.url); url.username = name; url.password = password;
    return createPostgresDatabase(url.href);
  };
  reader = login(readerName); denied = login(deniedName);
}, 60_000);

afterAll(async () => {
  // Release pools even after a failed setup/assertion. Roles are nonce test
  // identities; DROP ROLE must succeed without dropping owned data or ACLs.
  const results = await Promise.allSettled([reader?.close(), denied?.close()]);
  if (admin) results.push(...await Promise.allSettled([readerName, deniedName].map((name) =>
    admin.query(`drop role if exists ${pg.escapeIdentifier(name)}`).then(() => undefined))));
  results.push(...await Promise.allSettled([admin?.close()]));
  results.push(...await Promise.allSettled([target?.close()]));
  const failed = results.find((result) => result.status === "rejected");
  if (failed?.status === "rejected") throw failed.reason;
});

it("reads the actual Catalog document through the formal router with a restricted LOGIN", async () => {
  expect((await reader.query(`select session_user as login, current_user as effective,
    rolsuper,rolbypassrls,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user`)).rows)
    .toEqual([{ login: readerName, effective: readerName, rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false }]);
  const response = await router(reader).handle(request("/api/v2/catalog"));
  expect(response.status).toBe(200);
  expect("body" in response && response.body).toMatchObject({ item: { catalogReleaseId: chain.pinC.id, digest: chain.pinC.digest } });
});

it("does not replace missing registration and usage read privileges with empty definition projections", async () => {
  const response = await router(reader).handle(request("/api/v2/catalog/definitions"));
  expect(response.status).toBe(503);
  expect("body" in response && response.body).toMatchObject({ error: { code: "SERVICE_UNAVAILABLE" } });
  await expect(reader.query("select * from parameter_catalog.subject_registrations limit 0")).rejects.toMatchObject({ code: "42501" });
});

it("keeps the Review GET lazy writer unavailable without governance credentials", async () => {
  const response = await router(reader).handle(request("/api/v2/organizations/synthetic-cgh-org/parameter-review-items"));
  expect(response.status).toBe(403);
});

it("refuses ungranted Catalog reads and never upgrades the login or invokes management preparation", async () => {
  await expect(denied.query("select * from parameter_catalog.catalog_state limit 0")).rejects.toMatchObject({ code: "42501" });
  for (const statement of ["set role catalog_runtime_reader_role", "set role catalog_migration_owner", "update parameter_catalog.catalog_state set current_catalog_release_id=current_catalog_release_id where false"]) {
    await expect(reader.query(statement)).rejects.toMatchObject({ code: "42501" });
  }
});

it("the actual CGH provider reports unavailable review inventory rather than producing a fresh empty contribution", async () => {
  await expect(provideCghParameterCatalogComparisonContribution({
    database: admin, pool: getRootPostgresPool(admin)!, phase: "pre-activation", inventoryMode: "fresh",
    candidateSha: "a".repeat(40), planPin: "synthetic-cgh-plan", mappingHeadId: "synthetic-cgh-head", mappingHeadVersion: 1,
    mappingHeadChecksum: "b".repeat(64), catalogSnapshotChecksum: "c".repeat(64),
  })).rejects.toMatchObject({
    code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    observation: { status: "query-failure", code: "403", detail: "catalog-governance-list-review-items" },
  });
});
