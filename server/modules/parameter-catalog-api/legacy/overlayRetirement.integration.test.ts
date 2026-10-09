import pg from "pg";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSavepointDatabase, type Database } from "../../../shared/database/client";
import { createRetirementTestHarness } from "../../../testing/parameterCatalog/retirementHarness";
import { requestJson } from "../../../test/testClient";
import { routeManifest } from "../../contracts/routeManifest";
import { createTokenVerifier } from "../../auth/tokenVerifier";
import type { DriverSchemaPromotionHistoryItem } from "../../parameter-specs/promotionHistory";
import { listDriverSchemaPromotions } from "../../parameter-specs/driverSchemaOverlayRepository";

const legacyTables = [
  "driver_schema_overlays", "driver_schema_overlay_properties", "driver_schema_overlay_promotions",
  "parameter_specs", "parameter_spec_versions", "dts_property_specs",
  "parameter_spec_review_tasks", "parameter_spec_matcher_overrides",
  "parameter_spec_version_cutover_runs", "parameter_spec_version_cutover_items",
  "parameter_spec_property_key_cutover_runs", "parameter_spec_property_key_cutover_items",
] as const;
const historyPath = "/api/v2/platform/driver-schema-promotion-history";
const schemaPath = "/api/v2/organization-driver-schemas";
const platformPath = "/api/v2/platform/driver-schemas";
const retiredRoutes = [
  { method: "GET", path: schemaPath },
  { method: "GET", path: `${schemaPath}/source-overlay-t1066` },
  { method: "POST", path: schemaPath },
  { method: "PATCH", path: `${schemaPath}/source-overlay-t1066` },
  { method: "POST", path: `${schemaPath}/source-overlay-t1066/activate` },
  { method: "POST", path: `${schemaPath}/source-overlay-t1066/deprecate` },
  { method: "GET", path: `${schemaPath}/source-overlay-t1066/deprecation-impact` },
  { method: "GET", path: `${platformPath}/promotion-candidates` },
  { method: "POST", path: `${platformPath}/promotions` },
  { method: "POST", path: `${platformPath}/promotions/promotion-t1066/revert` },
] as const;

