import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
} from "../../testing/testDatabase";
import { reconcileDriverParameterDefinitions } from "./definitionReconciliation";
import { verifyEffectiveDriverParameterDefinitions } from "./definitionVerification";

const ORG_ID = "org-definition-reconciliation";
const PROJECT_ID = "project-definition-reconciliation";
const CONFIG_SET_ID = "set-definition-reconciliation";
const OTHER_CONFIG_SET_ID = "set-definition-reconciliation-other";
const REVISION_ID = "revision-definition-reconciliation";
const OLD_SUBJECT = "asub-reconciliation-old";
const PLATFORM_SUBJECT = "asub-reconciliation-platform";
const OLD_SPEC = "pspec:reconciliation:org";
const PLATFORM_SPEC = "pspec:reconciliation:platform";
const DRIVER_ROOT_SPEC = "pspec:driver:reconciliation";
const DRIVER_SCHEMA_ID = "driver-reconciliation";
const PROPERTY_KEY = "reconciliation_limit";
const CATEGORY_ID = "module-reconciliation-category";
const GROUP_ID = "module-reconciliation-old-group";

const databaseAvailable = await isTestDatabaseAvailable();

async function seed(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Reconciliation Org')`,
    [ORG_ID],
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status) values ($1, $2, 'Reconciliation', 'REC', 'initialized')`,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name) values ($1, $2, $3, 'reconciliation')`,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
     values ($1, $2, $3, $4, 1, 'resolved')`,
    [REVISION_ID, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
  );
  await db.query(
    `insert into attribution_subjects (id, organization_id, subject_kind, display_name, origin, source_key)
     values ($1, $2, 'driver-registration', 'legacy driver', 'auto', 'compatible:legacy,reconciliation'),
            ($3, null, 'driver-registration', 'canonical driver', 'auto', 'compatible:vendor,reconciliation')`,
    [OLD_SUBJECT, ORG_ID, PLATFORM_SUBJECT],
  );
  await db.query(
    `insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality, notes)
     values ($1, 'physical-device', 'multiple', ''), ($2, 'physical-device', 'multiple', '')`,
    [OLD_SUBJECT, PLATFORM_SUBJECT],
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, parent_id, source_key, attribution_subject_id)
     values ($1, $2, 'Power', $1, 1, 'business', 'curated', null, null, null),
            ($3, $2, 'Legacy driver', $3, 2, 'driver-group', 'auto', $1, 'compatible:vendor,reconciliation', $4)`,
    [CATEGORY_ID, ORG_ID, GROUP_ID, OLD_SUBJECT],
  );
  await db.query(
    `insert into parameter_specs (id, organization_id, source_kind, specification_key, definition_lifecycle, attribution_subject_id, property_key)
     values ($1, $2, 'manual', 'legacy/reconciliation_limit', 'draft', $3, $4),
            ($5, null, 'dts', 'vendor/reconciliation_limit', 'active', $6, $4),
            ($7, null, 'dts', 'driver/reconciliation', 'active', $6, null)`,
    [
      OLD_SPEC,
      ORG_ID,
      OLD_SUBJECT,
      PROPERTY_KEY,
      PLATFORM_SPEC,
      PLATFORM_SUBJECT,
      DRIVER_ROOT_SPEC,
    ],
  );
  await db.query(
    `insert into parameter_spec_versions
       (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
     values ('psv-reconciliation-old', $1, 1, 'old', 'old', '{"kind":"cells"}'::jsonb, 'draft', 'draft', 'old'),
            ('psv-reconciliation-platform', $2, 1, 'canonical', 'canonical', '{"kind":"cells"}'::jsonb, 'active', 'active', 'canonical'),
            ('psv-reconciliation-driver', $3, 1, 'driver', 'driver', '{"kind":"unknown"}'::jsonb, 'active', 'active', 'driver')`,
    [OLD_SPEC, PLATFORM_SPEC, DRIVER_ROOT_SPEC],
  );
  await db.query(
    `insert into driver_schemas (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
     values ($1, $2, null, 'vendor/reconciliation', $3)`,
    [DRIVER_SCHEMA_ID, DRIVER_ROOT_SPEC, PLATFORM_SUBJECT],
  );
  await db.query(
    `insert into driver_schema_versions
       (id, driver_schema_id, parameter_spec_version_id, version, compatible_patterns, parent_bus_constraints, source, lifecycle)
     values ('driver-reconciliation:v1', $1, 'psv-reconciliation-driver', 1, '["vendor,reconciliation"]'::jsonb, '{}'::jsonb, 'vendor', 'active')`,
    [DRIVER_SCHEMA_ID],
  );
  await db.query(
    `insert into dts_property_specs
       (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
     values ('dps-reconciliation-old', $1, null, $2, 'legacy/reconciliation', '{}'::jsonb, 'old'),
            ('dps-reconciliation-platform', $3, $4, $2, 'vendor/reconciliation', '{}'::jsonb, 'canonical')`,
    [OLD_SPEC, PROPERTY_KEY, PLATFORM_SPEC, DRIVER_SCHEMA_ID],
  );
  await db.query(
    `insert into project_parameter_bindings
       (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
     values ('binding-reconciliation', $1, $2, null, $3, $4)`,
    [ORG_ID, PROJECT_ID, OLD_SPEC, GROUP_ID],
  );
  await db.query(
    `insert into project_parameter_binding_revisions
       (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value, schema_state)
     values ('binding-reconciliation:v1', 'binding-reconciliation', $1, 'psv-reconciliation-old', '{"kind":"cells"}'::jsonb, '<1>', 'unreviewed')`,
    [REVISION_ID],
  );
}

