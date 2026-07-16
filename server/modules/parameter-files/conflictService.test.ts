import { describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { detectFileUiDraftConflict, resolveParameterFileConflict } from "./conflictService";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    target.push(call);
    const next = results.shift() ?? [];
    const rows = typeof next === "function" ? next(call) : next;
    return { rows: rows as Row[], rowCount: rows.length };
  };

  const tx: Queryable = {
    query: (text, values = []) => runQuery(txCalls, text, values)
  };
  const db: Database = {
    query: (text, values = []) => runQuery(calls, text, values),
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => fn(tx)
  };

  return { db, calls, txCalls };
}

function reviewerAuth(): AuthContext {
  return {
    user: {
      id: "reviewer-1",
      organizationId: "org-1",
      name: "Reviewer",
      email: "reviewer@example.com",
      title: "Reviewer",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
    permissions: ["parameter:view", "parameter:review"]
  };
}

describe("parameter file conflict service", () => {
  it("file_sync + manual with different value creates conflict", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "draft-file",
          user_id: "user-sync",
          project_id: "project-1",
          project_parameter_value_id: "ppv-1",
          target_value: "85",
          origin: "file_sync",
          origin_file_version_id: "version-1",
          updated_at: "2026-07-11T10:00:00.000Z"
        },
        {
          id: "draft-ui",
          user_id: "user-ui",
          project_id: "project-1",
          project_parameter_value_id: "ppv-1",
          target_value: "82",
          origin: "manual",
          origin_file_version_id: null,
          updated_at: "2026-07-11T10:01:00.000Z"
        }
      ],
      [],
      [
        {
          id: "conflict-1",
          organization_id: "org-1",
          project_id: "project-1",
          project_parameter_value_id: "ppv-1",
          parameter_definition_id: "pd-1",
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
      ]
    ]);

    const created = await detectFileUiDraftConflict(db, {
      organizationId: "org-1",
      projectId: "project-1",
      projectParameterValueId: "ppv-1",
      parameterDefinitionId: "pd-1",
      fileVersionId: "version-1",
      fileDraftId: "draft-file",
      fileValue: "85"
    });

    expect(created).toHaveLength(1);
    const insertCall = calls.find((call) => call.text.includes("insert into parameter_file_sync_conflicts"));
    expect(insertCall?.values).toEqual([
      expect.any(String),
      "org-1",
      "project-1",
      "ppv-1",
      "pd-1",
      "version-1",
      "draft-file",
      "draft-ui",
      "85",
      "82",
      null,
      null
    ]);
  });

  it("resolve file keeps file draft and deletes ui draft", async () => {
    const { db, txCalls } = createFakeDb([
      [
        {
          id: "conflict-1",
          organization_id: "org-1",
          project_id: "project-1",
          project_parameter_value_id: "ppv-1",
          parameter_definition_id: "pd-1",
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
      [],
      [
        {
          id: "conflict-1",
          organization_id: "org-1",
          project_id: "project-1",
          project_parameter_value_id: "ppv-1",
          parameter_definition_id: "pd-1",
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
      ],
      []
    ]);

    const resolved = await resolveParameterFileConflict(db, reviewerAuth(), {
      conflictId: "conflict-1",
      resolution: "file"
    });

    expect(resolved.status).toBe("resolved_file");
    expect(txCalls.some((call) => call.text.includes("delete from parameter_drafts") && call.values[1] === "draft-ui")).toBe(
      true
    );
    expect(txCalls.some((call) => call.text.includes("delete from parameter_drafts") && call.values[1] === "draft-file")).toBe(
      false
    );
    const resolveCall = txCalls.find((call) => call.text.includes("update parameter_file_sync_conflicts"));
    expect(resolveCall?.values).toEqual(["org-1", "conflict-1", "resolved_file", "reviewer-1"]);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("requires parameter review permission when resolving conflict", async () => {
    const { db } = createFakeDb();

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
});
