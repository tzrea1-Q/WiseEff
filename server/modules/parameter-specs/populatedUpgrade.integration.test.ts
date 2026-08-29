import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type Database } from "../../shared/database/client";
import { applyMigrations } from "../../shared/database/migrations";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { verifyEffectiveDriverParameterDefinitions } from "./definitionVerification";
import { listParameterSpecRows } from "./repository";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);
const databaseAvailable = await isTestDatabaseAvailable();

function connectionString(database: string) {
  const base =
    process.env.TEST_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff";
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function connect(database: string) {
  const client = new pg.Client({ connectionString: connectionString(database) });
  await client.connect();
  const db = createDatabase({
    query: async (text, values = []) => {
      const result = await client.query(text, values);
      return { rows: result.rows, rowCount: result.rowCount };
    },
  });
  return { client, db };
}

async function seedPopulatedPreRepairShape(db: Database) {
  await db.query(
    `insert into organizations (id, name)
     values ('org-populated-upgrade', 'Populated upgrade')`,
  );
  await db.query(
    `insert into attribution_subjects
       (id, organization_id, subject_kind, display_name, origin, source_key)
     values
       ('asub-populated-driver', null, 'driver-registration',
        'vendor,upgrade-driver', 'auto', 'compatible:vendor,upgrade-driver'),
       ('asub-populated-legacy-driver', 'org-populated-upgrade',
        'driver-registration', 'legacy upgrade driver', 'auto',
        'compatible:vendor,upgrade-driver'),
       ('asub-populated-node-type', 'org-populated-upgrade',
        'node-type-definition', 'legacy-node', 'auto', 'nodetype:legacy-node')`,
  );
  await db.query(
    `insert into driver_registrations
       (attribution_subject_id, driver_nature, instance_cardinality, notes)
     values ('asub-populated-driver', 'physical-device', 'multiple', '')`,
  );
  await db.query(
    `insert into driver_registrations
       (attribution_subject_id, driver_nature, instance_cardinality, notes)
     values ('asub-populated-legacy-driver', 'physical-device', 'multiple',
             'legacy organization subject')`,
  );
  await db.query(
    `insert into node_type_definitions (attribution_subject_id, bare_node_name)
     values ('asub-populated-node-type', 'legacy-node')`,
  );
  await db.query(
    `insert into parameter_modules
       (id, organization_id, parent_id, name, path, depth, kind, origin,
        source_key, attribution_subject_id)
     values
       ('module-populated-node-type', 'org-populated-upgrade', null,
        'legacy-node', 'module-populated-node-type', 1,
        'node-type', 'auto', 'nodetype:legacy-node',
        'asub-populated-node-type'),
       ('module-populated-driver-collision', 'org-populated-upgrade', null,
        'Legacy driver surface', 'module-populated-driver-collision', 1,
        'driver-group', 'auto', 'compatible:vendor,upgrade-driver',
        'asub-populated-legacy-driver')`,
  );
  await db.query(
    `insert into driver_registration_placements
       (id, organization_id, attribution_subject_id, driver_group_module_id,
        default_business_category_module_id)
     values ('placement-populated-legacy-driver', 'org-populated-upgrade',
             'asub-populated-legacy-driver',
             'module-populated-driver-collision', null)`,
  );
  await db.query(
    `insert into parameter_specs
       (id, organization_id, source_kind, specification_key,
        definition_lifecycle, attribution_subject_id, property_key)
     values
       ('pspec:populated:driver-root', null, 'dts', 'driver/vendor/upgrade-driver',
        'active', null, null),
       ('pspec:populated:property', null, 'dts', 'vendor/upgrade-driver/limit',
        'active', 'asub-populated-driver', 'limit'),
       ('pspec:populated:legacy-surface', null, 'dts', 'legacy/limit',
        'active', null, 'limit'),
       ('pspec:populated:organization-draft', 'org-populated-upgrade',
        'manual', 'legacy-node/limit', 'draft',
        'asub-populated-node-type', 'limit')`,
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape,
        lifecycle, version_status, documentation)
     values
       ('psv-populated-driver-root', 'pspec:populated:driver-root', 1,
        'upgrade-driver', 'driver root', '{"kind":"unknown"}'::jsonb,
        'active', 'active', 'driver root'),
       ('psv-populated-property', 'pspec:populated:property', 1,
        'limit', 'canonical property', '{"kind":"cells"}'::jsonb,
        'active', 'active', 'canonical property'),
       ('psv-populated-legacy-surface', 'pspec:populated:legacy-surface', 1,
        'limit', 'unresolved legacy surface', '{"kind":"cells"}'::jsonb,
        'active', 'active', 'unresolved legacy surface'),
       ('psv-populated-organization-draft',
        'pspec:populated:organization-draft', 1,
        'limit', 'placed organization draft twin', '{"kind":"cells"}'::jsonb,
        'draft', 'draft', 'placed organization draft twin')`,
  );
  await db.query(
    `insert into driver_schemas
       (id, parameter_spec_id, organization_id, schema_namespace,
        attribution_subject_id)
     values ('driver-populated-upgrade', 'pspec:populated:driver-root', null,
             'vendor/upgrade-driver', 'asub-populated-driver')`,
  );
  await db.query(
    `insert into driver_schema_versions
       (id, driver_schema_id, parameter_spec_version_id, version,
        compatible_patterns, parent_bus_constraints, source, lifecycle)
     values ('driver-populated-upgrade:v1', 'driver-populated-upgrade',
             'psv-populated-driver-root', 1,
             '["vendor,upgrade-driver"]'::jsonb, '{}'::jsonb, 'vendor', 'active')`,
  );
  await db.query(
    `insert into dts_property_specs
       (id, parameter_spec_id, driver_schema_id, property_key,
        schema_namespace, constraints, documentation)
     values
       ('dps-populated-property', 'pspec:populated:property',
        'driver-populated-upgrade', 'limit', 'vendor/upgrade-driver',
        '{}'::jsonb, 'canonical property'),
       ('dps-populated-legacy-surface', 'pspec:populated:legacy-surface',
        null, 'limit', 'legacy', '{}'::jsonb, 'unresolved legacy surface'),
       ('dps-populated-organization-draft',
        'pspec:populated:organization-draft', null, 'limit', 'legacy-node',
        '{}'::jsonb, 'placed organization draft twin')`,
  );
}

describe.skipIf(!databaseAvailable)("populated effective-driver upgrade", () => {
  let admin: pg.Client;
  let databaseName: string;
  let connection: Awaited<ReturnType<typeof connect>> | undefined;

  beforeEach(async () => {
    databaseName = `wiseeff_populated_upgrade_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    admin = new pg.Client({ connectionString: connectionString("postgres") });
    await admin.connect();
    await admin.query(`create database ${databaseName}`);
    connection = await connect(databaseName);
    await applyMigrations(connection.db, migrationsDir, {
      through: "0123_harden_node_type_identity.sql",
    });
    await seedPopulatedPreRepairShape(connection.db);
    await applyMigrations(connection.db, migrationsDir, {
      through: "0126_guard_binding_spec_version_owner.sql",
    });
  });

  afterEach(async () => {
    await connection?.client.end().catch(() => undefined);
    await admin
      ?.query(`drop database if exists ${databaseName} with (force)`)
      .catch(() => undefined);
    await admin?.end().catch(() => undefined);
  });

  it("upgrades retained legacy evidence into one active placed canonical driver property", async () => {
    const before = await verifyEffectiveDriverParameterDefinitions(connection!.db, {
      organizationId: "org-populated-upgrade",
    });
    expect(before.status).toBe("blocked");
    expect(
      await listParameterSpecRows(connection!.db, {
        organizationId: "org-populated-upgrade",
      }),
    ).toEqual([]);

    const applied = await applyMigrations(connection!.db, migrationsDir, {
      through: "0128_repair_driver_placement_subject_cutover.sql",
    });
    expect(applied).toEqual([
      "0127_repair_populated_effective_driver_catalog.sql",
      "0128_repair_driver_placement_subject_cutover.sql",
    ]);

    const after = await verifyEffectiveDriverParameterDefinitions(connection!.db, {
      organizationId: "org-populated-upgrade",
    });
    expect(after.status).toBe("ready");
    expect(after.checks.every((check) => check.count === 0)).toBe(true);

    const effective = await listParameterSpecRows(connection!.db, {
      organizationId: "org-populated-upgrade",
    });
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({
      id: "pspec:populated:property",
      lifecycle: "active",
      effectiveScope: "platform",
      attributionSubjectId: "asub-populated-driver",
      propertyKey: "limit",
      declaredPlacement: {
        categoryId: null,
        moduleId: "module-populated-driver-collision",
      },
    });

    const governance = await listParameterSpecRows(connection!.db, {
      organizationId: "org-populated-upgrade",
      view: "governance",
    });
    expect(
      governance.find((row) => row.id === "pspec:populated:legacy-surface"),
    ).toMatchObject({ lifecycle: "draft", effectiveScope: "governance" });
    expect(
      governance.find(
        (row) => row.id === "pspec:populated:organization-draft",
      ),
    ).toMatchObject({ lifecycle: "draft", effectiveScope: "governance" });

    const migrationSql = await readFile(
      path.join(
        migrationsDir,
        "0128_repair_driver_placement_subject_cutover.sql",
      ),
      "utf8",
    );
    await connection!.db.query(migrationSql);
    const repeatedPlacement = await connection!.db.query<{ count: string }>(
      `select count(*)::text as count
       from driver_registration_placements
       where organization_id = 'org-populated-upgrade'
         and attribution_subject_id = 'asub-populated-driver'`,
    );
    expect(repeatedPlacement.rows[0]?.count).toBe("1");
  });

  it("moves a recognized canonical binding into the repaired declared placement", async () => {
    await connection!.db.query(
      `insert into projects (id, organization_id, name, code, status)
       values ('project-populated-upgrade', 'org-populated-upgrade',
               'Populated project', 'POP-UPGRADE', 'initialized')`,
    );
    await connection!.db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('set-populated-upgrade', 'org-populated-upgrade',
               'project-populated-upgrade', 'Populated set')`,
    );
    await connection!.db.query(
      `insert into dts_config_revisions
         (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('revision-populated-upgrade', 'org-populated-upgrade',
               'project-populated-upgrade', 'set-populated-upgrade', 1, 'resolved')`,
    );
    await connection!.db.query(
      `insert into parameter_modules
         (id, organization_id, parent_id, name, path, depth, kind, origin)
       values ('module-populated-unclassified', 'org-populated-upgrade', null,
               'Unclassified', 'module-populated-unclassified', 1,
               'unclassified', 'auto')`,
    );
    await connection!.db.query(
      `insert into project_parameter_bindings
         (id, organization_id, project_id, logical_node_id,
          parameter_spec_id, module_id)
       values ('binding-populated-upgrade', 'org-populated-upgrade',
               'project-populated-upgrade', null,
               'pspec:populated:property', 'module-populated-unclassified')`,
    );
    await connection!.db.query(
      `insert into project_parameter_binding_revisions
         (id, binding_id, config_revision_id, parameter_spec_version_id,
          typed_value, raw_value, schema_state)
       values ('binding-populated-upgrade:v1', 'binding-populated-upgrade',
               'revision-populated-upgrade', 'psv-populated-property',
               '{"kind":"cells"}'::jsonb, '<1>', 'valid')`,
    );

    await applyMigrations(connection!.db, migrationsDir, {
      through: "0128_repair_driver_placement_subject_cutover.sql",
    });

    const verification = await verifyEffectiveDriverParameterDefinitions(
      connection!.db,
      { organizationId: "org-populated-upgrade" },
    );
    expect(verification.status).toBe("ready");
    expect(
      verification.checks.find(
        (check) => check.code === "recognized-binding-definition-incomplete",
      )?.count,
    ).toBe(0);
  });

  it("leaves a curated same-key module blocked instead of guessing its subject", async () => {
    await connection!.db.query(
      `update parameter_modules
       set origin = 'curated'
       where id = 'module-populated-driver-collision'`,
    );

    await applyMigrations(connection!.db, migrationsDir, {
      through: "0128_repair_driver_placement_subject_cutover.sql",
    });

    const verification = await verifyEffectiveDriverParameterDefinitions(
      connection!.db,
      { organizationId: "org-populated-upgrade", catalogOnly: true },
    );
    expect(verification.status).toBe("blocked");
    expect(
      verification.checks.find(
        (check) => check.code === "active-driver-placement-missing",
      )?.count,
    ).toBe(1);

    const retained = await connection!.db.query<{
      attribution_subject_id: string | null;
    }>(
      `select attribution_subject_id
       from parameter_modules
       where id = 'module-populated-driver-collision'`,
    );
    expect(retained.rows[0]?.attribution_subject_id).toBe(
      "asub-populated-legacy-driver",
    );
  });
});
