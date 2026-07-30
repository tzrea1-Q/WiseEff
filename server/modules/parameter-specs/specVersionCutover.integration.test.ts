/**
 * PR4: staged ParameterSpecVersion cutover (ADR-0014).
 * Content changes on an active definition prepare a draft successor; finalize
 * atomically switches only when all affected tip bindings are ready.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { activateParameterSpec, finalizeParameterSpecVersionCutover } from "./service";

const ORG_ID = "org-cutover-spec";
const USER_ID = "user-cutover-spec";
const ACTIVE_SPEC = "pspec:cutover:active";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Cutover Admin",
      email: "cutover@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Cutover Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  };
}

async function seedActiveSpec(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Cutover Org')`, [ORG_ID]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Cutover Admin', 'cutover@example.com', 'Admin', true)`,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key, definition_lifecycle)
    values ($1, $2, 'manual', 'manual/cutover-active', 'active')
    `,
    [ACTIVE_SPEC, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle, version_status, activated_at,
      constraints, documentation
    ) values (
      $1, $2, 1, 'cutover', 'cutover', '{"kind":"cells","bits":32,"groups":1,"cellsPerGroup":1}'::jsonb,
      null, null, 'active', 'active', '2026-07-01T00:00:00.000Z'::timestamptz,
      '{"cells":1}'::jsonb, 'fixture docs'
    )
    `,
    [`${ACTIVE_SPEC}:v1`, ACTIVE_SPEC],
  );
  await db.query(
    `
    insert into dts_property_specs (
      id, parameter_spec_id, property_key, schema_namespace, constraints, documentation
    ) values ($1, $2, 'cutover_prop', 'manual', '{"cells":1}'::jsonb, 'fixture docs')
    `,
    [`dps-${ACTIVE_SPEC}`, ACTIVE_SPEC],
  );
}

describe.skipIf(!databaseAvailable)("parameter spec version cutover (PR4)", () => {
  let db: InMemoryTestDatabase | undefined;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedActiveSpec(db);
  });

  afterEach(async () => {
    await db?.rollback();
    db = undefined;
  });

  it("content change on an unbound active definition prepares and auto-finalizes successor", async () => {
    const result = await activateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
      constraints: { cells: 1 },
      documentation: "successor docs after cutover",
      reason: "semantic edit",
    });

    expect(result.item.lifecycle).toBe("active");
    expect(result.item.currentVersion).toBe(2);

    const versions = await db!.query<{ version: number; version_status: string }>(
      `
      select version, version_status
      from parameter_spec_versions
      where parameter_spec_id = $1
      order by version asc
      `,
      [ACTIVE_SPEC],
    );
    expect(versions.rows).toEqual([
      { version: 1, version_status: "superseded" },
      { version: 2, version_status: "active" },
    ]);

    const runs = await db!.query<{ status: string }>(
      `select status from parameter_spec_version_cutover_runs where parameter_spec_id = $1`,
      [ACTIVE_SPEC],
    );
    expect(runs.rows[0]?.status).toBe("finalized");
  });

  it("finalize is idempotent for an already finalized cutover run", async () => {
    const activated = await activateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
      constraints: { cells: 1 },
      documentation: "successor docs after cutover",
      reason: "semantic edit",
    });

    const run = await db!.query<{ id: string }>(
      `select id from parameter_spec_version_cutover_runs where parameter_spec_id = $1`,
      [ACTIVE_SPEC],
    );
    const finalized = await finalizeParameterSpecVersionCutover(db!, makeAuth(), {
      runId: run.rows[0]!.id,
      reason: "idempotent finalize",
    });
    expect(finalized.item.currentVersionId).toBe(activated.item.currentVersionId);
  });
});
