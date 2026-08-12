/**
 * PR4: staged ParameterSpecVersion cutover (ADR-0014).
 * Content changes on an active definition prepare a draft successor; finalize
 * atomically switches only when all affected tip bindings are ready.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  activateParameterSpec,
  finalizeParameterSpecVersionCutover,
  prepareParameterSpecVersionCutover,
} from "./service";
import { ApiError } from "../../shared/http/errors";

const ORG_ID = "org-cutover-spec";
const USER_ID = "user-cutover-spec";
const ACTIVE_SPEC = "pspec:cutover:active";
const PROJECT_ID = "proj-cutover-tip";
const BINDING_ID = "bind-cutover-tip";
const MODULE_ID = "mod-cutover-tip";
const V1_ID = `${ACTIVE_SPEC}:v1`;

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: USER_ID,
    organizationId: ORG_ID,
    name: "Cutover Admin",
    email: "cutover@example.com",
    organizationName: "Cutover Org",
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  });
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

async function seedTipBinding(db: InMemoryTestDatabase) {
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Cutover Project', 'CUT', 'initialized')`,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name)
     values ('cs-cutover-tip', $1, $2, 'default')`,
    [ORG_ID, PROJECT_ID],
  );
  await db.query(
    `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
     values ('cr-cutover-tip', $1, $2, 'cs-cutover-tip', 1, 'resolved')`,
    [ORG_ID, PROJECT_ID],
  );
  await db.query(
    `insert into parameter_modules (id, organization_id, name, path)
     values ($1, $2, '充电', 'p-charge')`,
    [MODULE_ID, ORG_ID],
  );
  await db.query(
    `insert into project_parameter_bindings (
      id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id
    ) values ($1, $2, $3, null, $4, $5)`,
    [BINDING_ID, ORG_ID, PROJECT_ID, ACTIVE_SPEC, MODULE_ID],
  );
  await db.query(
    `insert into project_parameter_binding_revisions (
      id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value
    ) values ('rev-cutover-tip', $1, 'cr-cutover-tip', $2, '{}'::jsonb, '<0>')`,
    [BINDING_ID, V1_ID],
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

  it("tip bindings leave cutover preparing until prepare then finalize switches versions", async () => {
    await seedTipBinding(db!);

    const activated = await activateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
      constraints: { cells: 1 },
      documentation: "successor docs with tip binding",
      reason: "semantic edit with binding",
    });

    expect(activated.item.currentVersion).toBe(1);
    expect(activated.item.currentVersionId).toBe(V1_ID);

    const run = await db!.query<{ id: string; status: string; to_version_id: string }>(
      `select id, status, to_version_id from parameter_spec_version_cutover_runs where parameter_spec_id = $1`,
      [ACTIVE_SPEC],
    );
    const toVersionId = run.rows[0]!.to_version_id;
    expect(run.rows[0]?.status).toBe("preparing");

    const items = await db!.query<{ status: string }>(
      `select status from parameter_spec_version_cutover_items where run_id = $1`,
      [run.rows[0]!.id],
    );
    expect(items.rows).toEqual([{ status: "pending" }]);

    const prepared = await prepareParameterSpecVersionCutover(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      reason: "prepare tip bindings",
    });
    expect(prepared.item.cutover?.status).toBe("ready");
    expect(prepared.item.cutover?.impact.ready).toBe(1);
    expect(prepared.item.cutover?.impact.pending).toBe(0);

    const readyItems = await db!.query<{
      status: string;
      successor_revision_id: string;
    }>(
      `select status, successor_revision_id from parameter_spec_version_cutover_items where run_id = $1`,
      [run.rows[0]!.id],
    );
    expect(readyItems.rows[0]).toMatchObject({
      status: "ready",
      successor_revision_id: "rev-cutover-tip",
    });

    const finalized = await finalizeParameterSpecVersionCutover(db!, makeAuth(), {
      runId: run.rows[0]!.id,
      reason: "finalize after prepare",
    });
    expect(finalized.item.currentVersion).toBe(2);
    expect(finalized.item.currentVersionId).toBe(toVersionId);
    expect(finalized.item.cutover).toBeUndefined();

    const versions = await db!.query<{ id: string; version_status: string }>(
      `select id, version_status from parameter_spec_versions where parameter_spec_id = $1 order by version asc`,
      [ACTIVE_SPEC],
    );
    expect(versions.rows).toEqual([
      { id: V1_ID, version_status: "superseded" },
      { id: toVersionId, version_status: "active" },
    ]);

    const revision = await db!.query<{ parameter_spec_version_id: string }>(
      `select parameter_spec_version_id from project_parameter_binding_revisions where id = 'rev-cutover-tip'`,
    );
    expect(revision.rows[0]?.parameter_spec_version_id).toBe(toVersionId);
  });

  it("finalize without prepare returns 409 while cutover items remain pending", async () => {
    await seedTipBinding(db!);

    await activateParameterSpec(db!, makeAuth(), {
      specId: ACTIVE_SPEC,
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
      constraints: { cells: 1 },
      documentation: "successor docs pending finalize",
      reason: "semantic edit blocked finalize",
    });

    const run = await db!.query<{ id: string }>(
      `select id from parameter_spec_version_cutover_runs where parameter_spec_id = $1`,
      [ACTIVE_SPEC],
    );

    await expect(
      finalizeParameterSpecVersionCutover(db!, makeAuth(), {
        runId: run.rows[0]!.id,
        reason: "too early",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
    } satisfies Partial<ApiError>);
  });
});
