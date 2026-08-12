import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  hasOpenFileSyncConflict,
  insertFileSyncConflict,
  listOpenConflicts,
  resolveConflict
} from "./fileSyncConflictRepository";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = Record<string, unknown> | unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(rowsOrQueue: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const queueMode = rowsOrQueue.some((item) => typeof item === "function" || Array.isArray(item));
  const db: Queryable = {
    query: async <Row,>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
      const call = { text, values };
      // Cutover probes must not consume the test SQL queue.
      if (text.includes("parameter_identity_cutovers")) {
        return { rows: [{ c: "0" } as Row], rowCount: 1 };
      }
      if (text.includes("information_schema.tables") && text.includes("parameter_definitions")) {
        return { rows: [{ c: "1" } as Row], rowCount: 1 };
      }
      calls.push(call);
      if (queueMode) {
        const next = rowsOrQueue.shift() ?? [];
        const rows = typeof next === "function" ? next(call) : Array.isArray(next) ? next : [next];
        return { rows: rows as Row[], rowCount: rows.length };
      }

      const rows = rowsOrQueue as unknown[];
      return { rows: rows as Row[], rowCount: rows.length };
    }
  };

  return { db, calls };
}

describe("file sync conflict repository", () => {
  it("handles file sync conflict repository CRUD", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "conflict-1",
          organization_id: "org-chargelab",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          file_version_id: "version-1",
          file_draft_id: "draft-file",
          ui_draft_id: "draft-ui",
          file_value: "85",
          ui_draft_value: "82",
          status: "open",
          resolved_by_user_id: null,
          resolved_at: null,
          created_at: "2026-07-11T10:02:00.000Z"
        }
      ],
      [
        {
          id: "conflict-1",
          organization_id: "org-chargelab",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          file_version_id: "version-1",
          file_draft_id: "draft-file",
          ui_draft_id: "draft-ui",
          file_value: "85",
          ui_draft_value: "82",
          status: "open",
          resolved_by_user_id: null,
          resolved_at: null,
          created_at: "2026-07-11T10:02:00.000Z"
        }
      ],
      [{ id: "conflict-1" }],
      [
        {
          id: "conflict-1",
          organization_id: "org-chargelab",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          file_version_id: "version-1",
          file_draft_id: "draft-file",
          ui_draft_id: "draft-ui",
          file_value: "85",
          ui_draft_value: "82",
          status: "resolved_file",
          resolved_by_user_id: "reviewer-1",
          resolved_at: "2026-07-11T10:03:00.000Z",
          created_at: "2026-07-11T10:02:00.000Z"
        }
      ]
    ]);

    const inserted = await insertFileSyncConflict(db, {
      id: "conflict-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      projectParameterValueId: "param-1",
      parameterDefinitionId: "definition-1",
      fileVersionId: "version-1",
      fileDraftId: "draft-file",
      uiDraftId: "draft-ui",
      fileValue: "85",
      uiDraftValue: "82"
    });
    const openConflicts = await listOpenConflicts(db, {
      organizationId: "org-chargelab",
      projectParameterValueId: "param-1"
    });
    const hasOpen = await hasOpenFileSyncConflict(db, {
      projectParameterValueId: "param-1"
    });
    const resolved = await resolveConflict(db, {
      organizationId: "org-chargelab",
      conflictId: "conflict-1",
      status: "resolved_file",
      resolvedByUserId: "reviewer-1"
    });

    expect(calls[0].text).toContain("insert into parameter_file_sync_conflicts");
    expect(calls[1].text).toContain("parameter_file_sync_conflicts");
    expect(calls[1].text).toContain("status = 'open'");
    expect(calls[1].text).toContain("project_parameter_bindings");
    expect(calls[1].text).toContain("project_parameter_values");
    expect(calls[1].text).toContain("parameter_definitions");
    expect(calls[1].text).toContain("project_parameter_file_versions");
    expect(calls[2].text).toContain("status = 'open'");
    expect(calls[3].text).toContain("update parameter_file_sync_conflicts");
    expect(inserted.status).toBe("open");
    expect(openConflicts).toHaveLength(1);
    expect(hasOpen).toBe(true);
    expect(resolved?.status).toBe("resolved_file");
  });

  it("listOpenConflicts maps enrichment joins for arbitration DTO", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "conflict-1",
          organization_id: "org-chargelab",
          project_id: "project-1",
          project_parameter_value_id: "binding-1",
          parameter_definition_id: "spec-1",
          project_parameter_binding_id: "binding-1",
          parameter_spec_id: "spec-1",
          file_version_id: "version-1",
          file_draft_id: "draft-file",
          ui_draft_id: "draft-ui",
          file_value: "85",
          ui_draft_value: "82",
          status: "open",
          resolved_by_user_id: null,
          resolved_at: null,
          created_at: "2026-07-11T10:02:00.000Z",
          base_value: "80",
          parameter_name: "temp_max",
          parameter_module: "battery",
          file_version_number: 3,
          file_version_created_at: "2026-07-11T09:00:00.000Z",
          file_draft_updated_at: "2026-07-11T10:00:00.000Z",
          ui_draft_updated_at: "2026-07-11T10:01:00.000Z",
          file_id: "file-1",
          file_name: "board.dts",
          config_set_id: "set-1",
          source_node_path: "battery/temp_max",
          source_start_offset: 10,
          source_end_offset: 20,
          source_start_line: 4,
          source_start_column: 2,
          source_end_line: 4,
          source_end_column: 12
        }
      ]
    ]);

    const [conflict] = await listOpenConflicts(db, {
      organizationId: "org-chargelab",
      projectId: "project-1"
    });

    expect(calls[0].text).toContain("left join project_parameter_bindings");
    expect(calls[0].text).toContain("dts_property_occurrences");
    expect(calls[0].text).toContain("project_parameter_values");
    expect(calls[0].text).toContain("parameter_definitions");
    expect(conflict).toMatchObject({
      id: "conflict-1",
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
