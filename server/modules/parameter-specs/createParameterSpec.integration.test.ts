/**
 * PR4: mature ParameterSpec create entry (ADR-0013/0014).
 * Drafts require AttributionSubject; activate requires an explicit coverage claim.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import { ApiError } from "../../shared/http/errors";
import { activateParameterSpec, createParameterSpec } from "./service";

const ORG_ID = "org-create-spec";
const USER_ID = "user-create-spec";
const DRIVER_SUBJECT = "asub:driver:create-spec-sc8562";
const NODE_SUBJECT = "asub:nodetype:create-spec-charger";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Create Spec Admin",
    email: "create-spec@example.com",
    organizationName: "Create Spec Org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  });
}

async function seedSubjects(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Create Spec Org')`, [ORG_ID]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Create Spec Admin', 'create-spec@example.com', 'Admin', true)`,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into attribution_subjects (
      id, organization_id, subject_kind, display_name, origin, source_key
    ) values
      ($1, $2, 'driver-registration', 'SC8562', 'curated', 'compatible:sc8562'),
      ($3, $2, 'node-type-definition', 'charger', 'curated', 'nodetype:charger')
    `,
    [DRIVER_SUBJECT, ORG_ID, NODE_SUBJECT],
  );
  await db.query(
    `
    insert into driver_registrations (
      attribution_subject_id, driver_nature, instance_cardinality, notes
    ) values ($1, 'physical-device', 'multiple', '')
    `,
    [DRIVER_SUBJECT],
  );
  await db.query(
    `
    insert into node_type_definitions (attribution_subject_id, bare_node_name)
    values ($1, 'charger')
    `,
    [NODE_SUBJECT],
  );
}

describe.skipIf(!databaseAvailable)("createParameterSpec (PR4)", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedSubjects(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("rejects create without attributionSubjectId", async () => {
    await expect(
      createParameterSpec(db!, makeAuth(), {
        propertyKey: "gpio_int",
        documentation: "docs",
        reason: "missing subject",
      } as never),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 } satisfies Partial<ApiError>);
  });

  it("rejects structural property keys", async () => {
    await expect(
      createParameterSpec(db!, makeAuth(), {
        attributionSubjectId: DRIVER_SUBJECT,
        propertyKey: "compatible",
        documentation: "docs",
        reason: "structural",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 } satisfies Partial<ApiError>);
  });

  const activatableShape = {
    valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
    constraints: { cells: 1 },
    documentation: "Interrupt GPIO for SC8562 with enough detail",
  };

  it("creates an org-owned draft bound to a driver registration subject", async () => {
    const result = await createParameterSpec(db!, makeAuth(), {
      attributionSubjectId: DRIVER_SUBJECT,
      propertyKey: "gpio_int",
      displayName: "GPIO interrupt",
      ...activatableShape,
      reason: "catalog bootstrap",
    });

    expect(result.item.lifecycle).toBe("draft");
    expect(result.item.propertyKey).toBe("gpio_int");
    expect(result.item.organizationId).toBe(ORG_ID);
    expect(result.item.attributionSubjectId).toBe(DRIVER_SUBJECT);
    expect(result.item.currentVersion).toBe(1);

    const row = await db!.query<{ attribution_subject_id: string; definition_lifecycle: string }>(
      `select attribution_subject_id, definition_lifecycle from parameter_specs where id = $1`,
      [result.item.id],
    );
    expect(row.rows[0]).toMatchObject({
      attribution_subject_id: DRIVER_SUBJECT,
      definition_lifecycle: "draft",
    });
  });

  it("rejects duplicate identity for the same owner+subject+property_key", async () => {
    await createParameterSpec(db!, makeAuth(), {
      attributionSubjectId: DRIVER_SUBJECT,
      propertyKey: "gpio_int",
      ...activatableShape,
      reason: "first",
    });

    await expect(
      createParameterSpec(db!, makeAuth(), {
        attributionSubjectId: DRIVER_SUBJECT,
        propertyKey: "gpio_int",
        ...activatableShape,
        reason: "duplicate",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 } satisfies Partial<ApiError>);
  });

  it("rejects activating a draft without a coverage claim", async () => {
    const created = await createParameterSpec(db!, makeAuth(), {
      attributionSubjectId: DRIVER_SUBJECT,
      propertyKey: "volt",
      ...activatableShape,
      reason: "create for activate",
    });

    await expect(
      activateParameterSpec(db!, makeAuth(), {
        specId: created.item.id,
        valueShape: activatableShape.valueShape,
        constraints: activatableShape.constraints,
        documentation: activatableShape.documentation,
        reason: "activate without claim",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 } satisfies Partial<ApiError>);
  });

  it("activates a draft after an explicit overlay coverage claim upsert", async () => {
    const created = await createParameterSpec(db!, makeAuth(), {
      attributionSubjectId: DRIVER_SUBJECT,
      propertyKey: "volt",
      ...activatableShape,
      reason: "create for covered activate",
    });

    const result = await activateParameterSpec(db!, makeAuth(), {
      specId: created.item.id,
      valueShape: activatableShape.valueShape,
      constraints: activatableShape.constraints,
      documentation: activatableShape.documentation,
      reason: "activate with claim",
      coverageClaim: {
        kind: "overlay-property",
        upsertOverlay: {
          compatible: "sc8562",
          displayName: "SC8562 org overlay",
          createPropertyLink: true,
        },
      },
    });

    expect(result.item.lifecycle).toBe("active");

    const overlayProps = await db!.query<{ property_key: string; parameter_spec_id: string }>(
      `
      select property_key, parameter_spec_id
      from driver_schema_overlay_properties
      where parameter_spec_id = $1
      `,
      [created.item.id],
    );
    expect(overlayProps.rows).toHaveLength(1);
    expect(overlayProps.rows[0]).toMatchObject({
      property_key: "volt",
      parameter_spec_id: created.item.id,
    });
  });
});
