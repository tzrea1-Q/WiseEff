import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSavepointDatabase, type Database } from "../../../shared/database/client";
import { createRetirementTestHarness } from "../../../testing/parameterCatalog/retirementHarness";
import { requestJson } from "../../../test/testClient";
import { routeManifest } from "../../contracts/routeManifest";

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

describe("assembled overlay retirement preserves historical storage on PostgreSQL", () => {
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
    expect(routes).toEqual(expect.arrayContaining([...retiredRoutes]));
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

  it("keeps retired writes gone while the organization is suspended, without reviving legacy storage", async () => {
    await db.query("update organizations set status='suspended' where id='org-overlay-t1066'");
    try {
      for (const userId of ["admin-t1066", "missing-user-t1066"]) {
        await harness.assertRetired({ method: "POST", path: schemaPath }, {
          headers: { "X-WiseEff-User": userId }, body: JSON.stringify({ compatible: "test,must-stay-retired" }),
        });
      }
    } finally {
      await db.query("update organizations set status='active' where id='org-overlay-t1066'");
    }
  });

  it.each([
    `${schemaPath}?compatible=test,retained-t1066&organizationId=org-overlay-t1066`,
    `${schemaPath}/source-overlay-t1066?view=effective`,
    `${platformPath}/promotion-candidates?compatible=test,live-candidate-t1066`,
  ])("retires overlay-shaped GET %s without writes", async (path) => {
    await harness.assertRetired({ method: "GET", path }, { headers: { "X-WiseEff-User": "admin-t1066" } });
  });

  it.each(["platform-t1066", "admin-t1066", "other-t1066", "inactive-t1066", "missing-user-t1066"])(
    "removes history queries for %s without changing retained records", async (userId) => {
      const before = (await db.query("select * from driver_schema_overlay_promotions order by id")).rows;
      expect(before).toHaveLength(3);
      const response = await requestJson(harness.server, historyPath, {
        headers: { "X-WiseEff-User": userId },
      });
      expect(response.status).toBe(404);
      expect((await db.query("select * from driver_schema_overlay_promotions order by id")).rows).toEqual(before);
    },
  );
});
