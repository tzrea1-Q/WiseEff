import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { getProjectParameterForUpdate } from "./repository";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  findOpenChangeRequest,
  getChangeRequestById,
  hasEligibleWorkflowAssignee,
  insertReviewDecision,
  listChangeRequests,
  listEligibleWorkflowAssignees,
  listReviewDecisions,
  listSubmissionRounds,
  mergeChangeRequest,
  updateChangeRequestStatus,
  updateSubmissionRoundStatusFromRequests
} from "./reviewWorkflowRepository";

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

describe("review workflow repository", () => {
  it("lists active workflow assignees only from the requested organization and project", async () => {
    const { db, calls } = createFakeDb([[
      { id: "u-hw", name: "Hardware", role_id: "hardware-committer" },
      { id: "u-sw", name: "Software", role_id: "software-committer" },
      { id: "u-user", name: "Developer", role_id: "software-user" },
    ]]);

    await expect(listEligibleWorkflowAssignees(db, {
      organizationId: "org-1",
      projectId: "project-1",
    })).resolves.toEqual({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware" }],
      softwareCommitters: [{ id: "u-sw", name: "Software" }],
      softwareUsers: [
        { id: "u-sw", name: "Software" },
        { id: "u-user", name: "Developer" },
      ],
    });
    expect(calls[0]?.values).toEqual(["org-1", "project-1"]);
    expect(calls[0]?.text).toContain("users.organization_id = $1");
    expect(calls[0]?.text).toContain("urb.organization_id = $1");
    expect(calls[0]?.text).toContain("urb.project_id = $2");
    expect(calls[0]?.text).toContain("users.is_active = true");
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
      "Reduce thermal risk.",
      null,
      "set"
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
      "u-software-user",
      null,
      null,
      "set"
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

  it("lists post-cutover submission items without retired flat identity tables", async () => {
    setParameterIdentityMode("semantic");
    const calls: QueryCall[] = [];
    const db: Queryable = {
      query: async <Row,>(text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        if (text.includes("from parameter_submission_rounds psr")) {
          return {
            rows: [{
              id: "round-semantic",
              project_id: "project-1",
              project_name: "Aurora",
              submitter: "Liu Min",
              status: "hardware_review",
              summary: "Semantic submission",
              created_at: "2026-07-17T00:00:00.000Z"
            } as Row],
            rowCount: 1
          };
        }
        if (text.includes("from parameter_submission_items psi")) {
          return {
            rows: [{
              submission_round_id: "round-semantic",
              change_request_id: "request-semantic",
              project_parameter_value_id: "binding-1",
              name: "gpio_int",
              module: "manual",
              current_value: "<&gpio13 29 0>",
              target_value: "<&gpio13 30 0>",
              unit: "",
              risk: "Low",
              value_kind: "phandle-list",
              config_format: "DTS",
              reason: "typed edit"
            } as Row],
            rowCount: 1
          };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    const rounds = await listSubmissionRounds(db, { organizationId: "org-chargelab" });

    expect(rounds[0]?.items[0]).toMatchObject({ parameterId: "binding-1", name: "gpio_int" });
    const itemSql = calls.find((call) => call.text.includes("from parameter_submission_items psi"))?.text ?? "";
    expect(itemSql).not.toContain("project_parameter_values");
    expect(itemSql).toContain("project_parameter_bindings");
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
      action: "set",
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
});
