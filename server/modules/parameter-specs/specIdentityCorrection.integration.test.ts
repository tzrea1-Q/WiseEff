/**
 * ADR-0017 Batch 2: in-place identity correction service.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ApiError } from "../../shared/http/errors";
import { findParameterSpecByIdentity } from "./repository";
import {
  reattributeParameterSpec,
  renameParameterSpecPropertyKey,
} from "./service";

const ORG_ID = "org-identity-correct";
const USER_ID = "user-identity-correct";
const SUBJECT_A = "asub:driver-registration:identity-correct-a";
const SUBJECT_B = "asub:driver-registration:identity-correct-b";
const SUBJECT_C = "asub:driver-registration:identity-correct-c";
const SPEC_ID = "pspec:identity-correct-main";
const BLOCKER_ID = "pspec:identity-correct-blocker";
const PROPERTY_KEY = "correct_me_prop";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Identity Correct Admin",
      email: "identity-correct@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Identity Correct Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
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
