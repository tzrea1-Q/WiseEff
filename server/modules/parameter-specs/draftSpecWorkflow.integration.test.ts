/**
 * P1-3: manual spec draft → activate → resolve workflow.
 */
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { InMemoryTestDatabase } from "../../testing/testDatabase";
import { createInMemoryTestDatabase, isTestDatabaseAvailable } from "../../testing/testDatabase";
import { ApiError } from "../../shared/http/errors";
import { ingestConfigRevision } from "../parameter-topology/ingestService";
import type { ConfigRevisionManifest } from "../parameter-topology/types";
import { buildManualSpecIds } from "./specIdentity";
import { activateParameterSpec, resolveSpecReviewTask } from "./service";

const ORG_ID = "org-draft-spec-flow";
const PROJECT_ID = "project-draft-spec-flow";
const USER_ID = "user-draft-spec-flow";
const CONFIG_SET_ID = "dcs-draft-spec-flow";

const databaseAvailable = await isTestDatabaseAvailable();

function makeAuth(): AuthContext {
  return {
    user: {
      id: USER_ID,
      organizationId: ORG_ID,
      name: "Draft Spec Admin",
      email: "draft-spec@example.com",
      title: "Admin",
      isActive: true,
    },
    organization: { id: ORG_ID, name: "Draft Spec Org" },
    roles: [{ projectId: null, roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "parameter:review", "admin:access"],
  };
}

function dtsForProperty(propertyKey: string, rawValue: string) {
  return `/dts-v1/;

/ {
	ghost: ghost@0 {
		compatible = "wiseeff,ghost-device";
		${propertyKey} = ${rawValue};
	};
};
`;
}

async function seedGraph(db: InMemoryTestDatabase) {
  await db.query(`insert into organizations (id, name) values ($1, 'Draft Spec Org')`, [ORG_ID]);
  await db.query(
    `insert into users (id, organization_id, name, email, title, is_active)
     values ($1, $2, 'Draft Spec Admin', 'draft-spec@example.com', 'Admin', true)`,
    [USER_ID, ORG_ID],
  );
  await db.query(
    `insert into projects (id, organization_id, name, code, status)
     values ($1, $2, 'Draft Spec', 'DSF', 'initialized')`,
    [PROJECT_ID, ORG_ID],
  );
  await db.query(
    `insert into dts_config_set (id, organization_id, project_id, name, description)
     values ($1, $2, $3, 'draft-set', 'draft spec workflow')`,
    [CONFIG_SET_ID, ORG_ID, PROJECT_ID],
  );
}

async function insertPinnedMember(
  db: InMemoryTestDatabase,
  input: { fileId: string; fileName: string; versionId: string; content: string },
) {
  const checksum = createHash("sha256").update(input.content, "utf8").digest("hex");
  await db.query(
    `insert into project_parameter_files (
      id, organization_id, project_id, file_name, format, enabled,
      config_set_id, config_set_role, config_set_sort_order
    ) values ($1, $2, $3, $4, 'dts', true, $5, 'base', 0)`,
    [input.fileId, ORG_ID, PROJECT_ID, input.fileName, CONFIG_SET_ID],
  );
  await db.query(
    `insert into project_parameter_file_versions (
      id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
    ) values ($1, $2, 1, $3, $4, $5, '{}'::jsonb, 'upload', $6)`,
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

function manifest(versionId: string, fileId: string, content: string): ConfigRevisionManifest {
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
        content,
      },
    ],
  };
}

async function ingestAndFindTask(
  db: InMemoryTestDatabase,
  propertyKey: string,
  rawValue: string,
) {
  const fileId = `file-${propertyKey}`;
  const versionId = `fv-${propertyKey}`;
  const content = dtsForProperty(propertyKey, rawValue);
  await insertPinnedMember(db, { fileId, fileName: `${propertyKey}.dts`, versionId, content });
  const revision = await ingestConfigRevision(db, manifest(versionId, fileId, content), makeAuth());
  const tasks = await db.query<{ id: string; status: string; source_evidence: Record<string, unknown> }>(
    `select id, status, source_evidence from parameter_spec_review_tasks where organization_id = $1 and status = 'open'`,
    [ORG_ID],
  );
  const task = tasks.rows.find((row) => row.source_evidence.propertyKey === propertyKey);
  expect(task).toBeTruthy();
  return { revision, task: task! };
}

