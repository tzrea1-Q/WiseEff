/**
 * Behavior-level integration coverage for the file↔UI sync conflict repository:
 * insert/list/has-open/resolve round trip plus enrichment joins against a real
 * database. Asserts returned DTOs and subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import {
  hasOpenFileSyncConflict,
  insertFileSyncConflict,
  listOpenConflicts,
  resolveConflict
} from "./fileSyncConflictRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("file sync conflict repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [
        { id: "reviewer-1", name: "Reviewer", email: "reviewer@example.com" },
        { id: "user-sync", name: "Sync Bot", email: "sync@example.com" },
        { id: "user-ui", name: "UI Editor", email: "ui@example.com" }
      ],
      projects: [{ id: "project-1", name: "Aurora", code: "AUR" }]
    });

    // Legacy flat identity rows the conflict hangs off.
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ('pd-1', 'org-1', 'temp_max', 'max temperature', 'battery max temperature', 'ENV', 'battery', '0-120', 'C', 'High')`
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values ('ppv-1', 'org-1', 'project-1', 'pd-1', '80', '80', 1, 'reviewer-1')`
    );
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedFileWithVersion(input: { configSetId?: string } = {}) {
    await db.query(
      `insert into project_parameter_files (id, organization_id, project_id, file_name, format, config_set_id)
       values ('file-1', 'org-1', 'project-1', 'board.dts', 'dts', $1)`,
      [input.configSetId ?? null]
    );
    await db.query(
      `insert into project_parameter_file_versions (
         id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id, created_at
       ) values ('version-1', 'file-1', 3, 'org-1/files/board.dts', 'checksum-1', 100, '{}', 'upload', 'reviewer-1', '2026-07-11T09:00:00.000Z')`
    );
  }

  /** File-sync + manual draft pair — precondition rows the repository does not create. */
  async function seedDraftPair() {
    await db.query(
      `insert into parameter_drafts (
         id, organization_id, project_id, project_parameter_value_id, user_id,
         target_value, reason, origin, origin_file_version_id, updated_at
       ) values
         ('draft-file', 'org-1', 'project-1', 'ppv-1', 'user-sync', '85', 'file sync draft', 'file_sync', 'version-1', '2026-07-11T10:00:00.000Z'),
         ('draft-ui', 'org-1', 'project-1', 'ppv-1', 'user-ui', '82', 'ui draft', 'manual', null, '2026-07-11T10:01:00.000Z')`
    );
  }

  function conflictInput() {
    return {
      id: "conflict-1",
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId: "draft-file",
      uiDraftId: "draft-ui",
      fileValue: "85",
      uiDraftValue: "82"
    };
  }

  it("inserts, lists, reports, and resolves a conflict end to end", async () => {
    await seedFileWithVersion();
    await seedDraftPair();

    const inserted = await insertFileSyncConflict(db, conflictInput());
    expect(inserted).toMatchObject({
      id: "conflict-1",
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId: "draft-file",
      uiDraftId: "draft-ui",
      fileValue: "85",
      uiDraftValue: "82",
      status: "open"
    });
    expect(inserted.resolvedByUserId).toBeUndefined();
    expect(inserted.resolvedAt).toBeUndefined();

    const openConflicts = await listOpenConflicts(db, {
      organizationId: "org-1",
      projectId: "project-1"
    });
    expect(openConflicts).toHaveLength(1);
    expect(openConflicts[0]).toMatchObject({
      id: "conflict-1",
      status: "open",
      fileValue: "85",
      uiDraftValue: "82",
      // Legacy rows still enrich from the flat identity graph.
      baseValue: "80",
      parameterName: "temp_max",
      parameterModule: "battery",
      fileVersionNumber: 3,
      fileVersionLabel: "v3",
      fileId: "file-1",
      fileName: "board.dts"
    });

    await expect(hasOpenFileSyncConflict(db, { projectParameterValueId: "ppv-1" })).resolves.toBe(true);

    const resolved = await resolveConflict(db, {
      organizationId: "org-1",
      conflictId: "conflict-1",
      status: "resolved_file",
      resolvedByUserId: "reviewer-1"
    });
    expect(resolved).toMatchObject({ id: "conflict-1", status: "resolved_file", resolvedByUserId: "reviewer-1" });
    expect(resolved?.resolvedAt).toBeTruthy();

    // Resolution removes the conflict from every open-conflict read.
    await expect(listOpenConflicts(db, { organizationId: "org-1", projectId: "project-1" })).resolves.toEqual([]);
    await expect(hasOpenFileSyncConflict(db, { projectParameterValueId: "ppv-1" })).resolves.toBe(false);
    // A second resolve finds no open row and reports null instead of double-resolving.
    await expect(
      resolveConflict(db, {
        organizationId: "org-1",
        conflictId: "conflict-1",
        status: "resolved_ui",
        resolvedByUserId: "reviewer-1"
      })
    ).resolves.toBeNull();
  });

  it("resolveConflict is organization-scoped", async () => {
    await seedFileWithVersion();
    await seedDraftPair();
    await insertFileSyncConflict(db, conflictInput());

    await expect(
      resolveConflict(db, {
        organizationId: "org-other",
        conflictId: "conflict-1",
        status: "resolved_file",
        resolvedByUserId: "reviewer-1"
      })
    ).resolves.toBeNull();
    // The conflict is untouched and still open for its own organization.
    const open = await listOpenConflicts(db, { organizationId: "org-1", projectId: "project-1" });
    expect(open.map((conflict) => conflict.id)).toEqual(["conflict-1"]);
  });

  it("listOpenConflicts enriches binding-identified conflicts for the arbitration DTO", async () => {
    // Semantic identity graph: spec + property spec + binding + revision + occurrence.
    await db.query(
      `insert into parameter_specs (id, organization_id, source_kind, specification_key)
       values ('spec-1', 'org-1', 'dts', 'battery/temp_max')`
    );
    await db.query(
      `insert into parameter_spec_versions (id, parameter_spec_id, version, display_name, description, value_shape, lifecycle)
       values ('psv-1', 'spec-1', 1, 'temp_max', 'battery max temperature', '{}', 'active')`
    );
    await db.query(
      `insert into dts_property_specs (id, parameter_spec_id, property_key, schema_namespace)
       values ('dps-1', 'spec-1', 'temp_max', 'wiseeff')`
    );
    await db.query(
      `insert into dts_config_set (id, organization_id, project_id, name)
       values ('set-1', 'org-1', 'project-1', 'main')`
    );
    await seedFileWithVersion({ configSetId: "set-1" });
    await seedDraftPair();
    await db.query(
      `insert into dts_config_revisions (id, organization_id, project_id, config_set_id, revision_number, status)
       values ('rev-1', 'org-1', 'project-1', 'set-1', 1, 'resolved')`
    );
    await db.query(
      `insert into dts_logical_nodes (id, organization_id, project_id, config_set_id)
       values ('ln-1', 'org-1', 'project-1', 'set-1')`
    );
    await db.query(
      `insert into dts_logical_node_revisions (id, logical_node_id, config_revision_id, node_locator, name)
       values ('lnr-1', 'ln-1', 'rev-1', '/battery', 'battery')`
    );
    await db.query(
      `insert into parameter_modules (id, organization_id, name, path, depth)
       values ('pm-battery', 'org-1', 'battery', 'pm-battery', 1)`
    );
    await db.query(
      `insert into project_parameter_bindings (id, organization_id, project_id, logical_node_id, parameter_spec_id, module_id)
       values ('binding-1', 'org-1', 'project-1', 'ln-1', 'spec-1', 'pm-battery')`
    );
    await db.query(
      `insert into project_parameter_binding_revisions (id, binding_id, config_revision_id, parameter_spec_version_id, typed_value, raw_value)
       values ('bpr-1', 'binding-1', 'rev-1', 'psv-1', '"80"', '80')`
    );
    await db.query(
      `insert into dts_node_occurrences (
         id, config_revision_id, file_version_id, name, node_path,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ('no-1', 'rev-1', 'version-1', 'battery', '/battery', 0, 40, 1, 1, 6, 1, 'battery { temp_max = <80>; };')`
    );
    await db.query(
      `insert into dts_property_occurrences (
         id, config_revision_id, node_occurrence_id, file_version_id, property_name,
         start_offset, end_offset, start_line, start_column, end_line, end_column, raw_text
       ) values ('po-1', 'rev-1', 'no-1', 'version-1', 'temp_max', 10, 20, 4, 2, 4, 12, 'temp_max = <80>;')`
    );
    await db.query(
      `insert into dts_occurrence_effects (
         id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
         node_occurrence_id, property_occurrence_id, source_order
       ) values ('oe-1', 'rev-1', 'lnr-1', 'temp_max', 'set', 'no-1', 'po-1', 1)`
    );

    await insertFileSyncConflict(db, {
      ...conflictInput(),
      parameterSpecId: "spec-1",
      projectParameterBindingId: "binding-1"
    });

    // Post-cutover callers filter by binding id under the legacy parameter name.
    const byBinding = await listOpenConflicts(db, {
      organizationId: "org-1",
      projectParameterValueId: "binding-1"
    });
    expect(byBinding.map((conflict) => conflict.id)).toEqual(["conflict-1"]);

    const [conflict] = await listOpenConflicts(db, {
      organizationId: "org-1",
      projectId: "project-1"
    });
    expect(conflict).toMatchObject({
      id: "conflict-1",
      // Binding/spec ids occupy the legacy DTO field names after cutover.
      projectParameterValueId: "binding-1",
      parameterDefinitionId: "spec-1",
      baseValue: "80",
      parameterName: "temp_max",
      parameterModule: "battery",
      fileVersionNumber: 3,
      fileVersionLabel: "v3",
      fileVersionCreatedAt: "2026-07-11T09:00:00.000Z",
      fileDraftUpdatedAt: "2026-07-11T10:00:00.000Z",
      uiDraftUpdatedAt: "2026-07-11T10:01:00.000Z",
      fileId: "file-1",
      fileName: "board.dts",
      configSetId: "set-1",
      sourceNodePath: "battery/temp_max",
      nodePath: "battery",
      propertyName: "temp_max",
      source: {
        startOffset: 10,
        endOffset: 20,
        startLine: 4,
        startColumn: 2,
        endLine: 4,
        endColumn: 12
      }
    });
  });
});
