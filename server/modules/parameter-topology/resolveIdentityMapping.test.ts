import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { createOrReuseBinding, upsertBindingRevisionValues } from "./bindingService";
import { resolveIdentityMappingTask } from "./service";

const databaseAvailable = await isTestDatabaseAvailable();

const ORG_ID = "org-topo-map-resolve";
const PROJECT_ID = "project-topo-map-resolve";
const USER_ID = "user-topo-map-resolve";
const CONFIG_SET_ID = "dcs-topo-map-resolve";
const SPEC_ID = "spec-topo-map-gpio";
const SPEC_VERSION_ID = "specver-topo-map-gpio";

const PREV_A = "ln-prev-a";
const PREV_B = "ln-prev-b";
const CAND_A1 = "ln-cand-a1";
const CAND_A2 = "ln-cand-a2";
const CAND_B1 = "ln-cand-b1";
const CAND_B2 = "ln-cand-b2";
const LOCATOR_A1 = "/amba/i2c@1/dev_a@10";
const LOCATOR_A2 = "/amba/i2c@1/dev_a_dup@10";
const LOCATOR_B1 = "/amba/i2c@2/dev_b@20";
const LOCATOR_B2 = "/amba/i2c@2/dev_b_dup@20";

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Map Resolve Admin",
      email: "map-resolve@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Map Resolve Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Map Resolve Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Map Resolve Admin', 'map-resolve@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Map Resolve', 'MPR', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'map-resolve', 'identity mapping resolve fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'dts', 'dev/gpio_int')
    on conflict (id) do nothing
    `,
    [SPEC_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape, lifecycle
    ) values ($1, $2, 1, 'gpio_int', 'GPIO interrupt', '{}'::jsonb, 'active')
    on conflict (id) do nothing
    `,
    [SPEC_VERSION_ID, SPEC_ID],
  );
  await db.query(
    `
    insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
    values ($1, $2, 'gpio_int', 'vendor', '{}'::jsonb)
    on conflict (id) do nothing
    `,
    ["dps-map-gpio", SPEC_ID],
  );
}

