/**
 * Task 3: unmatched ingest → review → API resolve → binding → next revision reuses override.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ApiError } from "../../shared/http/errors";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import {
  countDismissedSpecBlockersForRevision,
  listMatcherOverridesForProject,
} from "./repository";
import { resolveSpecReviewTask } from "./service";

const ORG_ID = "org-spec-review-apply";
const OTHER_ORG = "org-spec-review-other";
const PROJECT_ID = "project-spec-review-apply";
const USER_ID = "user-spec-review-apply";
const CONFIG_SET_ID = "dcs-spec-review-apply";
const SPEC_ID = "pspec:manual:mystery_unmatched";
const SPEC_VERSION_ID = "psv:manual:mystery_unmatched:v1";
const PROPERTY_KEY = "mystery_unmatched";

const UNMATCHED_DTS = `/dts-v1/;

/ {
	ghost: ghost@0 {
		compatible = "wiseeff,ghost-device";
		${PROPERTY_KEY} = <1>;
	};
};
`;

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(orgId = ORG_ID): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: orgId,
      name: "Spec Review Admin",
      email: "spec-review@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: orgId, name: "Spec Review Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(
    `insert into organizations (id, name) values ($1, 'Spec Review Org'), ($2, 'Other Org')
     on conflict (id) do update set name = excluded.name`,
    [ORG_ID, OTHER_ORG],
  );
  await db.query(
    `
    insert into users (id, organization_id, name, email, title, is_active)
    values ($1, $2, 'Spec Review Admin', 'spec-review@example.com', 'Admin', true)
    on conflict (id) do update set organization_id = excluded.organization_id
    `,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `
    insert into projects (id, organization_id, name, code, status)
    values ($1, $2, 'Spec Review', 'SRA', 'initialized')
    on conflict (id) do update set name = excluded.name
    `,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `
    insert into dts_config_set (id, organization_id, project_id, name, description)
    values ($1, $2, $3, 'ghost-set', 'spec review apply fixture')
    on conflict (id) do update set name = excluded.name
    `,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
  await db.query(
    `
    insert into parameter_specs (id, organization_id, source_kind, specification_key)
    values ($1, $2, 'manual', 'manual/mystery_unmatched')
    on conflict (id) do nothing
    `,
    [SPEC_ID, ORG_ID],
  );
  await db.query(
    `
    insert into parameter_spec_versions (
      id, parameter_spec_id, version, display_name, description, value_shape,
      schema_default, example_value, lifecycle
    ) values ($1, $2, 1, 'mystery_unmatched', 'Manual reviewed mystery', '{"kind":"cells"}'::jsonb, null, null, 'active')
    on conflict (id) do nothing
    `,
    [SPEC_VERSION_ID, SPEC_ID],
  );
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: {
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
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID],
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

function manifest(versionId: string, fileId: string): ConfigRevisionManifest {
  return {
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    configSetId: CONFIG_SET_ID,
    entryFile: "ghost.dts",
    includeSearchPaths: ["."],
    overlayOrder: [],
    members: [
      {
        fileId,
        fileVersionId: versionId,
        fileName: "ghost.dts",
        role: "base",
        sortOrder: 0,
        content: UNMATCHED_DTS,
      },
    ],
  };
}

describe.skipIf(!databaseAvailable)("spec review apply integration", () => {
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

  it("unmatched ingest → resolve creates binding/override; next revision reuses; dismiss fail-closed; rollback + 404", async () => {
    const fileId = "file-ghost-sra";
    const versionId = "fv-ghost-sra-1";
    await insertPinnedMember(db!, {
      fileId,
      fileName: "ghost.dts",
      versionId,
      content: UNMATCHED_DTS,
    });

    const revision1 = await ingestConfigRevision(db!, manifest(versionId, fileId), makeAuth());
    expect(revision1.status).toBe("resolved");

    const openTasks = await db!.query<{
      id: string;
      source_evidence: Record<string, unknown>;
      status: string;
    }>(
      `
      select id, source_evidence, status
      from parameter_spec_review_tasks
      where organization_id = $1 and status = 'open'
      `,
      [ORG_ID],
    );
    expect(openTasks.rows.length).toBeGreaterThanOrEqual(1);
    const task = openTasks.rows.find((row) => row.source_evidence.propertyKey === PROPERTY_KEY);
    expect(task).toBeTruthy();
    expect(task!.source_evidence).toMatchObject({
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      configRevisionId: revision1.id,
      propertyKey: PROPERTY_KEY,
    });
    expect(task!.source_evidence.propertyOccurrenceId).toBeTruthy();
    expect(task!.source_evidence.logicalNodeId).toBeTruthy();

    // Cross-org task id → 404
    await expect(
      resolveSpecReviewTask(db!, makeAuth(OTHER_ORG), {
        taskId: task!.id,
        decision: "resolved",
        parameterSpecId: SPEC_ID,
        reason: "cross org",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 } satisfies Partial<ApiError>);

    // Incomplete evidence → validation failure rolls back (task stays open)
    const badTaskId = randomUUID();
    await db!.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, source_evidence, candidate_schemas, project_count, status
      ) values ($1, $2, '{}'::jsonb, '[]'::jsonb, 1, 'open')
      `,
      [badTaskId, ORG_ID],
    );
    await expect(
      resolveSpecReviewTask(db!, makeAuth(), {
        taskId: badTaskId,
        decision: "resolved",
        parameterSpecId: SPEC_ID,
        reason: "missing locate",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 });
    const stillOpen = await db!.query<{ status: string }>(
      `select status from parameter_spec_review_tasks where id = $1`,
      [badTaskId],
    );
    expect(stillOpen.rows[0]?.status).toBe("open");
    const noBindingFromBad = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where parameter_spec_id = $1`,
      [SPEC_ID],
    );
    expect(Number(noBindingFromBad.rows[0]?.count)).toBe(0);

    const resolved = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task!.id,
      decision: "resolved",
      parameterSpecId: SPEC_ID,
      reason: "Map mystery to manual spec",
    });
    expect(resolved.status).toBe("resolved");

    const binding = await db!.query<{ id: string; logical_node_id: string }>(
      `
      select b.id, b.logical_node_id
      from project_parameter_bindings b
      inner join project_parameter_binding_revisions br on br.binding_id = b.id
      where b.parameter_spec_id = $1 and br.config_revision_id = $2
      `,
      [SPEC_ID, revision1.id],
    );
    expect(binding.rows).toHaveLength(1);

    const decision = await db!.query<{ decision: string; binding_id: string | null }>(
      `
      select decision, binding_id
      from dts_property_occurrence_spec_decisions
      where config_revision_id = $1 and property_key = $2
      `,
      [revision1.id, PROPERTY_KEY],
    );
    expect(decision.rows[0]).toMatchObject({
      decision: "resolved",
      binding_id: binding.rows[0]!.id,
    });

    const overrides = await listMatcherOverridesForProject(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
    });
    expect(overrides.some((row) => row.propertyKey === PROPERTY_KEY && row.decision === "resolved")).toBe(
      true,
    );

    // Idempotent duplicate resolve
    const again = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task!.id,
      decision: "resolved",
      parameterSpecId: SPEC_ID,
      reason: "repeat",
    });
    expect(again.status).toBe("resolved");

    // Conflicting choice → 409
    await expect(
      resolveSpecReviewTask(db!, makeAuth(), {
        taskId: task!.id,
        decision: "dismissed",
        reason: "conflict",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });

    // Next revision auto-reuses override (no new open review for mystery)
    const versionId2 = "fv-ghost-sra-2";
    await db!.query(
      `
      insert into project_parameter_file_versions (
        id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
      ) values ($1, $2, 2, $3, $4, $5, '{}'::jsonb, 'upload', $6)
      `,
      [
        versionId2,
        fileId,
        `${ORG_ID}/v2-ghost.dts`,
        createHash("sha256").update(UNMATCHED_DTS, "utf8").digest("hex"),
        Buffer.byteLength(UNMATCHED_DTS, "utf8"),
        USER_ID,
      ],
    );
    await db!.query(`update project_parameter_files set current_version_id = $1 where id = $2`, [
      versionId2,
      fileId,
    ]);

    const revision2 = await ingestConfigRevision(db!, manifest(versionId2, fileId), makeAuth());
    const openAfterReuse = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from parameter_spec_review_tasks
      where organization_id = $1
        and status = 'open'
        and source_evidence->>'propertyKey' = $2
        and source_evidence->>'configRevisionId' = $3
      `,
      [ORG_ID, PROPERTY_KEY, revision2.id],
    );
    expect(Number(openAfterReuse.rows[0]?.count)).toBe(0);

    const reusedBinding = await db!.query<{
      binding_id: string;
      schema_state: string | null;
      parameter_spec_id: string;
    }>(
      `
      select br.binding_id, br.schema_state, b.parameter_spec_id
      from project_parameter_binding_revisions br
      inner join project_parameter_bindings b on b.id = br.binding_id
      where br.config_revision_id = $1 and b.parameter_spec_id = $2
      `,
      [revision2.id, SPEC_ID],
    );
    expect(reusedBinding.rows).toHaveLength(1);
    expect(reusedBinding.rows[0]?.parameter_spec_id).toBe(SPEC_ID);
    expect(reusedBinding.rows[0]?.schema_state).toBe("reviewed");

    // Dismiss fail-closed on a fresh unmatched property
    const dismissDts = `/dts-v1/;

/ {
	ghost2: ghost2@1 {
		compatible = "wiseeff,ghost-device-2";
		other_mystery = <2>;
	};
};
`;
    const dismissFileId = "file-ghost-dismiss";
    const dismissVersionId = "fv-ghost-dismiss";
    await insertPinnedMember(db!, {
      fileId: dismissFileId,
      fileName: "ghost-dismiss.dts",
      versionId: dismissVersionId,
      content: dismissDts,
    });
    // Use a second config set member path via separate ingest on same set would mix files —
    // instead insert a one-off revision by temporarily using dismiss content on a new file
    // in a dedicated ingest: replace is complex; seed a second open task and dismiss it.
    const dismissTaskId = randomUUID();
    const dismissOccurrenceId = randomUUID();
    const dismissLogicalNodeId = randomUUID();
    await db!.query(
      `
      insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
      values ($1, $2, $3, $4)
      `,
      [dismissLogicalNodeId, ORG_ID, PROJECT_ID, CONFIG_SET_ID],
    );
    const dismissNodeOcc = randomUUID();
    await db!.query(
      `
      insert into dts_node_occurrences (
        id, config_revision_id, file_version_id, name, labels, node_path,
        start_offset, end_offset, start_line, start_column, end_line, end_column,
        raw_text, ast_json, source_order
      ) values ($1, $2, $3, 'ghost2', '[]'::jsonb, '/ghost2@1', 0, 1, 1, 1, 1, 2, 'n', '{}'::jsonb, 0)
      `,
      [dismissNodeOcc, revision1.id, versionId],
    );
    await db!.query(
      `
      insert into dts_property_occurrences (
        id, config_revision_id, node_occurrence_id, file_version_id, property_name,
        start_offset, end_offset, start_line, start_column, end_line, end_column,
        raw_text, ast_json, source_order
      ) values ($1, $2, $3, $4, 'other_mystery', 0, 1, 1, 1, 1, 2, '<2>', '{}'::jsonb, 0)
      `,
      [dismissOccurrenceId, revision1.id, dismissNodeOcc, versionId],
    );
    await db!.query(
      `
      insert into parameter_spec_review_tasks (
        id, organization_id, source_evidence, candidate_schemas, project_count, status
      ) values (
        $1, $2,
        $3::jsonb,
        '[]'::jsonb, 1, 'open'
      )
      `,
      [
        dismissTaskId,
        ORG_ID,
        JSON.stringify({
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          configRevisionId: revision1.id,
          propertyOccurrenceId: dismissOccurrenceId,
          logicalNodeId: dismissLogicalNodeId,
          propertyKey: "other_mystery",
          nodeLocator: "/ghost2@1",
          compatible: ["wiseeff,ghost-device-2"],
          evidence: ["unmatched"],
          matcherCandidates: [],
        }),
      ],
    );

    const dismissed = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: dismissTaskId,
      decision: "dismissed",
      reason: "Not applicable on this board",
    });
    expect(dismissed.status).toBe("dismissed");
    const bindingForDismissed = await db!.query<{ count: string }>(
      `
      select count(*)::text as count
      from dts_property_occurrence_spec_decisions
      where review_task_id = $1 and binding_id is not null
      `,
      [dismissTaskId],
    );
    expect(Number(bindingForDismissed.rows[0]?.count)).toBe(0);
    const dismissedBlockers = await countDismissedSpecBlockersForRevision(db!, {
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      configRevisionId: revision1.id,
    });
    expect(dismissedBlockers).toBeGreaterThanOrEqual(1);
  });
});
