import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { listBindingCompareRows } from "./bindingService";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-compare";
const OTHER_ORG_ID = "org-compare-other";
const SPEC_KEY = "vendor,sc8562/sc8562@6E/watchdog_time";
const OTHER_SPEC_KEY = "vendor,sc8562/sc8562@6E/reg_default";

/**
 * Minimal graph across two orgs and four projects so the compare query is proven to
 * (1) match peers by parameter_spec_id + module_id, (2) exclude the source project,
 * (3) stay inside the source organization, and (4) return the latest raw value.
 */
async function seedCompareGraph(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Compare Co')`, [ORG_ID]);
  await db.query(`insert into organizations (id, name) values ($1, 'Other Co')`, [OTHER_ORG_ID]);

  const projects: Array<[string, string, string, string]> = [
    ["proj-source", ORG_ID, "Source", "SRC"],
    ["proj-peer-a", ORG_ID, "Aurora", "AUR"],
    ["proj-peer-b", ORG_ID, "Borealis", "BOR"],
    ["proj-other-module", ORG_ID, "OtherModule", "OMD"],
    ["proj-other-spec", ORG_ID, "OtherSpec", "OSP"],
    ["proj-cross-org", OTHER_ORG_ID, "CrossOrg", "XORG"]
  ];
  for (const [id, orgId, name, code] of projects) {
    await db.query(
      `insert into projects (id, organization_id, name, code, status) values ($1, $2, $3, $4, 'initialized')`,
      [id, orgId, name, code]
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name) values ($1, $2, $3, 'default')`,
      [`cs-${id}`, orgId, id]
    );
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       values ($1, $2, $3, $4, 1, 'resolved')`,
      [`cr-${id}`, orgId, id, `cs-${id}`]
    );
  }

  // Shared spec across the source org; a distinct spec for the cross-org project + one org project.
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key) values ($1, $2, 'dts', $3)`,
    ["spec-watchdog", ORG_ID, SPEC_KEY]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key) values ($1, $2, 'dts', $3)`,
    ["spec-other", ORG_ID, OTHER_SPEC_KEY]
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key) values ($1, $2, 'dts', $3)`,
    ["spec-watchdog-xorg", OTHER_ORG_ID, SPEC_KEY]
  );

  for (const [specId, orgId] of [
    ["spec-watchdog", ORG_ID],
    ["spec-other", ORG_ID],
    ["spec-watchdog-xorg", OTHER_ORG_ID]
  ] as const) {
    await db.query(
      `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
       values ($1, $2, 1, 'Watchdog', 'demo', '{}'::jsonb, 'active')`,
      [`spv-${specId}`, specId]
    );
  }

  await db.query(
    `insert into parameter_modules (id, organization_id, name, path) values ($1, $2, '充电策略', 'p-charge')`,
    ["mod-charge", ORG_ID]
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path) values ($1, $2, '热管理', 'p-thermal')`,
    ["mod-thermal", ORG_ID]
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path) values ($1, $2, '充电策略', 'p-charge')`,
    ["mod-charge-xorg", OTHER_ORG_ID]
  );

  // (project, spec, module, rawValue) — the source and two true peers share spec-watchdog + mod-charge.
  const bindings: Array<{
    id: string;
    orgId: string;
    projectId: string;
    specId: string;
    moduleId: string;
    raw: string;
    specVersionId: string;
    configRevisionId: string;
  }> = [
    { id: "b-source", orgId: ORG_ID, projectId: "proj-source", specId: "spec-watchdog", moduleId: "mod-charge", raw: "<0>", specVersionId: "spv-spec-watchdog", configRevisionId: "cr-proj-source" },
    { id: "b-peer-a", orgId: ORG_ID, projectId: "proj-peer-a", specId: "spec-watchdog", moduleId: "mod-charge", raw: "<1>", specVersionId: "spv-spec-watchdog", configRevisionId: "cr-proj-peer-a" },
    { id: "b-peer-b", orgId: ORG_ID, projectId: "proj-peer-b", specId: "spec-watchdog", moduleId: "mod-charge", raw: "<2>", specVersionId: "spv-spec-watchdog", configRevisionId: "cr-proj-peer-b" },
    // Same spec but different module → excluded.
    { id: "b-other-module", orgId: ORG_ID, projectId: "proj-other-module", specId: "spec-watchdog", moduleId: "mod-thermal", raw: "<9>", specVersionId: "spv-spec-watchdog", configRevisionId: "cr-proj-other-module" },
    // Same module but different spec → excluded.
    { id: "b-other-spec", orgId: ORG_ID, projectId: "proj-other-spec", specId: "spec-other", moduleId: "mod-charge", raw: "<8>", specVersionId: "spv-spec-other", configRevisionId: "cr-proj-other-spec" },
    // Different org → excluded even though spec key + module name match.
    { id: "b-cross-org", orgId: OTHER_ORG_ID, projectId: "proj-cross-org", specId: "spec-watchdog-xorg", moduleId: "mod-charge-xorg", raw: "<7>", specVersionId: "spv-spec-watchdog-xorg", configRevisionId: "cr-proj-cross-org" }
  ];

  for (const b of bindings) {
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ($1, $2, $3, null, $4, $5)`,
      [b.id, b.orgId, b.projectId, b.specId, b.moduleId]
    );
    await db.query(
      `insert into project_parameter_binding_revisions
         (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value)
       values ($1, $2, $3, $4, '{}'::jsonb, $5)`,
      [`rev-${b.id}`, b.id, b.configRevisionId, b.specVersionId, b.raw]
    );
  }
}

describe.skipIf(!databaseAvailable)("listBindingCompareRows", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedCompareGraph(db);
  }, 60_000);

  afterEach(async () => {
    await db?.rollback();
  });

  it("returns only same-org peers sharing spec+module, excluding the source project", async () => {
    const rows = await listBindingCompareRows(db!, {
      organizationId: ORG_ID,
      projectId: "proj-source",
      bindingId: "b-source"
    });

    expect(rows.map((row) => row.projectId).sort()).toEqual(["proj-peer-a", "proj-peer-b"]);
    expect(rows.some((row) => row.projectId === "proj-source")).toBe(false);
    expect(rows.some((row) => row.projectId === "proj-other-module")).toBe(false);
    expect(rows.some((row) => row.projectId === "proj-other-spec")).toBe(false);
    expect(rows.some((row) => row.projectId === "proj-cross-org")).toBe(false);

    const aurora = rows.find((row) => row.projectId === "proj-peer-a");
    expect(aurora).toMatchObject({
      projectName: "Aurora",
      rawValue: "<1>",
      moduleName: "充电策略",
      driverModule: "sc8562@6E"
    });
  });
});
