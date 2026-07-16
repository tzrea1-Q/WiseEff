/**
 * Task 4: matcher override locator scope + review blocker_scope gates.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import {
  backfillReviewTaskScopeColumns,
  countOpenSpecReviewTasksForRevision,
  listMatcherOverridesForProject,
  matcherOverrideLookupKey,
  nodeLocatorFingerprint,
} from "./repository";
import { resolveSpecReviewTask } from "./service";

const ORG_ID = "org-matcher-scope";
const OTHER_ORG = "org-matcher-scope-other";
const PROJECT_A = "project-matcher-scope-a";
const PROJECT_B = "project-matcher-scope-b";
const USER_ID = "user-matcher-scope";
const CONFIG_SET_A = "dcs-matcher-scope-a";
const CONFIG_SET_B = "dcs-matcher-scope-b";
const PROPERTY_KEY = "twin_mystery";
const SPEC_A = "pspec:manual:twin_a_mystery";
const SPEC_A_VERSION = "psv:manual:twin_a_mystery:v1";
const SPEC_B = "pspec:manual:twin_b_mystery";
const SPEC_B_VERSION = "psv:manual:twin_b_mystery:v1";

const TWIN_DTS = `/dts-v1/;

/ {
	twin_a: twin@1 {
		compatible = "wiseeff,twin-device";
		${PROPERTY_KEY} = <1>;
	};
	twin_b: twin@2 {
		compatible = "wiseeff,twin-device";
		${PROPERTY_KEY} = <2>;
	};
};
`;

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(orgId = ORG_ID): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: orgId,
      name: "Matcher Scope Admin",
      email: "matcher-scope@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: orgId, name: "Matcher Scope Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Matcher Scope Org'), ($2, 'Other Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID, OTHER_ORG],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Matcher Scope Admin', 'matcher-scope@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  for (const [projectId, configSetId, code] of [
    [PROJECT_A, CONFIG_SET_A, "MSA"],
    [PROJECT_B, CONFIG_SET_B, "MSB"],
  ] as const) {
    await db.query(
      `
      insert into projects (id, organization_id, name, code, status)
      values ($1, $2, $3, $4, 'initialized')
      on conflict (id) do update set name = excluded.name
      `,
      [projectId, ORG_ID, `Matcher Scope ${code}`, code],
    );
    await db.query(
      `
      insert into dts_config_set (id, organization_id, project_id, name, description)
      values ($1, $2, $3, 'twin-set', 'matcher scope fixture')
      on conflict (id) do update set name = excluded.name
      `,
      [configSetId, ORG_ID, projectId],
    );
  }
  for (const [specId, versionId, key, dpsId] of [
    [SPEC_A, SPEC_A_VERSION, "twin_a_mystery", "dps-twin-a"],
    [SPEC_B, SPEC_B_VERSION, "twin_b_mystery", "dps-twin-b"],
  ] as const) {
    await db.query(
      `
      insert into parameter_specs (id, organization_id, source_kind, specification_key)
      values ($1, $2, 'manual', $3)
      on conflict (id) do nothing
      `,
      [specId, ORG_ID, `manual/${key}`],
    );
    await db.query(
      `
      insert into parameter_spec_versions (
        id, parameter_spec_id, version, display_name, description, value_shape,
        schema_default, example_value, lifecycle
      ) values ($1, $2, 1, $3, 'Manual twin mystery', '{"kind":"cells"}'::jsonb, null, null, 'active')
      on conflict (id) do nothing
      `,
      [versionId, specId, key],
    );
    await db.query(
      `
      insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace, constraints)
      values ($1, $2, $3, 'manual', '{}'::jsonb)
      on conflict (id) do nothing
      `,
      [dpsId, specId, PROPERTY_KEY],
    );
  }
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
    projectId: string;
    configSetId: string;
    fileId: string;
    fileName: string;
    versionId: string;
    content: string;
  },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `
    insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)
    on conflict (id) do nothing
    `,
    [input.fileId, ORG_ID, input.projectId, input.fileName, input.configSetId],
  );
  await db.query(
    `
    insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)
    on conflict (id) do nothing
    `,
    [
      input.versionId,
      input.fileId,
      `${ORG_ID}/${checksum}-${input.fileName}`,
      checksum,
      Buffer.byteLength(input.content, "utf8"),
      USER_ID,
    ],
  );
  await db.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
    input.versionId,
    input.fileId,
  ]);
}

function manifest(
  projectId: string,
  configSetId: string,
  versionId: string,
  fileId: string,
): ConfigRevisionManifest {
  return {
    organizationId: ORG_ID,
    projectId,
    configSetId,
    entryFile: "twins.dts",
    includeSearchPaths: ["."],
    overlayOrder: [],
    members: [
      {
        fileId,
        fileVersionId: versionId,
        fileName: "twins.dts",
        role: "base",
        sortOrder: 0,
        content: TWIN_DTS,
      },
    ],
  };
}

describe.skipIf(!databaseAvailable)("matcher scope integration", () => {
  let db: InMemoryTestDatabase | null = null;

  beforeEach(async () => {
    db = await createInMemoryTestDatabase();
    await seedGraph(db);
  });

  afterEach(async () => {
    if (db) {
      await db.rollback();
      db = null;
    }
  });

  it("same-compatible different-locator nodes keep distinct overrides across re-ingest", async () => {
    const fileId = "file-twin-scope";
    const versionId = "fv-twin-scope-1";
    await insertPinnedMember(db!, {
      projectId: PROJECT_A,
      configSetId: CONFIG_SET_A,
      fileId,
      fileName: "twins.dts",
      versionId,
      content: TWIN_DTS,
    });

    const revision1 = await ingestConfigRevision(
      db!,
      manifest(PROJECT_A, CONFIG_SET_A, versionId, fileId),
      makeAuth(),
    );
    expect(revision1.status).toBe("resolved");

    const tasks = await db!.query<{
      id: string;
      project_id: string | null;
      config_revision_id: string | null;
      property_occurrence_id: string | null;
      blocker_scope: string;
      source_evidence: Record<string, unknown>;
    }>(
      `
      select id, project_id, config_revision_id, property_occurrence_id, blocker_scope, source_evidence
      from parameter_spec_review_tasks
      where organization_id = $1
        and status = 'open'
        and source_evidence->>'propertyKey' = $2
      order by source_evidence->>'nodeLocator' asc
      `,
      [ORG_ID, PROPERTY_KEY],
    );
    expect(tasks.rows).toHaveLength(2);
    for (const row of tasks.rows) {
      expect(row.project_id).toBe(PROJECT_A);
      expect(row.config_revision_id).toBe(revision1.id);
      expect(row.property_occurrence_id).toBeTruthy();
      expect(row.blocker_scope).toBe("revision");
    }

    const [taskA, taskB] = tasks.rows;
    const locatorA = String(taskA!.source_evidence.nodeLocator);
    const locatorB = String(taskB!.source_evidence.nodeLocator);
    expect(locatorA).not.toBe(locatorB);

    await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: taskA!.id,
      decision: "resolved",
      parameterSpecId: SPEC_A,
      reason: "Map twin_a mystery",
    });
    await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: taskB!.id,
      decision: "resolved",
      parameterSpecId: SPEC_B,
      reason: "Map twin_b mystery",
    });

    const overrides = await listMatcherOverridesForProject(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_A,
    });
    expect(overrides.filter((row) => row.propertyKey === PROPERTY_KEY)).toHaveLength(2);
    const overrideA = overrides.find((row) => row.nodeLocator === locatorA);
    const overrideB = overrides.find((row) => row.nodeLocator === locatorB);
    expect(overrideA?.parameterSpecId).toBe(SPEC_A);
    expect(overrideB?.parameterSpecId).toBe(SPEC_B);
    expect(nodeLocatorFingerprint(overrideA?.nodeLocator)).not.toBe(
      nodeLocatorFingerprint(overrideB?.nodeLocator),
    );

    const versionId2 = "fv-twin-scope-2";
    await db!.query(
      `
      insert into project_parameter_file_versions (
        id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
      ) values ($1, $2, 2, $3, $4, $5, '{}'::jsonb, 'upload', $6)
      `,
      [
        versionId2,
        fileId,
        `${ORG_ID}/v2-twins.dts`,
        createHash("sha256").update(TWIN_DTS, "utf8").digest("hex"),
        Buffer.byteLength(TWIN_DTS, "utf8"),
        USER_ID,
      ],
    );
    await db!.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId2,
      fileId,
    ]);

    const revision2 = await ingestConfigRevision(
      db!,
      manifest(PROJECT_A, CONFIG_SET_A, versionId2, fileId),
      makeAuth(),
    );
    expect(revision2.status).toBe("resolved");

    const bindings = await db!.query<{ node_locator: string; parameter_spec_id: string }>(
      `
      select lnr.node_locator, b.parameter_spec_id
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      inner join dts_logical_node_revisions lnr
        on lnr.logical_node_id = b.logical_node_id
       and lnr.config_revision_id = br.config_revision_id
      where br.config_revision_id = $1
      order by lnr.node_locator asc
      `,
      [revision2.id],
    );
    expect(bindings.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_locator: locatorA, parameter_spec_id: SPEC_A }),
        expect.objectContaining({ node_locator: locatorB, parameter_spec_id: SPEC_B }),
      ]),
    );

    const openMysteryOnRevision2 = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_spec_review_tasks
      where organization_id = $1
        and status = 'open'
        and config_revision_id = $2
        and source_evidence->>'propertyKey' = $3
      `,
      [ORG_ID, revision2.id, PROPERTY_KEY],
    );
    expect(Number(openMysteryOnRevision2.rows[0]?.count)).toBe(0);
  });

  it("revision-scoped blockers do not cross revision, project, or org", async () => {
    const revisionA = randomUUID();
    const revisionB = randomUUID();
    const taskRevisionA = randomUUID();
    const taskOtherRevision = randomUUID();
    const taskOtherProject = randomUUID();
    const taskOtherOrg = randomUUID();
    const taskPlatform = randomUUID();

    for (const [revisionId, projectId, configSetId, revisionNumber] of [
      [revisionA, PROJECT_A, CONFIG_SET_A, 901],
      [revisionB, PROJECT_A, CONFIG_SET_A, 902],
    ] as const) {
      await db!.query(
        `
        insert into dts_config_revisions (
          id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
        ) values ($1, $2, $3, $4, $5, 'resolved', $6)
        on conflict (id) do nothing
        `,
        [revisionId, ORG_ID, projectId, configSetId, revisionNumber, USER_ID],
      );
    }

    await db!.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, project_id, config_revision_id, blocker_scope,
        source_evidence, candidate_schemas, project_count, status
      ) values
        ($1, $2, $3, $4, 'revision', $5::jsonb, '[]'::jsonb, 1, 'open'),
        ($6, $2, $3, $7, 'revision', $8::jsonb, '[]'::jsonb, 1, 'open'),
        ($9, $2, $10, $4, 'revision', $11::jsonb, '[]'::jsonb, 1, 'open'),
        ($12, $13, $3, $4, 'revision', $14::jsonb, '[]'::jsonb, 1, 'open'),
        ($15, $2, null, null, 'platform', $16::jsonb, '[]'::jsonb, 1, 'open')
      `,
      [
        taskRevisionA,
        ORG_ID,
        PROJECT_A,
        revisionA,
        JSON.stringify({ projectId: PROJECT_A, configRevisionId: revisionA, propertyKey: "gate_a" }),
        taskOtherRevision,
        revisionB,
        JSON.stringify({ projectId: PROJECT_A, configRevisionId: revisionB, propertyKey: "gate_b" }),
        taskOtherProject,
        PROJECT_B,
        JSON.stringify({ projectId: PROJECT_B, configRevisionId: revisionA, propertyKey: "gate_c" }),
        taskOtherOrg,
        OTHER_ORG,
        JSON.stringify({ projectId: PROJECT_A, configRevisionId: revisionA, propertyKey: "gate_d" }),
        taskPlatform,
        JSON.stringify({ inferred: true, propertyKey: "gate_platform" }),
      ],
    );

    const blocksRevisionA = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_A,
      configRevisionId: revisionA,
    });
    expect(blocksRevisionA).toBe(3);

    const blocksRevisionB = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_A,
      configRevisionId: revisionB,
    });
    expect(blocksRevisionB).toBe(2);

    const blocksProjectB = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_B,
      configRevisionId: revisionA,
    });
    expect(blocksProjectB).toBe(3);

    await db!.query(`delete from parameter_spec_review_tasks where id = $1`, [taskPlatform]);

    const beforeLegacyCrossSpec = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_A,
      configRevisionId: revisionA,
    });
    expect(beforeLegacyCrossSpec).toBe(2);

    const legacyCrossRevision = randomUUID();
    await db!.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, parameter_spec_id, project_id, config_revision_id, blocker_scope,
        source_evidence, candidate_schemas, project_count, status
      ) values ($1, $2, $3, $4, $5, 'revision', $6::jsonb, '[]'::jsonb, 1, 'open')
      `,
      [
        legacyCrossRevision,
        ORG_ID,
        SPEC_A,
        PROJECT_A,
        revisionB,
        JSON.stringify({
          projectId: PROJECT_A,
          configRevisionId: revisionB,
          propertyKey: "legacy_cross",
        }),
      ],
    );

    const afterLegacyCrossSpec = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_A,
      configRevisionId: revisionA,
    });
    expect(afterLegacyCrossSpec).toBe(beforeLegacyCrossSpec);

    const otherOrgBlocks = await countOpenSpecReviewTasksForRevision(db!, {
      organizationId: OTHER_ORG,
      projectId: PROJECT_A,
      configRevisionId: revisionA,
    });
    expect(otherOrgBlocks).toBe(1);
  });

  it("backfills legacy review tasks from source_evidence safely", async () => {
    const legacyId = randomUUID();
    const revisionId = randomUUID();
    await db!.query(
      `
      insert into dts_config_revisions (
        id, organization_id, project_id, config_set_id, revision_number, status, created_by_user_id
      ) values ($1, $2, $3, $4, 99, 'resolved', $5)
      on conflict (id) do nothing
      `,
      [revisionId, ORG_ID, PROJECT_A, CONFIG_SET_A, USER_ID],
    );
    await db!.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, source_evidence, candidate_schemas, project_count, status
      ) values ($1, $2, $3::jsonb, '[]'::jsonb, 1, 'open')
      `,
      [
        legacyId,
        ORG_ID,
        JSON.stringify({
          projectId: PROJECT_A,
          configRevisionId: revisionId,
          propertyKey: "legacy_prop",
          inferred: true,
        }),
      ],
    );

    const updated = await backfillReviewTaskScopeColumns(db!);
    expect(updated).toBeGreaterThanOrEqual(1);

    const row = await db!.query<{
      project_id: string | null;
      config_revision_id: string | null;
      property_occurrence_id: string | null;
      blocker_scope: string;
    }>(
      `
      select project_id, config_revision_id, property_occurrence_id, blocker_scope
      from parameter_spec_review_tasks
      where id = $1
      `,
      [legacyId],
    );
    expect(row.rows[0]).toMatchObject({
      project_id: PROJECT_A,
      config_revision_id: revisionId,
      property_occurrence_id: null,
      blocker_scope: "revision",
    });

    const idempotent = await backfillReviewTaskScopeColumns(db!);
    expect(idempotent).toBe(0);
  });
});

describe("matcherOverrideLookupKey", () => {
  it("normalizes locator slashes consistently", () => {
    const compatible = ["wiseeff", "twin-device"];
    const keyA = matcherOverrideLookupKey({
      compatible,
      nodeLocator: "/twin_a//",
      propertyKey: PROPERTY_KEY,
    });
    const keyB = matcherOverrideLookupKey({
      compatible,
      nodeLocator: "/twin_a",
      propertyKey: PROPERTY_KEY,
    });
    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(
      matcherOverrideLookupKey({
        compatible,
        nodeLocator: "/twin_b",
        propertyKey: PROPERTY_KEY,
      }),
    );
  });
});
