/**
 * ADR-0017 Batch 2: in-place identity correction service.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { ApiError } from "../../shared/http/errors";
import { findParameterSpecByIdentity } from "./repository";
import {
  reattributeParameterSpec,
  renameParameterSpecPropertyKey,
} from "./service";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";

const ORG_ID = "org-identity-correct";
const USER_ID = "user-identity-correct";
const SUBJECT_A = "asub:driver-registration:identity-correct-a";
const SUBJECT_B = "asub:driver-registration:identity-correct-b";
const SUBJECT_C = "asub:driver-registration:identity-correct-c";
const SPEC_ID = "pspec:identity-correct-main";
const BLOCKER_ID = "pspec:identity-correct-blocker";
const PROPERTY_KEY = "correct_me_prop";
const LINKED_PROPERTY_KEY = "linked_property_limit";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Identity Correct Admin",
    email: "identity-correct@example.com",
    organizationName: "Identity Correct Org",
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  });
}

async function seedSubject(db: InMemoryTestDatabase, id: string, sourceKey: string) {
  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values ($1, $2, 'driver-registration', $3, 'curated', $4)
    `,
    [id, ORG_ID, sourceKey, sourceKey],
  );
  await db.query(
    `
    insert into driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality
    ) values ($1, 'physical-device', 'multiple')
    `,
    [id],
  );
}

async function seedSpec(
  db: InMemoryTestDatabase,
  input: {
    specId: string;
    subjectId: string;
    propertyKey: string;
    specificationKey?: string;
    lifecycle?: "draft" | "active" | "deprecated";
  },
) {
  await db.query(
    `
    insert into parameter_specs (
      id, organization_id, source_kind, specification_key,
      attribution_subject_id, property_key, definition_lifecycle
    ) values ($1, $2, 'manual', $3, $4, $5, $6)
    `,
    [
      input.specId,
      ORG_ID,
      input.specificationKey ?? `manual/${input.propertyKey}`,
      input.subjectId,
      input.propertyKey,
      input.lifecycle ?? "active",
    ],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      lifecycle, version_status
    ) values ($1, $2, 1, $3, $3, '{"kind":"unknown"}'::jsonb, $4, $5)
    `,
    [
      `${input.specId}:v1`,
      input.specId,
      input.propertyKey,
      input.lifecycle === "deprecated" ? "active" : (input.lifecycle ?? "active"),
      input.lifecycle === "draft" ? "draft" : "active",
    ],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints, documentation
    ) values ($1, $2, $3, 'manual', '{}'::jsonb, 'doc')
    `,
    [`${input.specId}:dts`, input.specId, input.propertyKey],
  );
}

describe.skipIf(!databaseAvailable)("parameter definition identity correction (ADR-0017)", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await db.query(`insert into organizations (id, name) values ($1, 'Identity Correct Org')`, [ORG_ID]);
    await db.query(
      `insert into users (id, organization_id, name, email, title, is_active)
       values ($1, $2, 'Identity Correct Admin', 'identity-correct@example.com', 'Admin', true)`,
      [USER_ID, ORG_ID],
    );
    await seedSubject(db, SUBJECT_A, "subject-a");
    await seedSubject(db, SUBJECT_B, "subject-b");
    await seedSubject(db, SUBJECT_C, "subject-c");
    await seedSpec(db, { specId: SPEC_ID, subjectId: SUBJECT_A, propertyKey: PROPERTY_KEY });
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("reattributes a definition and keeps the surrogate id", async () => {
    const result = await reattributeParameterSpec(db!, makeAuth(), {
      specId: SPEC_ID,
      attributionSubjectId: SUBJECT_B,
      reason: "wrong subject at create",
    });
    expect(result.item.id).toBe(SPEC_ID);
    expect(result.item.attributionSubjectId).toBe(SUBJECT_B);
    expect(result.item.propertyKey).toBe(PROPERTY_KEY);

    const found = await findParameterSpecByIdentity(db!, {
      organizationId: ORG_ID,
      attributionSubjectId: SUBJECT_B,
      propertyKey: PROPERTY_KEY,
    });
    expect(found?.parameterSpecId).toBe(SPEC_ID);

    const old = await findParameterSpecByIdentity(db!, {
      organizationId: ORG_ID,
      attributionSubjectId: SUBJECT_A,
      propertyKey: PROPERTY_KEY,
    });
    expect(old).toBeNull();
  });

  it("reattributes an unassigned DTS driver root and updates its schema identity", async () => {
    const dtsSpecId = "pspec:identity-correct-dts-root";
    const dtsSchemaId = "driver-schema-identity-correct-root";
    await db!.query(
      `insert into parameter_specs
         (id, organization_id, source_kind, specification_key,
          attribution_subject_id, property_key, definition_lifecycle)
       values ($1, $2, 'dts', 'legacy/dts-root', null, $3, 'active')`,
      [dtsSpecId, ORG_ID, PROPERTY_KEY],
    );
    await db!.query(
      `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape,
          lifecycle, version_status)
       values ($1, $2, 1, 'DTS root', 'DTS root', '{"kind":"unknown"}'::jsonb,
          'active', 'active')`,
      [`${dtsSpecId}:v1`, dtsSpecId],
    );
    await db!.query(
      `insert into driver_schemas
         (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
       values ($1, $2, $3, 'legacy/dts-root', null)`,
      [dtsSchemaId, dtsSpecId, ORG_ID],
    );

    const result = await reattributeParameterSpec(db!, makeAuth(), {
      specId: dtsSpecId,
      attributionSubjectId: SUBJECT_B,
      reason: "complete the unassigned DTS root",
    });
    expect(result.item.attributionSubjectId).toBe(SUBJECT_B);

    const persisted = await db!.query<{
      spec_subject: string;
      schema_subject: string;
      specification_key: string;
    }>(
      `select ps.attribution_subject_id as spec_subject,
              ds.attribution_subject_id as schema_subject,
              ps.specification_key
       from parameter_specs ps
       inner join driver_schemas ds on ds.parameter_spec_id = ps.id
       where ps.id = $1`,
      [dtsSpecId],
    );
    expect(persisted.rows).toEqual([
      {
        spec_subject: SUBJECT_B,
        schema_subject: SUBJECT_B,
        specification_key: buildSubjectScopedManualSpecIds({
          organizationId: ORG_ID,
          attributionSubjectId: SUBJECT_B,
          propertyKey: PROPERTY_KEY,
        }).specificationKey,
      },
    ]);
  });

  it("refuses to reattribute a linked DTS property outside its DriverSchema identity", async () => {
    const rootSpecId = "pspec:identity-correct-linked-root";
    const propertySpecId = "pspec:identity-correct-linked-property";
    const schemaId = "driver-schema-identity-correct-linked";
    await db!.query(
      `insert into parameter_specs
         (id, organization_id, source_kind, specification_key,
          attribution_subject_id, property_key, definition_lifecycle)
       values ($1, $2, 'dts', 'legacy/linked-root', $3, null, 'active'),
              ($4, $2, 'dts', 'legacy/linked-property', $3, $5, 'active')`,
      [rootSpecId, ORG_ID, SUBJECT_A, propertySpecId, LINKED_PROPERTY_KEY],
    );
    await db!.query(
      `insert into parameter_spec_versions
         (id, parameter_spec_id, version, display_name, description, value_shape,
          lifecycle, version_status)
       values ($1, $2, 1, 'linked root', 'linked root', '{"kind":"unknown"}'::jsonb, 'active', 'active'),
              ($3, $4, 1, 'linked property', 'linked property', '{"kind":"cells"}'::jsonb, 'active', 'active')`,
      [`${rootSpecId}:v1`, rootSpecId, `${propertySpecId}:v1`, propertySpecId],
    );
    await db!.query(
      `insert into driver_schemas
         (id, parameter_spec_id, organization_id, schema_namespace, attribution_subject_id)
       values ($1, $2, $3, 'legacy/linked-root', $4)`,
      [schemaId, rootSpecId, ORG_ID, SUBJECT_A],
    );
    await db!.query(
      `insert into dts_property_specs
         (id, parameter_spec_id, driver_schema_id, property_key, schema_namespace, constraints, documentation)
       values ($1, $2, $3, $4, 'legacy/linked-root', '{}'::jsonb, 'linked')`,
      [`${propertySpecId}:dps`, propertySpecId, schemaId, LINKED_PROPERTY_KEY],
    );

    await expect(
      reattributeParameterSpec(db!, makeAuth(), {
        specId: propertySpecId,
        attributionSubjectId: SUBJECT_B,
        reason: "must use the reconciler for a linked DTS schema",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: expect.objectContaining({
        driverSchemaId: schemaId,
        requestedSubjectId: SUBJECT_B,
      }),
    });
  });

  it("refuses reattribution that collides with a deprecated definition", async () => {
    await seedSpec(db!, {
      specId: BLOCKER_ID,
      subjectId: SUBJECT_B,
      propertyKey: PROPERTY_KEY,
      specificationKey: `manual/${PROPERTY_KEY}-blocker`,
      lifecycle: "deprecated",
    });
    await expect(
      reattributeParameterSpec(db!, makeAuth(), {
        specId: SPEC_ID,
        attributionSubjectId: SUBJECT_B,
        reason: "would collide",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({
        parameterSpecId: BLOCKER_ID,
        lifecycle: "deprecated",
      }),
    } satisfies Partial<ApiError>);
  });

  it("renames a zero-reference property key in place", async () => {
    const result = await renameParameterSpecPropertyKey(db!, makeAuth(), {
      specId: SPEC_ID,
      propertyKey: "corrected_prop",
      reason: "typo",
    });
    expect(result.item.id).toBe(SPEC_ID);
    expect(result.item.propertyKey).toBe("corrected_prop");
    expect(result.item.attributionSubjectId).toBe(SUBJECT_A);

    const found = await findParameterSpecByIdentity(db!, {
      organizationId: ORG_ID,
      attributionSubjectId: SUBJECT_A,
      propertyKey: "corrected_prop",
    });
    expect(found?.parameterSpecId).toBe(SPEC_ID);
  });

  it("refuses rename while project bindings reference the definition", async () => {
    const projectId = "project-identity-correct";
    const moduleId = "mod-identity-correct";
    await db!.query(
      `insert into projects (id, organization_id, name, code, status)
       values ($1, $2, 'Identity Correct', 'IDC', 'initialized')`,
      [projectId, ORG_ID],
    );
    await db!.query(
      `
      insert into parameter_modules (
        id, organization_id, name, path, depth, kind, origin, parent_id, sort_order
      ) values ($1, $2, 'Unclassified', 'Unclassified', 0, 'unclassified', 'auto', null, 0)
      `,
      [moduleId, ORG_ID],
    );
    await db!.query(
      `
      insert into project_parameter_bindings (
        id, organization_id, project_id, parameter_spec_id, module_id, logical_node_id
      ) values ('binding-identity-correct', $1, $2, $3, $4, null)
      `,
      [ORG_ID, projectId, SPEC_ID, moduleId],
    );

    await expect(
      renameParameterSpecPropertyKey(db!, makeAuth(), {
        specId: SPEC_ID,
        propertyKey: "cannot_rename",
        reason: "has refs",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: expect.objectContaining({ referenceCount: 1 }),
    } satisfies Partial<ApiError>);
  });
});
