import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  deleteDraft,
  listDraftsForParameterValue,
  listDraftsForUser,
  listOpenBindingDraftsForUser,
  rebaseOpenBindingDraftCandidates,
  upsertDraft
} from "./draftRepository";

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

describe("draft repository", () => {
  it("upsertDraft inserts or updates a user draft within an organization", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "draft-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          target_value: "3100",
          reason: "Reduce thermal risk.",
          updated_at: "2026-05-25T04:00:00.000Z"
        }
      ]
    ]);

    const draft = await upsertDraft(db, {
      id: "draft-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      parameterId: "param-1",
      userId: "user-1",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });

    expect(calls[0].text).toContain("insert into parameter_drafts");
    expect(calls[0].text).toContain("on conflict (project_id, project_parameter_value_id, user_id)");
    expect(calls[0].values).toEqual([
      "draft-1",
      "org-chargelab",
      "project-1",
      "param-1",
      "user-1",
      "3100",
      "Reduce thermal risk.",
      "manual",
      null,
      "set",
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null
    ]);
    expect(draft).toMatchObject({ id: "draft-1", parameterId: "param-1", targetValue: "3100" });
  });

  it("listDraftsForUser and deleteDraft scope drafts by organization and user", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDraftsForUser(db, { organizationId: "org-chargelab", userId: "user-1", projectId: "project-1" });
    await deleteDraft(db, { organizationId: "org-chargelab", userId: "user-1", draftId: "draft-1" });

    expect(calls[0].text).toContain("from parameter_drafts d");
    expect(calls[0].text).toContain("d.organization_id = $1");
    expect(calls[0].text).toContain("d.user_id = $2");
    expect(calls[0].text).toContain("as base_raw_value");
    expect(calls[0].text).toContain("d.candidate_config_revision_id");
    expect(calls[0].text).toContain("b.parameter_spec_id");
    expect(calls[0].text).toContain("parameter_modules pm");
    expect(calls[0].text).toContain("project_parameter_binding_revisions locked_bpr");
    expect(calls[0].values).toEqual(["org-chargelab", "user-1", "project-1"]);
    expect(calls[1].text).toContain("delete from parameter_drafts");
    expect(calls[1].values).toEqual(["org-chargelab", "user-1", "draft-1"]);
  });

  it("listDraftsForUser returns candidateConfigRevisionId when the column is set", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "draft-1",
          project_id: "project-1",
          project_parameter_value_id: "binding-1",
          target_value: "3200",
          action: "set",
          reason: "Align thermal limit.",
          updated_at: "2026-07-23T02:00:00.000Z",
          project_parameter_binding_id: "binding-1",
          candidate_config_revision_id: "rev-shared-tip",
          parameter_spec_id: "spec-thermal",
          base_raw_value: "3000",
          property_name: "thermal-limit",
          driver_module: "Power"
        }
      ]
    ]);

    const drafts = await listDraftsForUser(db, {
      organizationId: "org-1",
      userId: "user-1",
      projectId: "project-1"
    });

    expect(calls[0]?.text).toContain("candidate_config_revision_id");
    expect(drafts).toEqual([
      {
        id: "draft-1",
        projectId: "project-1",
        parameterId: "binding-1",
        targetValue: "3200",
        action: "set",
        reason: "Align thermal limit.",
        updatedAt: "2026-07-23T02:00:00.000Z",
        projectParameterBindingId: "binding-1",
        candidateConfigRevisionId: "rev-shared-tip",
        parameterSpecId: "spec-thermal",
        name: "thermal-limit",
        module: "Power",
        currentValue: "3000"
      }
    ]);
  });

  it("lists drafts by parameter value with origin metadata", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "draft-file",
          user_id: "user-sync",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          target_value: "85",
          origin: "file_sync",
          origin_file_version_id: "version-1",
          updated_at: "2026-07-11T10:00:00.000Z"
        },
        {
          id: "draft-ui",
          user_id: "user-ui",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          target_value: "82",
          origin: "manual",
          origin_file_version_id: null,
          updated_at: "2026-07-11T10:01:00.000Z"
        }
      ]
    ]);

    const drafts = await listDraftsForParameterValue(db, { projectParameterValueId: "param-1" });

    expect(calls[0].text).toContain("from parameter_drafts");
    expect(calls[0].text).toContain("project_parameter_value_id = $1");
    expect(calls[0].values).toEqual(["param-1"]);
    expect(drafts).toEqual([
      {
        id: "draft-file",
        userId: "user-sync",
        projectId: "project-1",
        projectParameterValueId: "param-1",
        targetValue: "85",
        action: "set",
        origin: "file_sync",
        originFileVersionId: "version-1",
        updatedAt: "2026-07-11T10:00:00.000Z"
      },
      {
        id: "draft-ui",
        userId: "user-ui",
        projectId: "project-1",
        projectParameterValueId: "param-1",
        targetValue: "82",
        action: "set",
        origin: "manual",
        originFileVersionId: undefined,
        updatedAt: "2026-07-11T10:01:00.000Z"
      }
    ]);
  });

  it("listOpenBindingDraftsForUser returns open drafts ordered by updated_at desc then id asc", async () => {
    const newer = new Date("2026-07-23T02:00:00.000Z");
    const older = new Date("2026-07-23T01:00:00.000Z");
    const { db, calls } = createFakeDb([
      [
        {
          id: "draft-b",
          candidate_config_revision_id: "rev-new",
          project_parameter_binding_id: "binding-b",
          edit_subject_kind: "binding",
          logical_node_id: null,
          updated_at: newer,
        },
        {
          id: "draft-a",
          candidate_config_revision_id: "rev-old",
          project_parameter_binding_id: null,
          edit_subject_kind: "node-enablement",
          logical_node_id: "node-a",
          updated_at: older,
        },
      ],
    ]);

    const drafts = await listOpenBindingDraftsForUser(db, {
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });

    expect(calls[0]?.text).toContain("from parameter_drafts");
    expect(calls[0]?.text).toContain("edit_subject_kind");
    expect(calls[0]?.text).toContain("logical_node_id");
    expect(calls[0]?.text).not.toContain("project_parameter_binding_id is not null");
    expect(calls[0]?.text).toContain("order by updated_at desc, id asc");
    expect(calls[0]?.values).toEqual(["org-1", "project-1", "user-1"]);
    expect(drafts).toEqual([
      {
        id: "draft-b",
        candidateConfigRevisionId: "rev-new",
        projectParameterBindingId: "binding-b",
        editSubjectKind: "binding",
        logicalNodeId: null,
        updatedAt: "2026-07-23T02:00:00.000Z",
      },
      {
        id: "draft-a",
        candidateConfigRevisionId: "rev-old",
        projectParameterBindingId: null,
        editSubjectKind: "node-enablement",
        logicalNodeId: "node-a",
        updatedAt: "2026-07-23T01:00:00.000Z",
      },
    ]);
  });

  it("rebaseOpenBindingDraftCandidates updates sibling drafts and returns rebased ids", async () => {
    const { db, calls } = createFakeDb([[{ id: "draft-a" }, { id: "draft-b" }]]);

    const rebasedIds = await rebaseOpenBindingDraftCandidates(db, {
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
      candidateConfigRevisionId: "rev-shared",
      excludeDraftId: "draft-current",
    });

    expect(calls[0]?.text).toContain("update parameter_drafts");
    expect(calls[0]?.text).toContain("candidate_config_revision_id is distinct from $4");
    expect(calls[0]?.text).not.toContain("project_parameter_binding_id is not null");
    expect(calls[0]?.text).toContain("($5::text is null or id <> $5)");
    expect(calls[0]?.values).toEqual([
      "org-1",
      "project-1",
      "user-1",
      "rev-shared",
      "draft-current",
    ]);
    expect(rebasedIds).toEqual(["draft-a", "draft-b"]);
  });
});