describe.skipIf(!databaseAvailable)(
  "driver parameter definition reconciliation",
  () => {
    let db: InMemoryTestDatabase | undefined;

    beforeEach(async () => {
      db = await createInMemoryTestDatabase();
      await seed(db);
    });

    afterEach(async () => {
      await db?.rollback();
    });

    it("blocks an active subjectless DTS property even when a driver root points at the staging row", async () => {
      await db!.query(
        `insert into parameter_specs
         (id, organization_id, source_kind, specification_key, definition_lifecycle, property_key)
       values ('pspec:reconciliation:subjectless', $1, 'dts', 'legacy/subjectless', 'active', 'subjectless_limit')`,
        [ORG_ID],
      );
      await db!.query(
        `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle, version_status, documentation)
       values ('psv-reconciliation-subjectless', 'pspec:reconciliation:subjectless', 1,
         'subjectless', 'subjectless', '{"kind":"cells"}'::jsonb, 'active', 'active', 'subjectless')`,
      );
      await db!.query(
        `insert into dts_property_specs
         (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
       values ('dps-reconciliation-subjectless', 'pspec:reconciliation:subjectless', null,
         'subjectless_limit', 'legacy/subjectless', '{}'::jsonb, 'subjectless')`,
      );
      await db!.query(
        `insert into driver_schemas
           (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
       values ('driver-reconciliation-subjectless-root', 'pspec:reconciliation:subjectless', $1,
         'legacy/subjectless', null)`,
        [ORG_ID],
      );

      const verification = await verifyEffectiveDriverParameterDefinitions(
        db!,
        { organizationId: ORG_ID },
      );
      expect(verification.status).toBe("blocked");
      expect(
        verification.checks.find(
          (check) => check.code === "active-driver-definition-incomplete",
        )?.count,
      ).toBe(1);
    });

    it("classifies a parameter-key mismatch as a review blocker instead of guessing", async () => {
      await db!.query(
        `update parameter_specs set property_key = 'different_limit' where id = $1`,
        [OLD_SPEC],
      );

      const dryRun = await reconcileDriverParameterDefinitions(db!, {
        mode: "dry-run",
        organizationId: ORG_ID,
      });
      expect(dryRun).toMatchObject({
        mode: "dry-run",
        candidates: 0,
        blocked: 1,
      });
      const item = await db!.query<{ status: string; blocker_code: string }>(
        `select status, blocker_code
       from parameter_definition_reconciliation_items
       where run_id = $1`,
        [dryRun.runId],
      );
      expect(item.rows).toEqual([
        { status: "blocked", blocker_code: "property-key-mismatch" },
      ]);
    });

    it("preflights the dirty twin and applies an audited, idempotent correction", async () => {
      await db!.query(
        `insert into dts_config_revisions
         (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('revision-definition-reconciliation-history', $1, $2, $3, 0, 'resolved')`,
        [ORG_ID, PROJECT_ID, CONFIG_SET_ID],
      );
      await db!.query(
        `insert into project_parameter_binding_revisions
         (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value, schema_state)
       values ('binding-reconciliation:history', 'binding-reconciliation',
         'revision-definition-reconciliation-history', 'psv-reconciliation-old',
         '{"kind":"cells"}'::jsonb, '<0>', 'unreviewed')`,
      );
      await db!.query(
        `insert into dts_config_set (id, organization_id, project_id, name)
       values ($1, $2, $3, 'other-config-set')`,
        [OTHER_CONFIG_SET_ID, ORG_ID, PROJECT_ID],
      );
      await db!.query(
        `insert into dts_config_revisions
         (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('revision-definition-reconciliation-other', $1, $2, $3, 99, 'resolved')`,
        [ORG_ID, PROJECT_ID, OTHER_CONFIG_SET_ID],
      );
      const dryRun = await reconcileDriverParameterDefinitions(db!, {
        mode: "dry-run",
        organizationId: ORG_ID,
      });
      expect(dryRun).toMatchObject({
        mode: "dry-run",
        candidates: 1,
        blocked: 0,
      });
      const dryItems = await db!.query<{
        status: string;
        candidate_parameter_spec_id: string;
      }>(
        `select status, candidate_parameter_spec_id from parameter_definition_reconciliation_items where run_id = $1`,
        [dryRun.runId],
      );
      expect(dryItems.rows).toEqual([
        { status: "pending", candidate_parameter_spec_id: PLATFORM_SPEC },
      ]);

      const applied = await reconcileDriverParameterDefinitions(db!, {
        mode: "apply",
        organizationId: ORG_ID,
      });
      expect(applied).toMatchObject({ mode: "apply", applied: 1, blocked: 0 });

      const repaired = await db!.query<{
        subject: string;
        lifecycle: string;
        specification_key: string;
        driver_schema_id: string | null;
        version_status: string;
        schema_state: string;
        module_id: string;
      }>(
        `
      select ps.attribution_subject_id as subject, ps.definition_lifecycle as lifecycle,
             ps.specification_key,
             dps.driver_schema_id, psv.version_status, br.schema_state, b.module_id
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      inner join parameter_spec_versions psv on psv.parameter_spec_id = ps.id and psv.version_status = 'active'
      inner join project_parameter_bindings b on b.parameter_spec_id = ps.id
      inner join project_parameter_binding_revisions br on br.binding_id = b.id
      where ps.id = $1 and br.config_revision_id = $2
      `,
        [OLD_SPEC, REVISION_ID],
      );
      expect(repaired.rows).toHaveLength(1);
      expect(repaired.rows[0]).toMatchObject({
        subject: PLATFORM_SUBJECT,
        lifecycle: "active",
        specification_key: buildSubjectScopedManualSpecIds({
          organizationId: ORG_ID,
          attributionSubjectId: PLATFORM_SUBJECT,
          propertyKey: PROPERTY_KEY,
        }).specificationKey,
        driver_schema_id: DRIVER_SCHEMA_ID,
        version_status: "active",
        schema_state: "valid",
        module_id: GROUP_ID,
      });

      const placement = await db!.query<{ attribution_subject_id: string }>(
        `select attribution_subject_id from driver_registration_placements where organization_id = $1`,
        [ORG_ID],
      );
      expect(placement.rows).toEqual([
        { attribution_subject_id: PLATFORM_SUBJECT },
      ]);
      const audit = await db!.query<{ actor_type: string; kind: string }>(
        `select actor_type, kind from audit_events where target_id = $1 and action = 'reconcile'`,
        [OLD_SPEC],
      );
      expect(audit.rows).toEqual([
        { actor_type: "system", kind: "parameter-definition-reconciliation" },
      ]);

      const verification = await verifyEffectiveDriverParameterDefinitions(
        db!,
        { organizationId: ORG_ID },
      );
      expect(verification).toMatchObject({
        status: "ready",
        checks: expect.any(Array),
      });
      expect(verification.checks.every((check) => check.count === 0)).toBe(
        true,
      );

      const rerun = await reconcileDriverParameterDefinitions(db!, {
        mode: "dry-run",
        organizationId: ORG_ID,
      });
      expect(rerun.candidates).toBe(0);
      expect(rerun.applied).toBe(0);
    });
  },
);
