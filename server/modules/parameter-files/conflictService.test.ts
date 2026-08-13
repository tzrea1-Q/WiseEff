import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { ApiError } from "../../shared/http/errors";
import { makeTestAuthContext } from "../../testing/authContext";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { resolveConflict } from "../parameters/fileSyncConflictRepository";
import { insertFileVersion, insertProjectParameterFile } from "./repository";
import {
  detectFileUiDraftConflict,
  previewBulkConflictResolution,
  resolveConflictsBulk,
  resolveParameterFileConflict
} from "./conflictService";

const databaseAvailable = await isTestDatabaseAvailable();

function reviewerAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "reviewer-1",
    organizationId: "org-1",
    name: "Reviewer",
    email: "reviewer@example.com",
    title: "Reviewer",
    organizationName: "ChargeLab",
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["parameter:view", "parameter:review"]
  });
}

describe.skipIf(!databaseAvailable)("parameter file conflict service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "reviewer-1", name: "Reviewer", email: "reviewer@example.com" },
        { id: "user-sync", name: "Sync Bot", email: "sync@example.com" },
        { id: "user-ui", name: "UI Editor", email: "ui@example.com" },
        { id: "user-same", name: "Agreeing Editor", email: "same@example.com" }
      ],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });

    // Legacy flat identity graph: definitions + project values the conflicts hang off.
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values
         ('pd-1', 'org-1', 'temp_max', 'max temperature', 'battery max temperature', 'ENV', 'battery', '0-120', 'C', 'High'),
         ('pd-2', 'org-1', 'temp_min', 'min temperature', 'battery min temperature', 'ENV', 'battery', '0-120', 'C', 'High'),
         ('pd-other', 'org-1', 'other', 'other project parameter', 'other', 'ENV', 'battery', '0-120', 'C', 'High')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values
         ('ppv-1', 'org-1', 'project-1', 'pd-1', '80', '80', 1, 'reviewer-1'),
         ('ppv-2', 'org-1', 'project-1', 'pd-2', '10', '10', 1, 'reviewer-1'),
         ('ppv-other', 'org-1', 'project-2', 'pd-other', '1', '1', 1, 'reviewer-1')`
    );

    await insertProjectParameterFile(db, {
      id: "file-1",
      organizationId: "org-1",
      projectId: "project-1",
      fileName: "board-a.dts",
      format: "dts"
    });
    await insertFileVersion(db, {
      id: "version-1",
      fileId: "file-1",
      versionNumber: 1,
      storageKey: "org-1/files/board-a.dts",
      checksum: "checksum-1",
      sizeBytes: 100,
      parsedIndex: {},
      origin: "upload",
      createdByUserId: "reviewer-1"
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  /**
   * Preconditions the conflict detector expects: a file_sync draft plus a manual
   * (UI) draft by a different user. Drafts are precondition rows the conflict
   * service does not create itself, so they are inserted directly.
   */
  async function seedDraftPair(input: {
    ppvId: string;
    projectId?: string;
    fileValue: string;
    uiValue: string;
    suffix: string;
  }) {
    const projectId = input.projectId ?? "project-1";
    const fileDraftId = `draft-file-${input.suffix}`;
    const uiDraftId = `draft-ui-${input.suffix}`;
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id
       ) values
         ($1, 'org-1', $3, $4, 'user-sync', $5, 'file sync draft', 'file_sync', 'version-1'),
         ($2, 'org-1', $3, $4, 'user-ui', $6, 'ui draft', 'manual', null)`,
      [fileDraftId, uiDraftId, projectId, input.ppvId, input.fileValue, input.uiValue]
    );
    return { fileDraftId, uiDraftId };
  }

  async function detectConflict(input: {
    ppvId: string;
    pdId: string;
    projectId?: string;
    fileValue: string;
    uiValue: string;
    suffix: string;
  }) {
    const { fileDraftId, uiDraftId } = await seedDraftPair(input);
    const created = await detectFileUiDraftConflict(db, {
      organizationId: "org-1",
      projectId: input.projectId ?? "project-1",
      projectParameterValueId: input.ppvId,
      parameterDefinitionId: input.pdId,
      fileVersionId: "version-1",
      fileDraftId,
      fileValue: input.fileValue
    });
    expect(created).toHaveLength(1);
    return { conflict: created[0], fileDraftId, uiDraftId };
  }

  async function draftIds(ppvId: string): Promise<string[]> {
    const result = await db.query<{ id: string }>(
      "select id from parameter_drafts where organization_id = 'org-1' and project_parameter_value_id = $1",
      [ppvId]
    );
    return result.rows.map((row) => row.id).sort();
  }

  async function conflictRows(ppvId: string) {
    const result = await db.query<{
      id: string;
      status: string;
      file_value: string;
      ui_draft_value: string;
      file_draft_id: string;
      ui_draft_id: string;
      parameter_spec_id: string | null;
      project_parameter_binding_id: string | null;
      resolved_by_user_id: string | null;
    }>(
      `select id, status, file_value, ui_draft_value, file_draft_id, ui_draft_id,
              parameter_spec_id, project_parameter_binding_id, resolved_by_user_id
       from parameter_file_sync_conflicts
       where organization_id = 'org-1' and project_parameter_value_id = $1`,
      [ppvId]
    );
    return result.rows;
  }

  it("file_sync + manual with different value creates conflict", async () => {
    const { fileDraftId, uiDraftId } = await seedDraftPair({
      ppvId: "ppv-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "detect"
    });
    // A manual draft that agrees with the file value must not produce a conflict.
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id
       ) values ('draft-agree', 'org-1', 'project-1', 'ppv-1', 'user-same', '85', 'agrees with file', 'manual', null)`
    );

    const created = await detectFileUiDraftConflict(db, {
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId,
      fileValue: "85"
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId,
      uiDraftId,
      fileValue: "85",
      uiDraftValue: "82",
      status: "open"
    });

    const stored = await conflictRows("ppv-1");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      status: "open",
      file_value: "85",
      ui_draft_value: "82",
      file_draft_id: fileDraftId,
      ui_draft_id: uiDraftId,
      parameter_spec_id: null,
      project_parameter_binding_id: null
    });
  });

  it("resolve file keeps file draft and deletes ui draft", async () => {
    const { conflict, fileDraftId, uiDraftId } = await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "resolve"
    });

    const resolved = await resolveParameterFileConflict(db, reviewerAuth(), {
      conflictId: conflict.id,
      resolution: "file"
    });

    expect(resolved.status).toBe("resolved_file");
    expect(resolved.resolvedByUserId).toBe("reviewer-1");
    // The file draft survives; the losing UI draft is gone.
    expect(await draftIds("ppv-1")).toEqual([fileDraftId]);
    // Draft FKs cascade-delete the conflict row, which is exactly why the service
    // must resolve before deleting: resolving after the delete would find nothing.
    expect(await conflictRows("ppv-1")).toHaveLength(0);
    expect(uiDraftId).toBe(`draft-ui-resolve`);

    const audits = await db.query<{ target_id: string; metadata: Record<string, unknown> }>(
      `select target_id, metadata from audit_events
       where organization_id = 'org-1' and kind = 'parameter-file-conflict-resolve'`
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0].target_id).toBe(conflict.id);
    expect(audits.rows[0].metadata).toMatchObject({ resolution: "file", fileDraftId, uiDraftId });
  });

  it("requires parameter review permission when resolving conflict", async () => {
    await expect(
      resolveParameterFileConflict(
        db,
        {
          ...reviewerAuth(),
          permissions: ["parameter:view"]
        },
        { conflictId: "conflict-1", resolution: "ui" }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter review permission is required.", 403));
  });

  it("puts trimmed resolve reason into audit metadata and omits blank reason", async () => {
    const withReason = await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "reason"
    });
    const blankReason = await detectConflict({
      ppvId: "ppv-2",
      pdId: "pd-2",
      fileValue: "12",
      uiValue: "8",
      suffix: "blank"
    });

    await resolveParameterFileConflict(db, reviewerAuth(), {
      conflictId: withReason.conflict.id,
      resolution: "file",
      reason: "  keep file after review  "
    });
    await resolveParameterFileConflict(db, reviewerAuth(), {
      conflictId: blankReason.conflict.id,
      resolution: "file",
      reason: "   "
    });

    const audits = await db.query<{ target_id: string; metadata: Record<string, unknown> }>(
      `select target_id, metadata from audit_events
       where organization_id = 'org-1' and kind = 'parameter-file-conflict-resolve'`
    );
    const trimmed = audits.rows.find((row) => row.target_id === withReason.conflict.id);
    const blank = audits.rows.find((row) => row.target_id === blankReason.conflict.id);
    expect(trimmed?.metadata).toMatchObject({ resolution: "file", reason: "keep file after review" });
    expect(blank?.metadata).not.toHaveProperty("reason");
  });

  it("previewBulkConflictResolution classifies eligible and ineligible conflicts", async () => {
    const open = await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "open"
    });
    const resolvedConflict = await detectConflict({
      ppvId: "ppv-2",
      pdId: "pd-2",
      fileValue: "12",
      uiValue: "8",
      suffix: "resolved"
    });
    // Flip to resolved via the repository so the row survives for classification
    // (the service-level resolve deletes the losing draft and cascades the row away).
    await resolveConflict(db, {
      organizationId: "org-1",
      conflictId: resolvedConflict.conflict.id,
      status: "resolved_file",
      resolvedByUserId: "reviewer-1"
    });
    const otherProject = await detectConflict({
      ppvId: "ppv-other",
      pdId: "pd-other",
      projectId: "project-2",
      fileValue: "5",
      uiValue: "6",
      suffix: "other"
    });

    const preview = await previewBulkConflictResolution(db, reviewerAuth(), {
      projectId: "project-1",
      resolution: "file",
      conflictIds: [open.conflict.id, resolvedConflict.conflict.id, otherProject.conflict.id, "conflict-missing"]
    });

    expect(preview.resolution).toBe("file");
    expect(preview.eligible).toHaveLength(1);
    expect(preview.eligible[0]?.id).toBe(open.conflict.id);
    expect(preview.ineligible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "already_resolved" }),
        expect.objectContaining({ reason: "wrong_project" }),
        expect.objectContaining({ reason: "not_found" })
      ])
    );
    expect(preview.ineligible).toHaveLength(3);
    expect(preview.impact).toEqual({
      eligibleCount: 1,
      ineligibleCount: 3,
      parameterNames: ["temp_max"],
      fileIds: ["file-1"]
    });
  });

  it("previewBulkConflictResolution without conflictIds previews all open project conflicts", async () => {
    await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "a"
    });
    await detectConflict({
      ppvId: "ppv-2",
      pdId: "pd-2",
      fileValue: "10",
      uiValue: "11",
      suffix: "b"
    });

    const preview = await previewBulkConflictResolution(db, reviewerAuth(), {
      projectId: "project-1",
      resolution: "ui"
    });

    expect(preview.eligible).toHaveLength(2);
    expect(preview.ineligible).toEqual([]);
    expect(preview.impact.eligibleCount).toBe(2);
    expect(preview.impact.parameterNames.sort()).toEqual(["temp_max", "temp_min"]);
  });

  it("resolveConflictsBulk resolves eligible conflicts and skips ineligible ones", async () => {
    const open = await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "bulk"
    });

    const result = await resolveConflictsBulk(db, reviewerAuth(), {
      projectId: "project-1",
      resolution: "file",
      conflictIds: [open.conflict.id, "conflict-missing"],
      reason: "bulk keep file"
    });

    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.id).toBe(open.conflict.id);
    expect(result.resolved[0]?.status).toBe("resolved_file");
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: "not_found" })
    ]);
    // The losing UI draft is gone; only the winning file draft remains.
    expect(await draftIds("ppv-1")).toEqual([open.fileDraftId]);
  });

  it("rolls the whole batch back when a mid-batch resolution fails (atomic bulk, ADR-0027)", async () => {
    const open = await detectConflict({
      ppvId: "ppv-1",
      pdId: "pd-1",
      fileValue: "85",
      uiValue: "82",
      suffix: "atomic"
    });

    // The same id twice: preview does not deduplicate, so both entries are eligible.
    // The first resolution succeeds inside the batch transaction; the second finds the
    // conflict no longer open and throws — the whole batch must roll back.
    await expect(
      resolveConflictsBulk(db, reviewerAuth(), {
        projectId: "project-1",
        resolution: "file",
        conflictIds: [open.conflict.id, open.conflict.id]
      })
    ).rejects.toBeInstanceOf(ApiError);

    const row = await db.query<{ status: string }>(
      `select status from parameter_file_sync_conflicts where id = $1`,
      [open.conflict.id]
    );
    expect(row.rows[0]?.status).toBe("open");
    // Both drafts survive: the first (rolled-back) resolution deleted nothing durably.
    expect(await draftIds("ppv-1")).toEqual([open.fileDraftId, open.uiDraftId].sort());
  });
});