describe.skipIf(!databaseAvailable)("draft spec workflow integration", () => {
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

  it("createSpec leaves task open, creates draft with inferred shape, and writes audit", async () => {
    const { task } = await ingestAndFindTask(db!, "cell_prop", "<1>");
    const ids = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "cell_prop", driverModule: null });

    const created = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task.id,
      decision: "resolved",
      createSpec: true,
      reason: "Create draft from cells occurrence",
    });
    expect(created).toMatchObject({
      status: "open",
      draftCreated: true,
      parameterSpecId: ids.parameterSpecId,
    });

    const stillOpen = await db!.query<{ status: string }>(
      `select status from parameter_spec_review_tasks where id = $1`,
      [task.id],
    );
    expect(stillOpen.rows[0]?.status).toBe("open");

    const specVersion = await db!.query<{ lifecycle: string; value_shape: Record<string, unknown> }>(
      `select lifecycle, value_shape from parameter_spec_versions where parameter_spec_id = $1`,
      [ids.parameterSpecId],
    );
    expect(specVersion.rows[0]).toMatchObject({
      lifecycle: "draft",
      value_shape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
    });

    const bindings = await db!.query<{ count: string }>(
      `select count(*)::text as count from project_parameter_bindings where parameter_spec_id = $1`,
      [ids.parameterSpecId],
    );
    expect(Number(bindings.rows[0]?.count)).toBe(0);

    const audit = await db!.query<{ action: string }>(
      `select action from audit_events where kind = 'parameter-topology-governance' and target_id = $1`,
      [ids.parameterSpecId],
    );
    expect(audit.rows.some((row) => row.action === "spec-draft-created")).toBe(true);
  });

  it("persists vendor,limit and vendor-limit as two distinct org manual specs", async () => {
    const comma = await ingestAndFindTask(db!, "vendor,limit", "<1>");
    const hyphen = await ingestAndFindTask(db!, "vendor-limit", "<2>");

    const commaDraft = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: comma.task.id,
      decision: "resolved",
      createSpec: true,
      reason: "Create comma-key draft",
    });
    const hyphenDraft = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: hyphen.task.id,
      decision: "resolved",
      createSpec: true,
      reason: "Create hyphen-key draft",
    });

    expect(commaDraft.parameterSpecId).not.toBe(hyphenDraft.parameterSpecId);
    const persisted = await db!.query<{ id: string; specification_key: string; property_key: string }>(
      `
      select ps.id, ps.specification_key, dps.property_key
      from parameter_specs ps
      inner join dts_property_specs dps on dps.parameter_spec_id = ps.id
      where ps.organization_id = $1
        and dps.property_key = any($2::text[])
      order by dps.property_key
      `,
      [ORG_ID, ["vendor,limit", "vendor-limit"]],
    );
    expect(persisted.rows).toHaveLength(2);
    expect(new Set(persisted.rows.map((row) => row.specification_key)).size).toBe(2);
  });

  it("rejects resolve/release with draft spec and activates before binding", async () => {
    const { task, revision } = await ingestAndFindTask(db!, "gpio_int", "<2>");
    const ids = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "gpio_int", driverModule: null });

    const draft = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task.id,
      decision: "resolved",
      createSpec: true,
      reason: "Draft first",
    });
    expect(draft.status).toBe("open");

    await expect(
      resolveSpecReviewTask(db!, makeAuth(), {
        taskId: task.id,
        decision: "resolved",
        parameterSpecId: ids.parameterSpecId,
        reason: "Try resolve while draft",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 } satisfies Partial<ApiError>);

    await activateParameterSpec(db!, makeAuth(), {
      specId: ids.parameterSpecId,
      valueShape: { kind: "cells", bits: 32, groups: 1, cellsPerGroup: 1 },
      constraints: { cells: 1 },
      documentation: "GPIO interrupt cells property",
      reason: "Reviewed and activated",
    });

    const resolved = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task.id,
      decision: "resolved",
      parameterSpecId: ids.parameterSpecId,
      reason: "Resolve after activation",
    });
    expect(resolved.status).toBe("resolved");

    const binding = await db!.query<{ id: string }>(
      `
      select b.id
      from project_parameter_bindings b
      inner join project_parameter_binding_revisions br on br.binding_id = b.id
      where b.parameter_spec_id = $1 and br.config_revision_id = $2
      `,
      [ids.parameterSpecId, revision.id],
    );
    expect(binding.rows).toHaveLength(1);

    const activateAudit = await db!.query<{ action: string }>(
      `select action from audit_events where target_id in ($1, $2)`,
      [ids.parameterSpecId, task.id],
    );
    expect(activateAudit.rows.some((row) => row.action === "spec-activated")).toBe(true);
    expect(activateAudit.rows.some((row) => row.action === "spec-review-resolved")).toBe(true);
  });

  it("infers string-list and boolean shapes; unknown cannot activate", async () => {
    const stringList = await ingestAndFindTask(db!, "compat_list", '"a", "b"');
    const stringIds = buildManualSpecIds({
      organizationId: ORG_ID,
      propertyKey: "compat_list",
      driverModule: null,
    });
    await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: stringList.task.id,
      decision: "resolved",
      createSpec: true,
      reason: "string-list draft",
    });
    const stringShape = await db!.query<{ value_shape: Record<string, unknown> }>(
      `select value_shape from parameter_spec_versions where parameter_spec_id = $1`,
      [stringIds.parameterSpecId],
    );
    expect(stringShape.rows[0]?.value_shape).toEqual({ kind: "string-list" });

    const boolTask = await ingestAndFindTask(db!, "feature_on", "");
    const boolIds = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "feature_on", driverModule: null });
    await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: boolTask.task.id,
      decision: "resolved",
      createSpec: true,
      reason: "boolean draft",
    });
    const boolShape = await db!.query<{ value_shape: Record<string, unknown> }>(
      `select value_shape from parameter_spec_versions where parameter_spec_id = $1`,
      [boolIds.parameterSpecId],
    );
    expect(boolShape.rows[0]?.value_shape).toEqual({ kind: "bool" });

    const broken = await ingestAndFindTask(db!, "broken_shape", "<9>");
    await db!.query(
      `update dts_property_occurrences set raw_text = '???', ast_json = '{}'::jsonb where id = $1`,
      [broken.task.source_evidence.propertyOccurrenceId],
    );
    const unknownIds = buildManualSpecIds({
      organizationId: ORG_ID,
      propertyKey: "broken_shape",
      driverModule: null,
    });
    await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: broken.task.id,
      decision: "resolved",
      createSpec: true,
      reason: "unknown draft",
    });
    const unknownShape = await db!.query<{ value_shape: Record<string, unknown> }>(
      `select value_shape from parameter_spec_versions where parameter_spec_id = $1`,
      [unknownIds.parameterSpecId],
    );
    expect(unknownShape.rows[0]?.value_shape).toEqual({ kind: "unknown" });
    await expect(
      activateParameterSpec(db!, makeAuth(), {
        specId: unknownIds.parameterSpecId,
        valueShape: { kind: "unknown" },
        constraints: {},
        documentation: "still unknown",
        reason: "should fail",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED", status: 400 } satisfies Partial<ApiError>);
  });

  it("idempotent createSpec and special-character IDs do not collide", async () => {
    const colon = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "foo:bar", driverModule: null });
    const slash = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "foo/bar", driverModule: null });
    expect(colon.parameterSpecId).not.toBe(slash.parameterSpecId);

    const comma = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "vendor,limit", driverModule: null });
    const hyphen = buildManualSpecIds({ organizationId: ORG_ID, propertyKey: "vendor-limit", driverModule: null });
    expect(comma.parameterSpecId).not.toBe(hyphen.parameterSpecId);

    const { task } = await ingestAndFindTask(db!, "idempotent_prop", "<3>");
    const first = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task.id,
      decision: "resolved",
      createSpec: true,
      reason: "first",
    });
    const second = await resolveSpecReviewTask(db!, makeAuth(), {
      taskId: task.id,
      decision: "resolved",
      createSpec: true,
      reason: "second",
    });
    expect(first.parameterSpecId).toBe(second.parameterSpecId);
    expect(second.status).toBe("open");

    const versions = await db!.query<{ count: string }>(
      `select count(*)::text as count from parameter_spec_versions where parameter_spec_id = $1`,
      [first.parameterSpecId],
    );
    expect(Number(versions.rows[0]?.count)).toBe(1);
  });
});
