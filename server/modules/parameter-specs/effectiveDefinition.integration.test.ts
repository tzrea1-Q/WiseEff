import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../testing/testDatabase";
import { verifyEffectiveDriverParameterDefinitions } from "./definitionVerification";
import {
  ensureDriverRegistrationPlacement,
  getDriverRegistrationPlacement,
} from "../parameter-modules/driverRegistrationPlacement";
import {
  listParameterSpecRows,
  upsertMatchedDriverSchema,
  upsertMatchedPropertySpec,
} from "./repository";
import type { PropertySpec } from "./types";

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
const NODE_SUBJECT = "asub-effective-node-type";
const NODE_SPEC = "pspec:effective:node-type";
const NODE_ROOT_SPEC = "pspec:driver:vendor/node-type";
const NODE_SCHEMA = "driver-effective-node-type";
const NODE_MODULE = "module-effective-node-type";
const NODE_PROPERTY = "node_type_limit";

const databaseAvailable = await isTestDatabaseAvailable();

async function seed(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Effective Catalog')`,
    [ORG_ID],
  );
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
    [
      CATEGORY,
      ORG_ID,
      PLATFORM_GROUP,
      PLATFORM_SUBJECT,
      ORG_GROUP,
      ORG_SUBJECT,
    ],
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
    [
      PLATFORM_SPEC,
      PLATFORM_SUBJECT,
      PROPERTY_KEY,
      ORG_SPEC,
      ORG_ID,
      ORG_SUBJECT,
    ],
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
  await db.query(
    `insert into attribution_subjects
       (id, organization_id, subject_kind, display_name, origin, source_key)
     values ($1, null, 'node-type-definition', 'uart-controller', 'curated', 'nodetype:uart-controller')`,
    [NODE_SUBJECT],
  );
  await db.query(
    `insert into node_type_definitions (attribution_subject_id, bare_node_name)
     values ($1, 'uart-controller')`,
    [NODE_SUBJECT],
  );
  await db.query(
    `insert into parameter_specs
       (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id)
     values ($1, null, 'dts', 'driver/vendor/node-type', 'active', $2)`,
    [NODE_ROOT_SPEC, NODE_SUBJECT],
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
     values ('psv-driver-node-type', $1, 1, 'uart-controller', 'node-type schema', '{"kind":"unknown"}'::jsonb,
       'active', 'active', 'node-type schema')`,
    [NODE_ROOT_SPEC],
  );
  await db.query(
    `insert into driver_schemas
       (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
     values ($1, $2, null, 'vendor/node-type', $3)`,
    [NODE_SCHEMA, NODE_ROOT_SPEC, NODE_SUBJECT],
  );
  await db.query(
    `insert into driver_schema_versions
       (id, driver_schema_id, parameter_spec_version_id, version, compatible_patterns,
        parent_bus_constraints, source, lifecycle)
     values ('driver-effective-node-type:v1', $1, 'psv-driver-node-type', 1, '[]'::jsonb, '{}'::jsonb,
       'vendor', 'draft')`,
    [NODE_SCHEMA],
  );
  await db.query(
    `insert into parameter_specs
       (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
     values ($1, null, 'dts', 'vendor/node-type/node_type_limit', 'active', $2, $3)`,
    [NODE_SPEC, NODE_SUBJECT, NODE_PROPERTY],
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
     values ('psv-effective-node-type', $1, 1, 'node_type_limit', 'node-type property', '{"kind":"cells"}'::jsonb,
       'active', 'active', 'node-type property')`,
    [NODE_SPEC],
  );
  await db.query(
    `insert into dts_property_specs
       (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
     values ('dps-effective-node-type', $1, $2, $3, 'vendor/node-type', '{}'::jsonb, 'node-type property')`,
    [NODE_SPEC, NODE_SCHEMA, NODE_PROPERTY],
  );
}

describe.skipIf(!databaseAvailable)(
  "effective parameter definition catalog",
  () => {
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

    it("repairs an existing placement whose category is no longer valid", async () => {
      await db!.query(
        `update driver_registration_placements
         set default_business_category_module_id = $2
         where organization_id = $1 and attribution_subject_id = $3`,
        [ORG_ID, CATEGORY, PLATFORM_SUBJECT],
      );
      await db!.query(
        `update parameter_modules set kind = 'unclassified' where id = $1`,
        [CATEGORY],
      );

      const repaired = await ensureDriverRegistrationPlacement(db!, {
        organizationId: ORG_ID,
        attributionSubjectId: PLATFORM_SUBJECT,
        driverGroupModuleId: PLATFORM_GROUP,
      });
      expect(repaired).toMatchObject({
        attributionSubjectId: PLATFORM_SUBJECT,
        driverGroupModuleId: PLATFORM_GROUP,
        defaultBusinessCategoryModuleId: null,
      });
      expect(
        await getDriverRegistrationPlacement(db!, {
          organizationId: ORG_ID,
          attributionSubjectId: PLATFORM_SUBJECT,
        }),
      ).toMatchObject({ defaultBusinessCategoryModuleId: null });
    });

    it("uses an active organization override and retains both rows in governance view", async () => {
      await db!.query(
        `update parameter_specs set definition_lifecycle = 'active' where id = $1`,
        [ORG_SPEC],
      );
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

      const effective = await listParameterSpecRows(db!, {
        organizationId: ORG_ID,
      });
      expect(effective.map((row) => row.id)).toEqual([ORG_SPEC]);
      expect(effective[0]).toMatchObject({
        effectiveScope: "organization",
        overrideOfSpecId: PLATFORM_SPEC,
        declaredPlacement: { moduleId: ORG_GROUP, categoryId: CATEGORY },
      });

      const governance = await listParameterSpecRows(db!, {
        organizationId: ORG_ID,
        view: "governance",
      });
      expect(new Set(governance.map((row) => row.id))).toEqual(
        new Set([PLATFORM_SPEC, ORG_SPEC, NODE_SPEC]),
      );
      expect(
        governance.find((row) => row.id === ORG_SPEC)?.effectiveScope,
      ).toBe("governance");
    });

    it("lets a unique organization winner override duplicate platform rows", async () => {
      await db!.query(
        `update parameter_specs set definition_lifecycle = 'active' where id = $1`,
        [ORG_SPEC],
      );
      await db!.query(
        `update parameter_spec_versions set lifecycle = 'active', version_status = 'active' where parameter_spec_id = $1`,
        [ORG_SPEC],
      );
      await db!.query(
        `insert into driver_registration_placements
         (id, organization_id, attribution_subject_id, driver_group_module_id, default_business_category_module_id)
       values ('drp-effective-org-precedence', $1, $2, $3, $4)`,
        [ORG_ID, ORG_SUBJECT, ORG_GROUP, CATEGORY],
      );
      await db!.query(
        `insert into attribution_subjects
           (id, organization_id, subject_kind, display_name, origin, source_key)
         values ('asub-effective-platform-duplicate', null, 'driver-registration', 'duplicate platform', 'auto',
           'COMPATIBLE:effective,driver')`,
      );
      await db!.query(
        `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
         values ('asub-effective-platform-duplicate', 'physical-device', 'multiple', '')`,
      );
      await db!.query(
        `insert into parameter_specs
           (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
         values ('pspec:effective:platform-duplicate', null, 'dts', 'vendor/duplicate/effective_limit', 'active',
           'asub-effective-platform-duplicate', $1)`,
        [PROPERTY_KEY],
      );
      await db!.query(
        `insert into parameter_spec_versions
           (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
         values ('psv-effective-platform-duplicate', 'pspec:effective:platform-duplicate', 1,
           'duplicate platform', 'duplicate platform', '{"kind":"cells"}'::jsonb, 'active', 'active')`,
      );

      const rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.map((row) => row.id)).toEqual([ORG_SPEC]);
    });

    it("keeps a node-type DTS property out until its taxonomy module and active schema exist", async () => {
      let rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.some((row) => row.id === NODE_SPEC)).toBe(false);

      await db!.query(
        `insert into parameter_modules
         (id, organization_id, parent_id, name, path, depth, kind, origin, source_key, attribution_subject_id)
       values ($1, $2, $3, 'uart-controller', $1, 2, 'node-type', 'curated', 'nodetype:uart-controller', $4)`,
        [NODE_MODULE, ORG_ID, CATEGORY, NODE_SUBJECT],
      );
      rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.some((row) => row.id === NODE_SPEC)).toBe(false);

      await db!.query(
        `update driver_schema_versions set lifecycle = 'active' where driver_schema_id = $1`,
        [NODE_SCHEMA],
      );
      rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.find((row) => row.id === NODE_SPEC)).toMatchObject({
        effectiveScope: "platform",
        declaredPlacement: { moduleId: NODE_MODULE, categoryId: CATEGORY },
      });
    });

    it("blocks an active node-type definition that has no active current version", async () => {
      await db!.query(
        `update parameter_spec_versions
         set lifecycle = 'draft', version_status = 'draft'
         where parameter_spec_id = $1`,
        [NODE_SPEC],
      );

      const verification = await verifyEffectiveDriverParameterDefinitions(
        db!,
        { organizationId: ORG_ID },
      );
      expect(verification.status).toBe("blocked");
      expect(
        verification.checks.find(
          (check) => check.code === "active-node-type-version-missing",
        )?.count,
      ).toBe(1);
    });

    it("fails closed when an organization has two active rows for one canonical identity", async () => {
      await db!.query(
        `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ('asub-effective-org-duplicate', $1, 'driver-registration', 'duplicate', 'auto',
         'COMPATIBLE:effective,driver')`,
        [ORG_ID],
      );
      await db!.query(
        `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
       values ('asub-effective-org-duplicate', 'physical-device', 'multiple', '')`,
      );
      await db!.query(
        `insert into parameter_specs
         (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
       values ('pspec:effective:org-duplicate', $1, 'dts', 'org/duplicate/effective_limit', 'active',
         'asub-effective-org-duplicate', $2)`,
        [ORG_ID, PROPERTY_KEY],
      );
      await db!.query(
        `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
       values ('psv-effective-org-duplicate', 'pspec:effective:org-duplicate', 1, 'duplicate', 'duplicate',
         '{"kind":"cells"}'::jsonb, 'active', 'active', 'duplicate')`,
      );

      const rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(
        rows.some((row) => row.id === PLATFORM_SPEC || row.id === ORG_SPEC),
      ).toBe(false);
    });

    it("blocks duplicate active node-type identities even when property_key is only on the DTS row", async () => {
      await db!.query(
        `insert into parameter_modules
         (id, organization_id, parent_id, name, path, depth, kind, origin, source_key, attribution_subject_id)
       values ($1, $2, $3, 'uart-controller', $1, 2, 'node-type', 'curated', 'nodetype:uart-controller', $4)`,
        [NODE_MODULE, ORG_ID, CATEGORY, NODE_SUBJECT],
      );
      await db!.query(
        `update driver_schema_versions set lifecycle = 'active' where driver_schema_id = $1`,
        [NODE_SCHEMA],
      );
      // Reproduce a pre-0124 dirty row where the legacy parameter_specs column
      // was NULL while dts_property_specs carried the real key. Triggers are
      // bypassed only for this isolated fixture; the migration guard rejects
      // this shape for all future writes.
      await db!.query("set session_replication_role = 'replica'");
      try {
        await db!.query(
          `insert into parameter_specs
           (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
         values ('pspec:effective:node-type-duplicate', null, 'dts', 'vendor/node-type/duplicate', 'active', $1, null)`,
          [NODE_SUBJECT],
        );
        await db!.query(
          `insert into parameter_spec_versions
           (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
         values ('psv-effective-node-type-duplicate', 'pspec:effective:node-type-duplicate', 1,
           'node_type_limit duplicate', 'duplicate node-type property', '{"kind":"cells"}'::jsonb,
           'active', 'active', 'duplicate')`,
        );
        await db!.query(
          `insert into dts_property_specs
           (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
         values ('dps-effective-node-type-duplicate', 'pspec:effective:node-type-duplicate', $1,
           $2, 'vendor/node-type', '{}'::jsonb, 'duplicate node-type property')`,
          [NODE_SCHEMA, NODE_PROPERTY],
        );
      } finally {
        await db!.query("set session_replication_role = 'origin'");
      }

      const rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.some((row) => row.id === NODE_SPEC)).toBe(false);
      expect(
        rows.some((row) => row.id === "pspec:effective:node-type-duplicate"),
      ).toBe(false);

      const verification = await verifyEffectiveDriverParameterDefinitions(
        db!,
        { organizationId: ORG_ID },
      );
      expect(verification.status).toBe("blocked");
      expect(
        verification.checks.find(
          (check) => check.code === "active-node-type-identity-duplicate",
        )?.count,
      ).toBe(1);
    });

    it("fails closed for a cross-organization subject and rejects property-key drift", async () => {
      const crossOwnerSpec = "pspec:effective:cross-owner";
      const otherOrg = "org-effective-other-owner";
      const otherSubject = "asub-effective-other-owner";
      await db!.query(
        `insert into organizations (id, name) values ($1, 'Other owner')`,
        [otherOrg],
      );
      await db!.query(
        `insert into attribution_subjects
           (id, organization_id, subject_kind, display_name, origin, source_key)
         values ($1, $2, 'driver-registration', 'other owner driver', 'curated', 'compatible:other,owner')`,
        [otherSubject, otherOrg],
      );
      await db!.query(
        `insert into driver_registrations
           (attribution_subject_id, driver_nature, instance_cardinality, notes)
         values ($1, 'physical-device', 'multiple', '')`,
        [otherSubject],
      );
      await db!.query(
        `insert into parameter_specs
           (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
         values ($1, $2, 'dts', 'vendor/cross-owner', 'active', $3, 'cross_owner_limit')`,
        [crossOwnerSpec, ORG_ID, otherSubject],
      );
      await db!.query(
        `insert into parameter_spec_versions
           (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
         values ('psv-effective-cross-owner', $1, 1, 'cross owner', 'cross owner', '{"kind":"cells"}'::jsonb, 'active', 'active')`,
        [crossOwnerSpec],
      );

      const rows = await listParameterSpecRows(db!, { organizationId: ORG_ID });
      expect(rows.some((row) => row.id === crossOwnerSpec)).toBe(false);
      const verification = await verifyEffectiveDriverParameterDefinitions(
        db!,
        { organizationId: ORG_ID },
      );
      expect(verification.status).toBe("blocked");
      expect(
        verification.checks.find(
          (check) => check.code === "active-driver-identity-owner-mismatch",
        )?.count,
      ).toBe(1);

      await expect(
        db!.query(
          `update parameter_specs set property_key = 'drifted_key' where id = $1`,
          [PLATFORM_SPEC],
        ),
      ).rejects.toThrow(/inconsistent property keys/i);
    });

    it("keeps a common property separate for each concrete driver subject", async () => {
      const subjectA = "asub-effective-common-a";
      const subjectB = "asub-effective-common-b";
      const schemaA = "driver-effective-common-a";
      const schemaB = "driver-effective-common-b";
      await db!.query(
        `insert into attribution_subjects
         (id, organization_id, subject_kind, display_name, origin, source_key)
       values ($1, null, 'driver-registration', 'common driver A', 'auto', 'compatible:common,a'),
              ($2, null, 'driver-registration', 'common driver B', 'auto', 'compatible:common,b')`,
        [subjectA, subjectB],
      );
      await db!.query(
        `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
       values ($1, 'physical-device', 'multiple', ''), ($2, 'physical-device', 'multiple', '')`,
        [subjectA, subjectB],
      );
      await db!.query(
        `insert into parameter_specs
         (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id)
       values ('pspec:driver:common-a', null, 'dts', 'driver/common-a', 'active', $1),
              ('pspec:driver:common-b', null, 'dts', 'driver/common-b', 'active', $2)`,
        [subjectA, subjectB],
      );
      await db!.query(
        `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status)
       values ('psv-driver-common-a', 'pspec:driver:common-a', 1, 'common A', 'common A', '{"kind":"cells"}'::jsonb, 'active', 'active'),
              ('psv-driver-common-b', 'pspec:driver:common-b', 1, 'common B', 'common B', '{"kind":"cells"}'::jsonb, 'active', 'active')`,
      );
      await db!.query(
        `insert into driver_schemas (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
       values ($1, 'pspec:driver:common-a', null, 'vendor/common-a', $2),
              ($3, 'pspec:driver:common-b', null, 'vendor/common-b', $4)`,
        [schemaA, subjectA, schemaB, subjectB],
      );

      const commonProperty = (driverSchemaId: string): PropertySpec => ({
        id: "propspec:common/power:shared_limit:v1",
        parameterSpecId: "pspec:common/power:shared_limit",
        driverSchemaId,
        propertyKey: "shared_limit",
        schemaNamespace: "common/power",
        source: "vendor",
        lifecycle: "active",
        version: 1,
        valueShape: { kind: "u32-array" },
        constraints: {},
        documentation: "shared common property",
      });
      const materializedA = await upsertMatchedPropertySpec(
        db!,
        commonProperty(schemaA),
      );
      const materializedB = await upsertMatchedPropertySpec(
        db!,
        commonProperty(schemaB),
      );

      expect(materializedA.parameterSpecId).not.toBe(
        materializedB.parameterSpecId,
      );
      const rows = await db!.query<{
        parameter_spec_id: string;
        attribution_subject_id: string;
        driver_schema_id: string | null;
      }>(
        `select ps.id as parameter_spec_id, ps.attribution_subject_id, dps.driver_schema_id
       from parameter_specs ps
       inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
       where ps.property_key = 'shared_limit'
       order by ps.attribution_subject_id`,
      );
      expect(rows.rows).toEqual([
        {
          parameter_spec_id: materializedA.parameterSpecId,
          attribution_subject_id: subjectA,
          driver_schema_id: schemaA,
        },
        {
          parameter_spec_id: materializedB.parameterSpecId,
          attribution_subject_id: subjectB,
          driver_schema_id: schemaB,
        },
      ]);
    });

    it("retires the previous active driver schema version before promoting v2", async () => {
      await upsertMatchedDriverSchema(db!, {
        id: `${DRIVER_SCHEMA}:v2`,
        compatible: "effective,driver",
        compatiblePatterns: ["effective,driver"],
        nodenamePatterns: [],
        source: "vendor",
        schemaNamespace: "vendor/effective",
        version: 2,
        lifecycle: "active",
        propertyIds: [],
        commonRefs: [],
      });

      const versions = await db!.query<{
        version: number;
        version_status: string;
        lifecycle: string;
      }>(
        `select version, version_status, lifecycle
         from parameter_spec_versions
         where parameter_spec_id = 'pspec:driver:vendor/effective'
         order by version`,
      );
      expect(versions.rows).toEqual([
        { version: 1, version_status: "superseded", lifecycle: "deprecated" },
        { version: 2, version_status: "active", lifecycle: "active" },
      ]);
      expect(
        versions.rows.filter(
          (version) =>
            version.version_status === "active" &&
            version.lifecycle === "active",
        ),
      ).toHaveLength(1);

      const schemaVersion = await db!.query<{
        id: string;
        version: number;
        parameter_spec_version_id: string;
      }>(
        `select id, version, parameter_spec_version_id
         from driver_schema_versions
         where driver_schema_id = $1
         order by version`,
        [DRIVER_SCHEMA],
      );
      expect(schemaVersion.rows.at(-1)).toMatchObject({
        id: `${DRIVER_SCHEMA}:v2`,
        version: 2,
        parameter_spec_version_id: "psv:driver:vendor/effective:v2",
      });
    });
  },
);
