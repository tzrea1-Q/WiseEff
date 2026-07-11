import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  deleteDraft,
  deleteProject,
  findOpenChangeRequest,
  getChangeRequestById,
  getImportBatchForUpdate,
  getParameterById,
  getProjectById,
  getProjectParameterForUpdate,
  hasOpenFileSyncConflict,
  hasEligibleWorkflowAssignee,
  insertFileSyncConflict,
  insertReviewDecision,
  insertImportBatch,
  listChangeRequests,
  listDraftsForParameterValue,
  listDraftsForUser,
  listOpenConflicts,
  listParameterHistory,
  listParameters,
  listParameterDefinitionsForImport,
  listReviewDecisions,
  listProjects,
  listSubmissionRounds,
  mergeChangeRequest,
  applyAddedImportItem,
  applyUpdatedImportItem,
  markImportBatchApplied,
  resolveConflict,
  updateChangeRequestStatus,
  updateSubmissionRoundStatusFromRequests,
  upsertDraft
} from "./repository";

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

describe("parameter repository", () => {
  it("listProjects filters by organization", async () => {
    const { db, calls } = createFakeDb([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "zephyr", name: "Zephyr", code: "ZEP" }
    ]);

    const rows = await listProjects(db, { organizationId: "org-chargelab" });

    expect(calls[0].text).toContain("from projects");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].values).toEqual(["org-chargelab"]);
    expect(rows).toEqual([
      { id: "aurora", name: "Aurora", code: "AUR" },
      { id: "zephyr", name: "Zephyr", code: "ZEP" }
    ]);
  });

  it("getProjectById scopes project ownership to organization", async () => {
    const { db, calls } = createFakeDb([[{ id: "aurora", name: "Aurora", code: "AUR" }]]);

    const row = await getProjectById(db, { organizationId: "org-chargelab", projectId: "aurora" });

    expect(calls[0].text).toContain("from projects");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "aurora"]);
    expect(row).toEqual({ id: "aurora", name: "Aurora", code: "AUR" });
  });

  it("deleteProject cascades parameter data and removes the project", async () => {
    const { db, calls } = createFakeDb([
      [{ id: "aurora" }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [{ id: "aurora" }]
    ]);

    const deleted = await deleteProject(db, { organizationId: "org-chargelab", projectId: "aurora" });

    expect(deleted).toEqual({ deleted: true });
    expect(calls.some((call) => call.text.includes("delete from parameter_review_decisions"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from project_parameter_values"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from project_modules"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from projects"))).toBe(true);
    expect(calls.some((call) => call.text.includes("delete from parameter_definitions"))).toBe(false);

    const { db: missingDb } = createFakeDb([[]]);
    const missing = await deleteProject(missingDb, { organizationId: "org-chargelab", projectId: "missing" });
    expect(missing).toEqual({ deleted: false, reason: "not_found" });
  });

  it("listParameters accepts project, module, risk, query, and limit filters", async () => {
    const updatedAt = new Date("2026-05-25T02:00:00.000Z");
    const { db, calls } = createFakeDb([
      {
        id: "aurora-fast-charge-current",
        project_id: "aurora",
        name: "fast_charge_current_limit_ma",
        description: "Limit fast charge current.",
        explanation: "Controls fast charging current.",
        config_format: "ENV: FAST_CHARGE_CURRENT=number",
        module: "Charging Policy",
        default_range: "1000 - 5000",
        unit: "mA",
        risk: "High",
        current_value: "3200",
        recommended_value: "3000",
        updated_at: updatedAt
      }
    ]);

    const rows = await listParameters(db, {
      organizationId: "org-chargelab",
      projectId: "aurora",
      module: "Charging Policy",
      risk: ["High", "Medium"],
      q: "fast charge",
      limit: 25
    });

    expect(calls[0].text).toContain("ppv.project_id = $2");
    expect(calls[0].text).toContain("pd.module = $3");
    expect(calls[0].text).toContain("pd.risk = any($4::text[])");
    expect(calls[0].text).toContain("pd.name ilike $5");
    expect(calls[0].text).toContain("limit $6");
    expect(calls[0].values).toEqual([
      "org-chargelab",
      "aurora",
      "Charging Policy",
      ["High", "Medium"],
      "%fast charge%",
      25
    ]);
    expect(rows[0]).toMatchObject({
      id: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      currentValue: "3200",
      recommendedValue: "3000",
      risk: "High",
      updatedAt: "2026-05-25T02:00:00.000Z",
      updatedAtTs: "2026-05-25T02:00:00.000Z",
      history: []
    });
  });

  it("getParameterById returns null when no rows match", async () => {
    const { db, calls } = createFakeDb([]);

    const row = await getParameterById(db, {
      organizationId: "org-chargelab",
      parameterId: "missing"
    });

    expect(calls[0].text).toContain("ppv.id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "missing"]);
    expect(row).toBeNull();
  });

  it("listParameterHistory orders entries by changed time descending", async () => {
    const { db, calls } = createFakeDb([
      {
        version: 2,
        value: "3300",
        changed_at: "2026-05-25T04:00:00.000Z",
        changed_by: "Xu Yun",
        request_id: "req-1"
      },
      {
        version: 1,
        value: "3200",
        changed_at: "2026-05-25T01:00:00.000Z",
        changed_by: null,
        request_id: null
      }
    ]);

    const rows = await listParameterHistory(db, {
      organizationId: "org-chargelab",
      parameterId: "aurora-fast-charge-current"
    });

    expect(calls[0].text).toContain("from parameter_history_entries phe");
    expect(calls[0].text).toContain("ppv.id = $2");
    expect(calls[0].text).toContain("order by phe.changed_at desc");
    expect(calls[0].values).toEqual(["org-chargelab", "aurora-fast-charge-current"]);
    expect(rows).toEqual([
      {
        version: "2",
        value: "3300",
        changedAt: "2026-05-25T04:00:00.000Z",
        changedBy: "Xu Yun",
        requestId: "req-1"
      },
      {
        version: "1",
        value: "3200",
        changedAt: "2026-05-25T01:00:00.000Z",
        changedBy: "",
        requestId: undefined
      }
    ]);
  });

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
      null
    ]);
    expect(draft).toMatchObject({ id: "draft-1", parameterId: "param-1", targetValue: "3100" });
  });

  it("listDraftsForUser and deleteDraft scope drafts by organization and user", async () => {
    const { db, calls } = createFakeDb([[]]);

    await listDraftsForUser(db, { organizationId: "org-chargelab", userId: "user-1", projectId: "project-1" });
    await deleteDraft(db, { organizationId: "org-chargelab", userId: "user-1", draftId: "draft-1" });

    expect(calls[0].text).toContain("from parameter_drafts");
    expect(calls[0].text).toContain("organization_id = $1");
    expect(calls[0].text).toContain("user_id = $2");
    expect(calls[0].values).toEqual(["org-chargelab", "user-1", "project-1"]);
    expect(calls[1].text).toContain("delete from parameter_drafts");
    expect(calls[1].values).toEqual(["org-chargelab", "user-1", "draft-1"]);
  });

  it("creates submission rounds, change requests, and submission items with parameterized SQL", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "round-1",
          project_id: "project-1",
          project_name: "Aurora",
          submitter: "Riley Chen",
          status: "submitted",
          summary: "Tune charging parameters",
          created_at: "2026-05-25T05:00:00.000Z"
        }
      ],
      [
        {
          id: "request-1",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          module: "Charging Policy",
          title: "fast_charge_current_limit_ma",
          current_value: "3200",
          target_value: "3100",
          submitter: "Riley Chen",
          status: "submitted",
          risk: "High",
          created_at: "2026-05-25T05:00:01.000Z",
          updated_at: "2026-05-25T05:00:01.000Z",
          assigned_to: null,
          reviewer_note: null,
          reject_reason: null,
          fast_track: false
        }
      ],
      [
        {
          id: "item-1",
          change_request_id: "request-1",
          project_parameter_value_id: "param-1",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          current_value: "3200",
          target_value: "3100",
          unit: "mA",
          risk: "High",
          reason: "Reduce thermal risk."
        }
      ]
    ]);

    await createSubmissionRound(db, {
      id: "round-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      submitterUserId: "user-1",
      status: "submitted",
      summary: "Tune charging parameters"
    });
    await createChangeRequest(db, {
      id: "request-1",
      organizationId: "org-chargelab",
      submissionRoundId: "round-1",
      projectId: "project-1",
      parameterId: "param-1",
      parameterDefinitionId: "definition-1",
      baseVersion: 7,
      currentValue: "3200",
      targetValue: "3100",
      status: "submitted",
      submitterUserId: "user-1"
    });
    await createSubmissionItem(db, {
      id: "item-1",
      organizationId: "org-chargelab",
      submissionRoundId: "round-1",
      changeRequestId: "request-1",
      parameterId: "param-1",
      currentValue: "3200",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });

    expect(calls[0].text).toContain("insert into parameter_submission_rounds");
    expect(calls[1].text).toContain("insert into parameter_change_requests");
    expect(calls[1].values).toContain(7);
    expect(calls[2].text).toContain("insert into parameter_submission_items");
    expect(calls[2].values).toEqual([
      "item-1",
      "org-chargelab",
      "round-1",
      "request-1",
      "param-1",
      "3200",
      "3100",
      "Reduce thermal risk."
    ]);
  });

  it("persists and maps workflow assignees on created change requests", async () => {
    const workflowAssignees = {
      hardwareCommitterId: "u-hardware",
      softwareCommitterId: "u-software-committer",
      softwareUserId: "u-software-user"
    };
    const { db, calls } = createFakeDb([
      [
        {
          id: "request-1",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          base_version: 7,
          module: "Charging Policy",
          title: "fast_charge_current_limit_ma",
          current_value: "3200",
          target_value: "3100",
          submitter: "Riley Chen",
          status: "hardware_review",
          risk: "High",
          created_at: "2026-05-25T05:00:01.000Z",
          updated_at: "2026-05-25T05:00:01.000Z",
          assigned_to_user_id: "u-hardware",
          workflow_hardware_committer_user_id: "u-hardware",
          workflow_software_committer_user_id: "u-software-committer",
          workflow_software_user_id: "u-software-user",
          reviewer_note: null,
          reject_reason: null,
          fast_track: false
        }
      ]
    ]);

    const request = await createChangeRequest(db, {
      id: "request-1",
      organizationId: "org-chargelab",
      submissionRoundId: "round-1",
      projectId: "project-1",
      parameterId: "param-1",
      parameterDefinitionId: "definition-1",
      baseVersion: 7,
      currentValue: "3200",
      targetValue: "3100",
      status: "hardware_review",
      submitterUserId: "user-1",
      assignedToUserId: "u-hardware",
      workflowAssignees
    });

    expect(calls[0].text).toContain("assigned_to_user_id");
    expect(calls[0].text).toContain("workflow_hardware_committer_user_id");
    expect(calls[0].text).toContain("workflow_software_committer_user_id");
    expect(calls[0].text).toContain("workflow_software_user_id");
    expect(calls[0].values).toEqual([
      "request-1",
      "org-chargelab",
      "round-1",
      "project-1",
      "param-1",
      "definition-1",
      7,
      "3200",
      "3100",
      "hardware_review",
      "user-1",
      "u-hardware",
      "u-hardware",
      "u-software-committer",
      "u-software-user"
    ]);
    expect(request).toMatchObject({
      assignedTo: "u-hardware",
      workflowAssignees
    });
  });

  it("lists submission rounds and change requests with project and status filters", async () => {
    const { db, calls } = createFakeDb([[], []]);

    await listSubmissionRounds(db, { organizationId: "org-chargelab", projectId: "project-1", status: ["submitted"] });
    await listChangeRequests(db, { organizationId: "org-chargelab", projectId: "project-1", status: ["submitted"] });

    expect(calls[0].text).toContain("psr.project_id = $2");
    expect(calls[0].text).toContain("psr.status = any($3::text[])");
    expect(calls[0].values).toEqual(["org-chargelab", "project-1", ["submitted"]]);
    expect(calls[1].text).toContain("pcr.project_id = $2");
    expect(calls[1].text).toContain("pcr.status = any($3::text[])");
    expect(calls[1].values).toEqual(["org-chargelab", "project-1", ["submitted"]]);
  });

  it("lists submission rounds with workflow assignees reconstructed from linked requests", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "round-1",
          project_id: "project-1",
          project_name: "Aurora",
          submitter: "Riley Chen",
          status: "hardware_review",
          summary: "Assigned workflow.",
          created_at: "2026-05-25T05:00:00.000Z"
        }
      ],
      [
        {
          change_request_id: "request-1",
          project_parameter_value_id: "param-1",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          current_value: "3200",
          target_value: "3100",
          unit: "mA",
          risk: "High",
          reason: "Reduce thermal risk."
        }
      ],
      [
        {
          submission_round_id: "round-1",
          workflow_hardware_committer_user_id: "u-hardware",
          workflow_software_committer_user_id: "u-software-committer",
          workflow_software_user_id: "u-software-user"
        }
      ]
    ]);

    const rounds = await listSubmissionRounds(db, { organizationId: "org-chargelab" });

    expect(calls[2].text).toContain("workflow_hardware_committer_user_id");
    expect(rounds[0]).toMatchObject({
      id: "round-1",
      workflowAssignees: {
        hardwareCommitterId: "u-hardware",
        softwareCommitterId: "u-software-committer",
        softwareUserId: "u-software-user"
      }
    });
  });

  it("findOpenChangeRequest and getProjectParameterForUpdate use organization scoped parameter ids", async () => {
    const { db, calls } = createFakeDb([[], []]);

    await findOpenChangeRequest(db, { organizationId: "org-chargelab", projectId: "project-1", parameterId: "param-1" });
    await getProjectParameterForUpdate(db, { organizationId: "org-chargelab", projectId: "project-1", parameterId: "param-1" });

    expect(calls[0].text).toContain("status not in ('merged', 'rejected', 'withdrawn')");
    expect(calls[0].values).toEqual(["org-chargelab", "project-1", "param-1"]);
    expect(calls[1].text).toContain("for update");
    expect(calls[1].values).toEqual(["org-chargelab", "project-1", "param-1"]);
  });

  it("gets change request by id and lists review decisions by organization", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "request-1",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          base_version: 7,
          module: "Charging Policy",
          title: "fast_charge_current_limit_ma",
          current_value: "3200",
          target_value: "3100",
          submitter: "Riley Chen",
          status: "hardware_review",
          risk: "High",
          created_at: "2026-05-25T05:00:01.000Z",
          updated_at: "2026-05-25T05:00:01.000Z",
          assigned_to: null,
          reviewer_note: null,
          reject_reason: null,
          fast_track: false
        }
      ],
      [
        {
          id: "decision-1",
          request_id: "request-1",
          reviewer_user_id: "user-1",
          decision: "advance",
          from_status: "hardware_review",
          to_status: "software_review",
          note: "Hardware reviewed.",
          created_at: "2026-05-25T05:10:00.000Z"
        }
      ]
    ]);

    const request = await getChangeRequestById(db, { organizationId: "org-chargelab", requestId: "request-1" });
    const decisions = await listReviewDecisions(db, { organizationId: "org-chargelab", requestId: "request-1" });

    expect(request).toMatchObject({ id: "request-1", status: "hardware_review" });
    expect(decisions).toEqual([
      {
        id: "decision-1",
        requestId: "request-1",
        reviewerUserId: "user-1",
        decision: "advance",
        fromStatus: "hardware_review",
        toStatus: "software_review",
        note: "Hardware reviewed.",
        createdAt: "2026-05-25T05:10:00.000Z"
      }
    ]);
    expect(calls[0].text).toContain("pcr.id = $2");
    expect(calls[0].text).toContain("for update of pcr");
    expect(calls[0].values).toEqual(["org-chargelab", "request-1"]);
    expect(calls[1].text).toContain("from parameter_review_decisions");
    expect(calls[1].values).toEqual(["org-chargelab", "request-1"]);
  });

  it("updates request status and inserts review decisions", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "request-1",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          base_version: 7,
          module: "Charging Policy",
          title: "fast_charge_current_limit_ma",
          current_value: "3200",
          target_value: "3100",
          submitter: "Riley Chen",
          status: "software_review",
          risk: "High",
          created_at: "2026-05-25T05:00:01.000Z",
          updated_at: "2026-05-25T05:10:00.000Z",
          assigned_to: null,
          reviewer_note: "Hardware reviewed.",
          reject_reason: null,
          fast_track: false
        }
      ],
      [
        {
          id: "decision-1",
          request_id: "request-1",
          reviewer_user_id: "user-1",
          decision: "advance",
          from_status: "hardware_review",
          to_status: "software_review",
          note: "Hardware reviewed.",
          created_at: "2026-05-25T05:10:00.000Z"
        }
      ]
    ]);

    await updateChangeRequestStatus(db, {
      organizationId: "org-chargelab",
      requestId: "request-1",
      status: "software_review",
      note: "Hardware reviewed."
    });
    const decision = await insertReviewDecision(db, {
      id: "decision-1",
      organizationId: "org-chargelab",
      requestId: "request-1",
      reviewerUserId: "user-1",
      decision: "advance",
      fromStatus: "hardware_review",
      toStatus: "software_review",
      note: "Hardware reviewed."
    });

    expect(calls[0].text).toContain("update parameter_change_requests");
    expect(calls[0].values).toEqual(["org-chargelab", "request-1", "software_review", "Hardware reviewed.", null]);
    expect(calls[1].text).toContain("insert into parameter_review_decisions");
    expect(decision).toMatchObject({ requestId: "request-1", toStatus: "software_review" });
  });

  it("advances assigned user from workflow assignees when updating review status", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "request-1",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          base_version: 7,
          module: "Charging Policy",
          title: "fast_charge_current_limit_ma",
          current_value: "3200",
          target_value: "3100",
          submitter: "Riley Chen",
          status: "software_review",
          risk: "High",
          created_at: "2026-05-25T05:00:01.000Z",
          updated_at: "2026-05-25T05:10:00.000Z",
          assigned_to_user_id: "u-software-committer",
          workflow_hardware_committer_user_id: "u-hardware",
          workflow_software_committer_user_id: "u-software-committer",
          workflow_software_user_id: "u-software-user",
          assigned_to: "Software Committer",
          reviewer_note: "Hardware reviewed.",
          reject_reason: null,
          fast_track: false
        }
      ]
    ]);

    const request = await updateChangeRequestStatus(db, {
      organizationId: "org-chargelab",
      requestId: "request-1",
      status: "software_review",
      note: "Hardware reviewed."
    });

    expect(calls[0].text).toContain("assigned_to_user_id = case");
    expect(calls[0].values).toEqual(["org-chargelab", "request-1", "software_review", "Hardware reviewed.", null]);
    expect(request).toMatchObject({
      status: "software_review",
      assignedTo: "u-software-committer",
      workflowAssignees: {
        hardwareCommitterId: "u-hardware",
        softwareCommitterId: "u-software-committer",
        softwareUserId: "u-software-user"
      }
    });
  });

  it("checks workflow assignee eligibility against active project role bindings", async () => {
    const { db, calls } = createFakeDb([[{ id: "u-hardware" }]]);

    const eligible = await hasEligibleWorkflowAssignee(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      userId: "u-hardware",
      roleId: "hardware-committer"
    });

    expect(eligible).toBe(true);
    expect(calls[0].text).toContain("users.organization_id = $1");
    expect(calls[0].text).toContain("urb.organization_id = $1");
    expect(calls[0].text).toContain("users.is_active = true");
    expect(calls[0].text).toContain("urb.project_id = $3");
    expect(calls[0].text).toContain("urb.role_id = any($4::text[])");
    expect(calls[0].values).toEqual(["org-chargelab", "u-hardware", "project-1", ["hardware-committer"]]);
  });

  it("merges change request with expected version and inserts history", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "request-1",
          project_parameter_value_id: "param-1",
          parameter_definition_id: "definition-1",
          project_id: "project-1",
          target_value: "3100",
          base_version: 7,
          new_version: 8
        }
      ]
    ]);

    const merged = await mergeChangeRequest(db, {
      historyId: "history-1",
      organizationId: "org-chargelab",
      requestId: "request-1",
      expectedVersion: 7,
      actorUserId: "user-1"
    });

    expect(merged).toEqual({
      id: "request-1",
      projectParameterValueId: "param-1",
      parameterDefinitionId: "definition-1",
      projectId: "project-1",
      targetValue: "3100",
      baseVersion: 7,
      newVersion: 8
    });
    expect(calls[0].text).toContain("update project_parameter_values");
    expect(calls[0].text).toContain("value_version = coalesce($3, request_to_merge.base_version)");
    expect(calls[0].values).toEqual(["org-chargelab", "request-1", 7, "user-1", "history-1"]);
    expect(calls[0].text).toContain("insert into parameter_history_entries");
    expect(calls).toHaveLength(1);
  });

  it("mergeChangeRequest returns null when the version guard does not update a row", async () => {
    const { db, calls } = createFakeDb([[]]);

    const merged = await mergeChangeRequest(db, {
      historyId: "history-1",
      organizationId: "org-chargelab",
      requestId: "request-1",
      expectedVersion: 6,
      actorUserId: "user-1"
    });

    expect(merged).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("updates submission round status from child requests", async () => {
    const { db, calls } = createFakeDb([[{ status: "software_merge" }]]);

    const status = await updateSubmissionRoundStatusFromRequests(db, {
      organizationId: "org-chargelab",
      submissionRoundId: "round-1"
    });

    expect(status).toBe("software_merge");
    expect(calls[0].text).toContain("from parameter_change_requests");
    expect(calls[1].text).toContain("update parameter_submission_rounds");
    expect(calls[1].values).toEqual(["org-chargelab", "round-1", "software_merge"]);
  });

  it("lists import match candidates by definition id or name", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "definition-1",
          name: "fast_charge_current_limit_ma",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          config_format: "ENV: FAST_CHARGE_CURRENT=number",
          module: "Charging Policy",
          default_range: "1000 - 5000",
          unit: "mA",
          risk: "High",
          project_parameter_value_id: "param-1",
          current_value: "3200",
          recommended_value: "3000",
          value_version: 7
        }
      ]
    ]);

    const rows = await listParameterDefinitionsForImport(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      names: ["fast_charge_current_limit_ma"],
      definitionIds: ["definition-1"]
    });

    expect(calls[0].text).toContain("from parameter_definitions pd");
    expect(calls[0].text).toContain("left join project_parameter_values ppv");
    expect(calls[0].text).toContain("(pd.name = any($3::text[]) or pd.id = any($4::text[]))");
    expect(calls[0].values).toEqual(["org-chargelab", "project-1", ["fast_charge_current_limit_ma"], ["definition-1"]]);
    expect(rows[0]).toMatchObject({
      id: "definition-1",
      name: "fast_charge_current_limit_ma",
      projectParameterValueId: "param-1",
      currentValue: "3200",
      valueVersion: 7
    });
  });

  it("inserts and loads import preview batches as jsonb payloads", async () => {
    const items = [
      {
        id: "item-1",
        name: "thermal_guard_threshold_c",
        module: "Thermal",
        risk: "Medium" as const,
        unit: "C",
        range: "40 - 90",
        currentValue: "72",
        classification: "added" as const,
        definitionId: "thermal_guard_threshold_c",
        projectParameterValueId: "project-1-thermal_guard_threshold_c",
        riskFlag: false
      }
    ];
    const batchRow = {
      id: "batch-1",
      project_id: "project-1",
      source_name: "admin-upload.csv",
      status: "previewed",
      summary: { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 0 },
      items,
      created_at: "2026-05-25T06:00:00.000Z",
      applied_at: null
    };
    const { db, calls } = createFakeDb([[batchRow], [batchRow]]);

    const inserted = await insertImportBatch(db, {
      id: "batch-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      createdByUserId: "user-1",
      sourceName: "admin-upload.csv",
      summary: batchRow.summary,
      items: batchRow.items
    });
    const loaded = await getImportBatchForUpdate(db, {
      organizationId: "org-chargelab",
      batchId: "batch-1"
    });

    expect(calls[0].text).toContain("insert into parameter_import_batches");
    expect(calls[0].values).toEqual([
      "batch-1",
      "org-chargelab",
      "project-1",
      "user-1",
      "admin-upload.csv",
      "previewed",
      JSON.stringify(batchRow.summary),
      JSON.stringify(batchRow.items)
    ]);
    expect(calls[1].text).toContain("for update");
    expect(loaded).toEqual(inserted);
  });

  it("applies added and updated import items with history rows", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "project-1-thermal_guard_threshold_c",
          definition_id: "thermal_guard_threshold_c",
          project_parameter_value_id: "project-1-thermal_guard_threshold_c",
          new_version: 1
        }
      ],
      [
        {
          id: "item-updated",
          definition_id: "definition-1",
          project_parameter_value_id: "param-1",
          new_version: 8
        }
      ],
      [
        {
          id: "batch-1",
          project_id: "project-1",
          source_name: "admin-upload.csv",
          status: "applied",
          summary: { added: 1, updated: 1, unchanged: 0, conflict: 0, highRisk: 1 },
          items: [],
          created_at: "2026-05-25T06:00:00.000Z",
          applied_at: "2026-05-25T07:00:00.000Z"
        }
      ]
    ]);

    await applyAddedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-added",
      item: {
        id: "item-added",
        definitionId: "thermal_guard_threshold_c",
        projectParameterValueId: "project-1-thermal_guard_threshold_c",
        name: "thermal_guard_threshold_c",
        module: "Thermal",
        risk: "Medium",
        unit: "C",
        range: "40 - 90",
        currentValue: "72",
        recommendedValue: "70",
        description: "",
        explanation: "",
        configFormat: "",
        classification: "added",
        riskFlag: false
      }
    });
    await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated",
      item: {
        id: "item-updated",
        definitionId: "definition-1",
        projectParameterValueId: "param-1",
        currentValue: "4000",
        recommendedValue: "3800",
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        risk: "High",
        unit: "mA",
        range: "1000 - 5000",
        classification: "updated",
        riskFlag: true
      }
    });
    await markImportBatchApplied(db, { organizationId: "org-chargelab", batchId: "batch-1" });

    expect(calls[0].text).toContain("insert into parameter_definitions");
    expect(calls[0].text).toContain("insert into project_parameter_values");
    expect(calls[0].text).toContain("insert into parameter_history_entries");
    expect(calls[0].values[3]).toBe("project-1-thermal_guard_threshold_c");
    expect(calls[1].text).toContain("insert into parameter_definitions");
    expect(calls[1].text).toContain("insert into project_parameter_values");
    expect(calls[1].text).toContain("where parameter_definitions.organization_id = $1");
    expect(calls[1].text).toContain("updated_value as");
    expect(calls[1].text).toContain("ppv.current_value is distinct from $11");
    expect(calls[1].text).toContain("insert into parameter_history_entries");
    expect(calls[2].text).toContain("update parameter_import_batches");
    expect(calls[2].values).toEqual(["org-chargelab", "batch-1"]);
  });

  it("updated import items upsert definition metadata and missing project values", async () => {
    const { db, calls } = createFakeDb([
      [
        {
          id: "item-updated-metadata",
          definition_id: "definition-1",
          project_parameter_value_id: "project-1-definition-1",
          new_version: 1
        }
      ]
    ]);

    await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated-metadata",
      item: {
        id: "item-updated-metadata",
        definitionId: "definition-1",
        projectParameterValueId: "project-1-definition-1",
        currentValue: "4100",
        recommendedValue: "3900",
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy V2",
        risk: "High",
        unit: "mA",
        range: "500 - 4500",
        description: "Updated definition description.",
        explanation: "Updated explanation.",
        configFormat: "ENV: FAST_CHARGE_CURRENT_V2=number",
        classification: "updated",
        riskFlag: true
      }
    });

    expect(calls[0].text).toContain("insert into parameter_definitions");
    expect(calls[0].text).toContain("on conflict (id) do update set");
    expect(calls[0].text).toContain("where parameter_definitions.organization_id = $1");
    expect(calls[0].text).toContain("insert into project_parameter_values");
    expect(calls[0].text).toContain("inserted_value as");
    expect(calls[0].text).toContain("updated_value as");
    expect(calls[0].text).toContain("changed_value as");
    expect(calls[0].text).toContain("insert into parameter_history_entries");
    expect(calls[0].text).toContain("from changed_value");
    expect(calls[0].text).toContain("where not exists (select 1 from changed_value)");
    expect(calls[0].values).toEqual([
      "org-chargelab",
      "project-1",
      "user-1",
      "project-1-definition-1",
      "definition-1",
      "fast_charge_current_limit_ma",
      "Charging Policy V2",
      "High",
      "mA",
      "500 - 4500",
      "4100",
      "3900",
      "Updated definition description.",
      "Updated explanation.",
      "ENV: FAST_CHARGE_CURRENT_V2=number",
      "history-updated-metadata"
    ]);
  });

  it("import item definition upserts do not bind cross-organization id conflicts", async () => {
    const { db, calls } = createFakeDb([[], []]);
    const item = {
      id: "item-cross-org",
      definitionId: "definition-cross-org",
      projectParameterValueId: "project-1-definition-cross-org",
      currentValue: "4100",
      recommendedValue: "3900",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      risk: "High" as const,
      unit: "mA",
      range: "500 - 4500",
      description: "Updated definition description.",
      explanation: "Updated explanation.",
      configFormat: "ENV: FAST_CHARGE_CURRENT_V2=number",
      classification: "updated" as const,
      riskFlag: true
    };

    const added = await applyAddedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-added-cross-org",
      item: { ...item, classification: "added" as const }
    });
    const updated = await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated-cross-org",
      item
    });

    expect(added).toBeNull();
    expect(updated).toBeNull();
    expect(calls[0].text).toContain("on conflict (id) do nothing");
    expect(calls[1].text).toContain("where parameter_definitions.organization_id = $1");
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
        origin: "manual",
        originFileVersionId: undefined,
        updatedAt: "2026-07-11T10:01:00.000Z"
      }
    ]);
  });

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
    expect(calls[1].text).toContain("from parameter_file_sync_conflicts");
    expect(calls[1].text).toContain("status = 'open'");
    expect(calls[2].text).toContain("status = 'open'");
    expect(calls[3].text).toContain("update parameter_file_sync_conflicts");
    expect(inserted.status).toBe("open");
    expect(openConflicts).toHaveLength(1);
    expect(hasOpen).toBe(true);
    expect(resolved?.status).toBe("resolved_file");
  });
});