describe("assembled overlay retirement and retained promotion history on PostgreSQL", () => {
  let client: pg.Client;
  let db: Database;
  let harness: ReturnType<typeof createRetirementTestHarness>;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("An explicit migrated PostgreSQL test database is required.");
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query("begin");
    db = createSavepointDatabase(client);
    await db.query(`insert into organizations (id, name) values
      ('org-overlay-t1066', 'Retained overlay history'), ('org-other-t1066', 'Other tenant')`);
    await db.query(`insert into users (id, organization_id, name, email, title, is_active) values
      ('platform-t1066', 'org-overlay-t1066', 'Platform', 'platform-t1066@example.com', 'Admin', true),
      ('admin-t1066', 'org-overlay-t1066', 'Admin', 'admin-t1066@example.com', 'Admin', true),
      ('other-t1066', 'org-other-t1066', 'Other', 'other-t1066@example.com', 'Admin', true),
      ('inactive-t1066', 'org-overlay-t1066', 'Inactive', 'inactive-t1066@example.com', 'Admin', false)`);
    await db.query(`insert into user_role_bindings (id, user_id, organization_id, role_id, project_id) values
      ('platform-role-t1066', 'platform-t1066', 'org-overlay-t1066', 'platform-admin', null),
      ('admin-role-t1066', 'admin-t1066', 'org-overlay-t1066', 'admin', null),
      ('other-role-t1066', 'other-t1066', 'org-other-t1066', 'admin', null),
      ('inactive-role-t1066', 'inactive-t1066', 'org-overlay-t1066', 'platform-admin', null)`);
    await db.query(`insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ('spec-overlay-t1066', 'org-overlay-t1066', 'manual', 'manual/overlay-t1066')`);
    await db.query(`insert into parameter_spec_versions
      (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
      values ('spec-overlay-v1-t1066', 'spec-overlay-t1066', 1, 'Retained', 'Retained', '{"kind":"u32"}', 'active')`);
    await db.query(`insert into dts_property_specs
      (id, parameter_spec_id, property_key, schema_namespace, constraints, documentation)
      values ('dps-overlay-t1066', 'spec-overlay-t1066', 'retained-t1066', 'manual', '{}', 'Retained')`);
    await db.query(`insert into driver_schema_overlays
      (id, organization_id, compatible, display_name, lifecycle, created_by_user_id) values
      ('platform-overlay-t1066', null, 'test,retained-t1066', 'Archived platform schema', 'deprecated', 'platform-t1066'),
      ('source-overlay-t1066', 'org-overlay-t1066', 'test,retained-t1066', 'Archived source schema', 'superseded', 'admin-t1066'),
      ('source-overlay-a-t1066', 'org-overlay-t1066', 'test,retained-a-t1066', 'Older contributor', 'deprecated', 'admin-t1066'),
      ('source-overlay-b-t1066', 'org-other-t1066', 'test,retained-b-t1066', 'Other contributor', 'deprecated', 'other-t1066'),
      ('candidate-overlay-t1066', 'org-other-t1066', 'test,live-candidate-t1066', 'Not promoted', 'active', 'other-t1066')`);
    await db.query(`insert into driver_schema_overlay_properties
      (id, driver_schema_overlay_id, parameter_spec_id, property_key)
      values ('property-overlay-t1066', 'source-overlay-t1066', 'spec-overlay-t1066', 'retained-t1066')`);
    await db.query(`insert into driver_schema_overlay_promotions
      (id, platform_schema_id, source_schema_id, source_organization_id, promoted_by_user_id, promoted_at, documentation_source)
      values ('promotion-t1066', 'platform-overlay-t1066', 'source-overlay-t1066', 'org-overlay-t1066',
        'platform-t1066', '2026-10-01T12:00:00Z', 'org-overlay-t1066'),
      ('promotion-b-t1066', 'platform-overlay-t1066', 'source-overlay-b-t1066', 'org-other-t1066',
        null, '2026-10-02T12:00:00Z', null),
      ('promotion-a-t1066', 'platform-overlay-t1066', 'source-overlay-a-t1066', 'org-overlay-t1066',
        null, '2026-10-02T12:00:00Z', null)`);
    harness = createRetirementTestHarness({ db, legacyTables });
  });

  afterAll(async () => {
    if (client) {
      await client.query("rollback");
      await client.end();
    }
  });

  it("covers every registered organization-schema and platform promotion retirement contract", () => {
    const routes = routeManifest.filter((route) =>
      route.path.startsWith(schemaPath) || route.path.startsWith(`${platformPath}/`),
    ).map((route) => ({
      method: route.method,
      path: route.path.replace(":schemaId", "source-overlay-t1066").replace(":promotionId", "promotion-t1066"),
    }));
    expect(routes).toHaveLength(10);
    expect(routes).toEqual(expect.arrayContaining(retiredRoutes));
  });

  it.each(retiredRoutes)("$method $path returns 410 and preserves all legacy rows", async (route) => {
    await harness.assertRetired(route, {
      headers: { "X-WiseEff-User": "platform-t1066" },
      body: route.method === "GET" ? undefined : JSON.stringify({
        compatible: "test,retained-t1066", organizationId: "org-other-t1066",
        documentation: "must not change", reason: "must not mutate", schemaIds: ["source-overlay-t1066"],
      }),
    });
  });

  it.each(retiredRoutes)("$method $path stays gone for missing objects and an unauthenticated caller", async (route) => {
    await harness.assertRetired({
      ...route,
      path: route.path.replace("source-overlay-t1066", "missing-schema").replace("promotion-t1066", "missing-promotion"),
    }, {
      headers: { "X-WiseEff-User": "missing-user-t1066" },
      body: route.method === "GET" ? undefined : JSON.stringify({ invalid: true }),
    });
  });

  it.each([
    `${schemaPath}?compatible=test,retained-t1066&organizationId=org-overlay-t1066`,
    `${schemaPath}/source-overlay-t1066?view=effective`,
    `${platformPath}/promotion-candidates?compatible=test,live-candidate-t1066`,
  ])("retires overlay-shaped GET %s without writes", async (path) => {
    await harness.assertRetired({ method: "GET", path }, { headers: { "X-WiseEff-User": "admin-t1066" } });
  });

  it("lists persisted archived promotion history, not active overlay candidates, without writes", async () => {
    const before = [];
    for (const table of legacyTables) before.push((await db.query(`select * from ${table} order by id`)).rows);
    const response = await requestJson<{ items: unknown[] }>(harness.server, historyPath, {
      headers: { "X-WiseEff-User": "platform-t1066" },
    });
    expect(response.status).toBe(200);
    expect(response.body.items).toContainEqual({
      id: "promotion-t1066", platformSchemaId: "platform-overlay-t1066", sourceSchemaId: "source-overlay-t1066",
      sourceOrganizationId: "org-overlay-t1066", promotedByUserId: "platform-t1066",
      promotedAt: "2026-10-01T12:00:00.000Z", documentationSource: "org-overlay-t1066",
    });
    expect(JSON.stringify(response.body)).not.toContain("candidate-overlay-t1066");
    const after = [];
    for (const table of legacyTables) after.push((await db.query(`select * from ${table} order by id`)).rows);
    expect(after).toEqual(before);
  });

  it("retains nullable provenance and orders archived history by timestamp then promotion ID", async () => {
    const response = await requestJson<{ items: DriverSchemaPromotionHistoryItem[] }>(harness.server, historyPath, {
      headers: { "X-WiseEff-User": "platform-t1066" },
    });
    expect(response.status).toBe(200);
    const items = response.body.items.filter((item) => ["promotion-t1066", "promotion-a-t1066", "promotion-b-t1066"].includes(item.id));
    expect(items.map((item) => item.id)).toEqual(["promotion-a-t1066", "promotion-b-t1066", "promotion-t1066"]);
    expect(items[0]).toEqual({
      id: "promotion-a-t1066", platformSchemaId: "platform-overlay-t1066", sourceSchemaId: "source-overlay-a-t1066",
      sourceOrganizationId: "org-overlay-t1066", promotedByUserId: null,
      promotedAt: "2026-10-02T12:00:00.000Z", documentationSource: null,
    });
  });

  it("uses the existing promotion reader for history while preserving its platform-schema filter", async () => {
    const history = await listDriverSchemaPromotions(db);
    expect(history.filter((row) => row.platform_schema_id === "platform-overlay-t1066").map((row) => row.id))
      .toEqual(["promotion-a-t1066", "promotion-b-t1066", "promotion-t1066"]);
    expect((await listDriverSchemaPromotions(db, "platform-overlay-t1066")).map((row) => row.id))
      .toEqual(["promotion-a-t1066", "promotion-b-t1066", "promotion-t1066"]);
    expect(await listDriverSchemaPromotions(db, "missing-platform-t1066")).toEqual([]);
  });

  it.each([
    { userId: "admin-t1066", status: 403, code: "FORBIDDEN" },
    { userId: "other-t1066", status: 403, code: "FORBIDDEN" },
    { userId: "inactive-t1066", status: 403, code: "FORBIDDEN" },
    { userId: "missing-user-t1066", status: 401, code: "UNAUTHENTICATED" },
  ])("refuses promotion history for $userId with $status", async ({ userId, status, code }) => {
    const response = await requestJson<{ error: { code: string }; items?: unknown[] }>(harness.server, historyPath, {
      headers: { "X-WiseEff-User": userId },
    });
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.items).toBeUndefined();
  });

  it.each([
    { userId: "platform-t1066", status: 200, spoofedUserId: "admin-t1066" },
    { userId: "admin-t1066", status: 403, spoofedUserId: "platform-t1066" },
    { userId: "inactive-t1066", status: 403, spoofedUserId: "platform-t1066" },
  ])("uses signed production principal $userId, not spoofed development headers", async ({ userId, status, spoofedUserId }) => {
    const issuer = "t1066-history-test";
    const secret = "t1066-test-only-signing-key";
    const payload = Buffer.from(JSON.stringify({
      iss: issuer, sub: userId, org: "org-overlay-t1066", exp: Math.floor(Date.now() / 1000) + 300,
    })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const production = createRetirementTestHarness({
      db, legacyTables, auth: { mode: "production", verifier: createTokenVerifier({ issuer, secret }) },
    });
    const response = await requestJson(production.server, historyPath, {
      headers: { Authorization: `Bearer ${payload}.${signature}`, "X-WiseEff-User": spoofedUserId },
    });
    expect(response.status).toBe(status);
    const unauthenticated = await requestJson(production.server, historyPath, {
      headers: { "X-WiseEff-User": "platform-t1066" },
    });
    expect(unauthenticated.status).toBe(401);
  });
});