async function insertLogicalNode(db: InMemoryTestDatabase, id: string) {
  await db.query(
    `
    insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
    values ($1, $2, $3, $4)
    `,
    [id, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
  );
}

async function insertLogicalNodeRevision(
  db: InMemoryTestDatabase,
  input: { id: string; logicalNodeId: string; configRevisionId: string; locator: string; name: string },
) {
  await db.query(
    `
    insert into dts_logical_node_revisions (
      id, logical_node_id, config_revision_id, node_locator, name, unit_address, parent_logical_node_id
    ) values ($1, $2, $3, $4, $5, null, null)
    `,
    [input.id, input.logicalNodeId, input.configRevisionId, input.locator, input.name],
  );
}

async function seedMultiTaskAmbiguousRevision(db: InMemoryTestDatabase) {
  const revisionId = randomUUID();
  await db.query(
    `
    insert into dts_config_revisions (
      id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
    ) values ($1, $2, $3, $4, 1, 'needs_mapping', $5)
    `,
    [revisionId, ORG_ID, PROJECT_ID, CONFIG_SET_ID, USER_ID],
  );

  for (const id of [PREV_A, PREV_B, CAND_A1, CAND_A2, CAND_B1, CAND_B2]) {
    await insertLogicalNode(db, id);
  }

  // Prior continuity baseline: previous nodes already have stable bindings.
  const prevBindingA = await createOrReuseBinding(db, {
    organizationId: ORG_ID,
    key: { projectId: PROJECT_ID, logicalNodeId: PREV_A, parameterSpecId: SPEC_ID },
  });
  const prevBindingB = await createOrReuseBinding(db, {
    organizationId: ORG_ID,
    key: { projectId: PROJECT_ID, logicalNodeId: PREV_B, parameterSpecId: SPEC_ID },
  });

  await insertLogicalNodeRevision(db, {
    id: randomUUID(),
    logicalNodeId: CAND_A1,
    configRevisionId: revisionId,
    locator: LOCATOR_A1,
    name: "dev_a",
  });
  await insertLogicalNodeRevision(db, {
    id: randomUUID(),
    logicalNodeId: CAND_A2,
    configRevisionId: revisionId,
    locator: LOCATOR_A2,
    name: "dev_a_dup",
  });
  await insertLogicalNodeRevision(db, {
    id: randomUUID(),
    logicalNodeId: CAND_B1,
    configRevisionId: revisionId,
    locator: LOCATOR_B1,
    name: "dev_b",
  });
  await insertLogicalNodeRevision(db, {
    id: randomUUID(),
    logicalNodeId: CAND_B2,
    configRevisionId: revisionId,
    locator: LOCATOR_B2,
    name: "dev_b_dup",
  });

  // Ingest-under-ambiguity created provisional bindings on candidate ids.
  for (const candidateId of [CAND_A1, CAND_A2, CAND_B1, CAND_B2]) {
    const binding = await createOrReuseBinding(db, {
      organizationId: ORG_ID,
      key: { projectId: PROJECT_ID, logicalNodeId: candidateId, parameterSpecId: SPEC_ID },
    });
    await upsertBindingRevisionValues(db, {
      bindingId: binding.id,
      configRevisionId: revisionId,
      parameterSpecVersionId: SPEC_VERSION_ID,
      values: {
        typedValue: { kind: "raw", rawText: "<1>" },
        rawValue: "<1>",
        schemaState: "matched",
      },
    });
  }

  const taskA = randomUUID();
  const taskB = randomUUID();
  await db.query(
    `
    insert into identity_mapping_tasks (
      id, organization_id, project_id, config_revision_id,
      previous_logical_node_id, candidate_logical_node_ids, evidence, status
    ) values
      ($1, $2, $3, $4, $5, $6::jsonb, '{}'::jsonb, 'open'),
      ($7, $2, $3, $4, $8, $9::jsonb, '{}'::jsonb, 'open')
    `,
    [
      taskA,
      ORG_ID,
      PROJECT_ID,
      revisionId,
      PREV_A,
      JSON.stringify([CAND_A1, CAND_A2]),
      taskB,
      PREV_B,
      JSON.stringify([CAND_B1, CAND_B2]),
    ],
  );

  return { revisionId, taskA, taskB, prevBindingA, prevBindingB };
}

describe.skipIf(!databaseAvailable)("resolveIdentityMappingTask transaction", () => {
  let db: InMemoryTestDatabase | undefined;
  let auth: AuthContext;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
    auth = makeAuth();
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("resolving one of two open tasks keeps needs_mapping and applies selectedLogicalNodeId continuity", async () => {
    const { revisionId, taskA, taskB, prevBindingA } = await seedMultiTaskAmbiguousRevision(db!);

    const result = await resolveIdentityMappingTask(db!, auth, {
      taskId: taskA,
      decision: "resolved",
      selectedLogicalNodeId: CAND_A1,
      reason: "Same board instance A",
    });

    expect(result).toMatchObject({
      id: taskA,
      status: "resolved",
      selectedLogicalNodeId: CAND_A1,
    });

    const revisionStatus = await db!.query<{ status: string }>(
      `select status from dts_config_revisions where id = $1`,
      [revisionId],
    );
    expect(revisionStatus.rows[0]?.status).toBe("needs_mapping");

    const openCount = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from identity_mapping_tasks
      where config_revision_id = $1 and status = 'open'
      `,
      [revisionId],
    );
    expect(Number(openCount.rows[0]?.count)).toBe(1);

    const taskBStatus = await db!.query<{ status: string }>(
      `select status from identity_mapping_tasks where id = $1`,
      [taskB],
    );
    expect(taskBStatus.rows[0]?.status).toBe("open");

    // Selected candidate remapped onto previous stable logical identity.
    const remapped = await db!.query<{ logical_node_id: string }>(
      `
      select logical_node_id
      from dts_logical_node_revisions
      where config_revision_id = $1 and node_locator = $2
      `,
      [revisionId, LOCATOR_A1],
    );
    expect(remapped.rows[0]?.logical_node_id).toBe(PREV_A);

    // Affected binding revisions reuse the previous stable binding id.
    const appliedBinding = await db!.query<{ binding_id: string; logical_node_id: string }>(
      `
      select br.binding_id, b.logical_node_id
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join dts_logical_node_revisions lnr
        on lnr.logical_node_id = b.logical_node_id and lnr.config_revision_id = br.config_revision_id
      where br.config_revision_id = $1 and lnr.node_locator = $2
      `,
      [revisionId, LOCATOR_A1],
    );
    expect(appliedBinding.rows[0]?.logical_node_id).toBe(PREV_A);
    expect(appliedBinding.rows[0]?.binding_id).toBe(prevBindingA.id);

    // Provisional candidate binding revision for this config revision is gone.
    const provisionalLeft = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      where br.config_revision_id = $1 and b.logical_node_id = $2
      `,
      [revisionId, CAND_A1],
    );
    expect(Number(provisionalLeft.rows[0]?.count)).toBe(0);
  });

  it("resolving the last open task marks the revision resolved", async () => {
    const { revisionId, taskA, taskB, prevBindingA, prevBindingB } =
      await seedMultiTaskAmbiguousRevision(db!);

    await resolveIdentityMappingTask(db!, auth, {
      taskId: taskA,
      decision: "resolved",
      selectedLogicalNodeId: CAND_A1,
      reason: "Resolve A",
    });
    await resolveIdentityMappingTask(db!, auth, {
      taskId: taskB,
      decision: "resolved",
      selectedLogicalNodeId: CAND_B1,
      reason: "Resolve B",
    });

    const revisionStatus = await db!.query<{ status: string }>(
      `select status from dts_config_revisions where id = $1`,
      [revisionId],
    );
    expect(revisionStatus.rows[0]?.status).toBe("resolved");

    const bindingA = await db!.query<{ binding_id: string }>(
      `
      select br.binding_id
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      where br.config_revision_id = $1 and b.logical_node_id = $2
      `,
      [revisionId, PREV_A],
    );
    const bindingB = await db!.query<{ binding_id: string }>(
      `
      select br.binding_id
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      where br.config_revision_id = $1 and b.logical_node_id = $2
      `,
      [revisionId, PREV_B],
    );
    expect(bindingA.rows[0]?.binding_id).toBe(prevBindingA.id);
    expect(bindingB.rows[0]?.binding_id).toBe(prevBindingB.id);
  });

  it("dismiss does not make a still-ambiguous revision releasable", async () => {
    const { revisionId, taskA, taskB } = await seedMultiTaskAmbiguousRevision(db!);

    await resolveIdentityMappingTask(db!, auth, {
      taskId: taskA,
      decision: "dismissed",
      reason: "Not enough evidence",
    });

    const revisionStatus = await db!.query<{ status: string }>(
      `select status from dts_config_revisions where id = $1`,
      [revisionId],
    );
    expect(revisionStatus.rows[0]?.status).toBe("needs_mapping");

    const openCount = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from identity_mapping_tasks
      where config_revision_id = $1 and status = 'open'
      `,
      [revisionId],
    );
    expect(Number(openCount.rows[0]?.count)).toBe(1);
    expect(
      (
        await db!.query<{ status: string }>(`select status from identity_mapping_tasks where id = $1`, [
          taskB,
        ])
      ).rows[0]?.status,
    ).toBe("open");

    // Dismissing the last open task still leaves needs_mapping (identity unresolved).
    await resolveIdentityMappingTask(db!, auth, {
      taskId: taskB,
      decision: "dismissed",
      reason: "Still ambiguous",
    });
    const afterLastDismiss = await db!.query<{ status: string }>(
      `select status from dts_config_revisions where id = $1`,
      [revisionId],
    );
    expect(afterLastDismiss.rows[0]?.status).toBe("needs_mapping");
  });
});
