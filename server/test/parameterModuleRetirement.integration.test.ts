import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresDatabase, type RootDatabase } from "../shared/database/client";
import { createEphemeralTestDatabase } from "../testing/testDatabase";
import { createRetirementTestHarness } from "../testing/parameterCatalog/retirementHarness";
import { requestJson } from "./testClient";
import { routeManifest } from "../modules/contracts/routeManifest";

const legacyTables = [
  "parameter_modules", "parameter_module_mappings", "attribution_subjects", "driver_registrations",
  "parameter_module_dismissed_compatibles", "project_parameter_bindings", "parameter_specs",
];
const writes = routeManifest.filter(route => route.module === "parameter-modules" && route.method !== "GET");
const headers = { "X-WiseEff-User": "user-t1067" };

describe("assembled module retirement on PostgreSQL", () => {
  let db: RootDatabase;
  let fixture: Awaited<ReturnType<typeof createEphemeralTestDatabase>>;
  let harness: ReturnType<typeof createRetirementTestHarness>;

  const expectTrustedRefusal = async (requestId: string) => {
    expect((await db.query(`select organization_id, actor_user_id, actor_type, app, kind, action,
      trace_id, metadata->>'initiator' as initiator from audit_events where trace_id=$1`, [requestId])).rows)
      .toEqual([{ organization_id: "org-t1067", actor_user_id: "user-t1067", actor_type: "user",
        app: "parameter-catalog", kind: "legacy-surface-retired", action: "deny",
        trace_id: requestId, initiator: "user" }]);
  };

  beforeAll(async () => {
    fixture = await createEphemeralTestDatabase("module");
    db = createPostgresDatabase(fixture.url);
    await db.query("insert into organizations (id,name) values ('org-t1067','Module retirement')");
    await db.query(`insert into users (id,organization_id,name,email,title,is_active)
      values ('user-t1067','org-t1067','Module admin','module@example.com','Admin',true)`);
    await db.query(`insert into roles (id,name,level,permissions) values
      ('admin','Admin',100,array['parameter:view','parameter:edit','admin:access']) on conflict (id) do nothing`);
    await db.query(`insert into user_role_bindings (id,user_id,organization_id,role_id,project_id)
      values ('role-t1067','user-t1067','org-t1067','admin',null)`);
    await db.query(`insert into attribution_subjects
      (id,organization_id,subject_kind,display_name,source_key)
      values ('subject-t1067','org-t1067','driver-registration','Historical Driver','historical,driver')`);
    await db.query(`insert into driver_registrations (attribution_subject_id,driver_nature,instance_cardinality)
      values ('subject-t1067','physical-device','singleton-per-project')`);
    await db.query(`insert into parameter_modules
      (id,organization_id,name,path,depth,kind,source_key,attribution_subject_id)
      values ('module-t1067','org-t1067','Historical Driver','module-t1067',0,'driver-group','historical,driver','subject-t1067')`);
    await db.query(`insert into parameter_module_mappings
      (id,organization_id,parameter_module_id,match_kind,match_value,priority)
      values ('mapping-t1067','org-t1067','module-t1067','compatible','historical,driver',100)`);
    await db.query(`insert into parameter_modules (id,organization_id,name,path,depth,kind)
      values ('category-t1067','org-t1067','Shared category','category-t1067',0,'business')`);
    harness = createRetirementTestHarness({ db, legacyTables });
  });

  afterAll(async () => {
    await db?.close();
    await fixture?.drop();
  });

  it.each(writes)("$id returns 410 without changing legacy truth", async route => {
    const path = route.path.replace(":moduleId", "module-t1067")
      .replace(":mappingId", "mapping-t1067").replace(":compatible", "historical%2Cdriver");
    await harness.assertRetired({ method: route.method, path }, {
      headers,
      body: JSON.stringify({ moduleId: "module-t1067", compatible: "historical,driver",
        name: "Must not change", matchKind: "compatible", matchValue: "historical,driver",
        defaultBusinessCategoryId: "module-t1067", reason: "retirement regression", dryRun: false }),
    });
  });

  it("serves taxonomy placement navigation without historical mappings or subject identity", async () => {
    const response = await requestJson<{ item: { navigationOnly: boolean; modules: unknown[]; mappings: unknown[] } }>(
      harness.server, "/api/v2/parameter-modules", { headers },
    );
    expect(response.status).toBe(200);
    expect(response.body.item).toMatchObject({ navigationOnly: true, mappings: [] });
    expect(response.body.item.modules).toContainEqual(expect.objectContaining({
      id: "module-t1067", name: "Historical Driver", sourceKey: null, attributionSubjectId: null,
    }));
    expect((await db.query("select match_value from parameter_module_mappings where id='mapping-t1067'")).rows)
      .toEqual([{ match_value: "historical,driver" }]);
    expect(response.headers.get("link")).toBe('</api/v2/catalog>; rel="successor-version"');
  });

  it.each(["view=raw", "view=governance", "mode=raw"])("does not expose retired %s navigation shapes", async query => {
    await harness.assertRetired({ method: "GET", path: `/api/v2/parameter-modules?${query}` }, { headers });
  });

  it.each(["driver-group", "node-type"])("cannot create legacy %s identity through taxonomy CRUD", async kind => {
    const requestId = `retired-create-${kind}`;
    await harness.assertRetired({ method: "POST", path: "/api/v1/parameter-modules" }, {
      headers: { ...headers, "X-Request-Id": requestId, "X-Actor-User-Id": "forged-user" },
      body: JSON.stringify({ name: `Retired ${kind}`, kind, parentId: "category-t1067",
        compatibles: ["retired,driver"], sourceKey: "nodetype:retired", organizationId: "forged-tenant" }),
    });
    await expectTrustedRefusal(requestId);
  });

  it("cannot reclassify shared taxonomy into a legacy subject", async () => {
    await harness.assertRetired({ method: "PATCH", path: "/api/v1/parameter-modules/category-t1067" }, {
      headers: { ...headers, "X-Request-Id": "retired-reclassify" }, body: JSON.stringify({ kind: "node-type" }),
    });
    await expectTrustedRefusal("retired-reclassify");
  });

  it.each([
    { method: "PATCH" as const, path: "/api/v1/parameter-modules/module-t1067", body: { name: "Must not rename history" } },
    { method: "POST" as const, path: "/api/v1/parameter-modules/module-t1067/move", body: { parentId: "category-t1067" } },
    { method: "DELETE" as const, path: "/api/v1/parameter-modules/module-t1067", body: {} },
  ])("$method $path cannot mutate historical subject structure through taxonomy CRUD", async route => {
    const requestId = `retired-historical-${route.method}`;
    await harness.assertRetired(route, { headers: { ...headers, "X-Request-Id": requestId }, body: JSON.stringify(route.body) });
    await expectTrustedRefusal(requestId);
  });

  it("keeps shared business taxonomy CRUD available", async () => {
    const created = await requestJson<{ item: { id: string; kind: string } }>(harness.server,
      "/api/v1/parameter-modules", { method: "POST", headers, body: JSON.stringify({ name: "Shared business", kind: "business" }) });
    expect(created.status).toBe(201);
    expect(created.body.item.kind).toBe("business");
    const path = `/api/v1/parameter-modules/${created.body.item.id}`;
    const renamed = await requestJson(harness.server, path, {
      method: "PATCH", headers, body: JSON.stringify({ name: "Renamed shared business" }),
    });
    expect(renamed.status).toBe(200);
    const moved = await requestJson(harness.server, `${path}/move`, {
      method: "POST", headers, body: JSON.stringify({ parentId: "category-t1067" }),
    });
    expect(moved.status).toBe(200);
    expect((await requestJson(harness.server, path, { method: "DELETE", headers })).status).toBe(204);
  });
});
