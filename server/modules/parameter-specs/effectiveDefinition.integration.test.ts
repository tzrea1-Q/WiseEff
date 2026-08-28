import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { listParameterSpecRows } from "./repository";

const ORG_ID = "org-effective-catalog";
const PLATFORM_SUBJECT = "asub-effective-platform";
const ORG_SUBJECT = "asub-effective-org";
const PLATFORM_SPEC = "pspec:effective:platform";
const ORG_SPEC = "pspec:effective:org";
const PROPERTY_KEY = "effective_limit";
const DRIVER_SCHEMA = "driver-effective-platform";
const DRIVER_VERSION = "driver-effective-platform:v1";
const CATEGORY = "module-effective-category";
const PLATFORM_GROUP = "module-effective-platform-group";
const ORG_GROUP = "module-effective-org-group";

const databaseAvailable = await isTestDatabaseAvailable();

async function seed(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Effective Catalog')`, [ORG_ID]);
  await db.query(
    `insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
     values ($1, null, 'driver-registration', 'effective-driver', 'auto', 'compatible:effective,driver'),
            ($2, $3, 'driver-registration', 'effective-driver', 'auto', 'compatible:effective,driver')`,
    [PLATFORM_SUBJECT, ORG_SUBJECT, ORG_ID],
  );
  await db.query(
    `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
     values ($1, 'physical-device', 'multiple', ''), ($2, 'physical-device', 'multiple', '')`,
    [PLATFORM_SUBJECT, ORG_SUBJECT],
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, parent_id, name, path, depth, kind, origin, source_key, attribution_subject_id)
     values ($1, $2, null, 'Power', $1, 1, 'business', 'curated', null, null),
            ($3, $2, $1, 'Effective platform', $3, 2, 'driver-group', 'auto', 'compatible:effective,driver', $4),
            ($5, $2, $1, 'Effective org', $5, 2, 'driver-group', 'curated', null, $6)`,
    [CATEGORY, ORG_ID, PLATFORM_GROUP, PLATFORM_SUBJECT, ORG_GROUP, ORG_SUBJECT],
  );
  await db.query(
    `insert into driver_registration_placements
       (id, organization_id, attribution_subject_id, driver_group_module_id, default_business_category_module_id)
     values ('drp-effective-platform', $1, $2, $3, $4)`,
    [ORG_ID, PLATFORM_SUBJECT, PLATFORM_GROUP, CATEGORY],
  );
  await db.query(
    `insert into parameter_specs
       (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
     values ($1, null, 'dts', 'vendor/effective_limit', 'active', $2, $3),
            ($4, $5, 'manual', 'org/effective_limit', 'draft', $6, $3)`,
    [PLATFORM_SPEC, PLATFORM_SUBJECT, PROPERTY_KEY, ORG_SPEC, ORG_ID, ORG_SUBJECT],
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
     values ($1, $2, 1, 'platform', 'platform', '{"kind":"cells"}'::jsonb, 'active', 'active', 'platform'),
            ($3, $4, 1, 'draft', 'draft', '{"kind":"cells"}'::jsonb, 'draft', 'draft', 'draft')`,
    ["psv-effective-platform", PLATFORM_SPEC, "psv-effective-org", ORG_SPEC],
  );
  await db.query(
    `insert into parameter_specs
       (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id)
     values ('pspec:driver:vendor/effective', null, 'dts', 'driver/vendor/effective', 'active', $1)`,
    [PLATFORM_SUBJECT],
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
     values ('psv-driver-effective', 'pspec:driver:vendor/effective', 1, 'driver', 'driver', '{"kind":"unknown"}'::jsonb, 'active', 'active', 'driver')`,
  );
  await db.query(
    `insert into driver_schemas (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
     values ($1, $2, null, 'vendor/effective', $3)`,
    [DRIVER_SCHEMA, `pspec:driver:vendor/effective`, PLATFORM_SUBJECT],
  );
  await db.query(
    `insert into driver_schema_versions
       (id, driver_schema_id, parameter_spec_version_id, version, compatible_patterns, parent_bus_constraints, source, lifecycle)
     values ($1, $2, $3, 1, '["effective,driver"]'::jsonb, '{}'::jsonb, 'vendor', 'active')`,
    [DRIVER_VERSION, DRIVER_SCHEMA, "psv-driver-effective"],
  );
  await db.query(
    `insert into dts_property_specs
       (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
     values ('dps-effective-platform', $1, $2, $3, 'vendor/effective', '{}'::jsonb, 'platform'),
            ('dps-effective-org', $4, null, $3, 'org/effective', '{}'::jsonb, 'draft')`,
    [PLATFORM_SPEC, DRIVER_SCHEMA, PROPERTY_KEY, ORG_SPEC],
  );
}

describe.skipIf(!databaseAvailable)("effective parameter definition catalog", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seed(db);
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("hides an organization draft and exposes the platform fallback", async () => {
    const rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
    expect(rows.map((row) => row.id)).toEqual([PLATFORM_SPEC]);
    expect(rows[0]).toMatchObject({
      lifecycle: "active",
      effectiveScope: "platform",
      declaredPlacement: { moduleId: PLATFORM_GROUP, categoryId: CATEGORY },
    });
  });

  it("uses an active organization override and retains both rows in governance view", async () => {
    await db!.query(`update parameter_specs set definition_lifecycle = 'active' where id = $1`, [ORG_SPEC]);
    await db!.query(
      `update parameter_spec_versions set lifecycle = 'active', version_status = 'active' where parameter_spec_id = $1`,
      [ORG_SPEC],
    );
    await db!.query(
      `insert into driver_registration_placements
         (id, organization_id, attribution_subject_id, driver_group_module_id, default_business_category_module_id)
       values ('drp-effective-org', $1, $2, $3, $4)`,
      [ORG_ID, ORG_SUBJECT, ORG_GROUP, CATEGORY],
    );

    const effective = await listParameterSpecRows(db!, { organizationId: ORG_ID });
    expect(effective.map((row) => row.id)).toEqual([ORG_SPEC]);
    expect(effective[0]).toMatchObject({
      effectiveScope: "organization",
      overrideOfSpecId: PLATFORM_SPEC,
      declaredPlacement: { moduleId: ORG_GROUP, categoryId: CATEGORY },
    });

    const governance = await listParameterSpecRows(db!, { organizationId: ORG_ID, view: "governance" });
    expect(new Set(governance.map((row) => row.id))).toEqual(new Set([PLATFORM_SPEC, ORG_SPEC]));
    expect(governance.find((row) => row.id === ORG_SPEC)?.effectiveScope).toBe("governance");
  });
});
