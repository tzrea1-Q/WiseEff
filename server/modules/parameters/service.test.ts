import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { listDrafts, reviewChange, saveDraft, submitParameterChanges } from "./service";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(results: QueuedResult[] = []) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];

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
    transaction: async <T,>(fn: (queryable: Queryable) => Promise<T>) => {
      const result = await fn(tx);
      transactions.push([...txCalls]);
      return result;
    }
  };

  return {
    calls,
    txCalls,
    transactions,
    db
  };
}

function makeAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    user: {
      id: "user-1",
      organizationId: "org-1",
      name: "Riley Chen",
      email: "riley@example.com",
      title: "Software User",
      isActive: true
    },
    organization: { id: "org-1", name: "ChargeLab" },
    roles: [{ projectId: "project-1", roleId: "software-user" }],
    permissions: ["parameter:view", "parameter:edit"],
    ...overrides
  };
}

function parameterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "param-1",
    project_id: "project-1",
    parameter_definition_id: "definition-1",
    name: "fast_charge_current_limit_ma",
    module: "Charging Policy",
    unit: "mA",
    risk: "High",
    current_value: "3200",
    recommended_value: "3000",
    value_version: 7,
    updated_at: "2026-05-25T02:00:00.000Z",
    ...overrides
  };
}

function changeRequestRow(overrides: Record<string, unknown> = {}) {
  return {
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
    fast_track: false,
    ...overrides
  };
}

function reviewDecisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "decision-1",
    request_id: "request-1",
    reviewer_user_id: "reviewer-1",
    decision: "advance",
    from_status: "hardware_review",
    to_status: "software_review",
    note: "Hardware reviewed.",
    created_at: "2026-05-25T05:10:00.000Z",
    ...overrides
  };
}

describe("parameter service", () => {
  it("guest cannot save draft", async () => {
    const { db, calls } = createFakeDb();

    await expect(
      saveDraft(
        db,
        makeAuth({ permissions: ["parameter:view"], roles: [{ projectId: "project-1", roleId: "guest" }] }),
        {
          projectId: "project-1",
          parameterId: "param-1",
          targetValue: "3100",
          reason: "Reduce thermal risk."
        }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit permission is required.", 403));

    expect(calls).toHaveLength(0);
  });

  it("user can save and list own draft", async () => {
    const updatedAt = new Date("2026-05-25T04:00:00.000Z");
    const { db, calls } = createFakeDb([
      [parameterRow()],
      [
        {
          id: "draft-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          target_value: "3100",
          reason: "Reduce thermal risk.",
          updated_at: updatedAt
        }
      ],
      [
        {
          id: "draft-1",
          project_id: "project-1",
          project_parameter_value_id: "param-1",
          target_value: "3100",
          reason: "Reduce thermal risk.",
          updated_at: updatedAt
        }
      ]
    ]);

    const draft = await saveDraft(db, makeAuth(), {
      projectId: "project-1",
      parameterId: "param-1",
      targetValue: "3100",
      reason: "Reduce thermal risk."
    });
    const drafts = await listDrafts(db, makeAuth(), { projectId: "project-1" });

    expect(draft).toEqual({
      id: "draft-1",
      projectId: "project-1",
      parameterId: "param-1",
      targetValue: "3100",
      reason: "Reduce thermal risk.",
      updatedAt: "2026-05-25T04:00:00.000Z"
    });
    expect(drafts).toEqual([draft]);
    expect(calls[0].text).toContain("from project_parameter_values");
    expect(calls[0].values).toEqual(["org-1", "project-1", "param-1"]);
    expect(calls[1].values).toEqual([
      expect.any(String),
      "org-1",
      "project-1",
      "param-1",
      "user-1",
      "3100",
      "Reduce thermal risk."
    ]);
    expect(calls[2].text).toContain("user_id = $2");
    expect(calls[2].values).toEqual(["org-1", "user-1", "project-1"]);
  });

  it("saveDraft rejects when parameter is not in the project before upserting", async () => {
    const { db, calls } = createFakeDb([[]]);

    await expect(
      saveDraft(db, makeAuth(), {
        projectId: "project-1",
        parameterId: "param-from-other-project",
        targetValue: "3100",
        reason: "Reduce thermal risk."
      })
    ).rejects.toMatchObject(
      new ApiError("NOT_FOUND", "Parameter was not found for this project.", 404, {
        parameterId: "param-from-other-project",
        projectId: "project-1"
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("from project_parameter_values");
    expect(calls[0].values).toEqual(["org-1", "project-1", "param-from-other-project"]);
    expect(calls.some((call) => call.text.includes("insert into parameter_drafts"))).toBe(false);
  });

  it("submitting two items creates one round and two change requests", async () => {
    const { db, txCalls } = createFakeDb([
      [parameterRow()],
      [],
      [parameterRow({ id: "param-2", parameter_definition_id: "definition-2", name: "thermal_guard_threshold_c", value_version: 3 })],
      [],
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
      ],
      [],
      [
        {
          id: "request-2",
          submission_round_id: "round-1",
          project_id: "project-1",
          project_parameter_value_id: "param-2",
          module: "Charging Policy",
          title: "thermal_guard_threshold_c",
          current_value: "70",
          target_value: "68",
          submitter: "Riley Chen",
          status: "submitted",
          risk: "High",
          created_at: "2026-05-25T05:00:02.000Z",
          updated_at: "2026-05-25T05:00:02.000Z",
          assigned_to: null,
          reviewer_note: null,
          reject_reason: null,
          fast_track: false
        }
      ],
      [
        {
          id: "item-2",
          change_request_id: "request-2",
          project_parameter_value_id: "param-2",
          name: "thermal_guard_threshold_c",
          module: "Charging Policy",
          current_value: "70",
          target_value: "68",
          unit: "C",
          risk: "High",
          reason: "Match new cell pack."
        }
      ],
      [],
      []
    ]);

    const round = await submitParameterChanges(db, makeAuth(), {
      projectId: "project-1",
      reason: "Tune charging parameters",
      items: [
        { parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." },
        { parameterId: "param-2", targetValue: "68", reason: "Match new cell pack." }
      ]
    });

    expect(round).toMatchObject({
      id: "round-1",
      projectId: "project-1",
      status: "submitted",
      summary: "Tune charging parameters",
      items: [
        { requestId: "request-1", parameterId: "param-1", targetValue: "3100" },
        { requestId: "request-2", parameterId: "param-2", targetValue: "68" }
      ]
    });
    expect(txCalls.filter((call) => call.text.includes("insert into parameter_change_requests"))).toHaveLength(2);
    expect(txCalls.filter((call) => call.text.includes("insert into parameter_submission_items"))).toHaveLength(2);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(true);
  });

  it("submitting a parameter with an existing open request throws conflict", async () => {
    const { db } = createFakeDb([
      [parameterRow()],
      [
        {
          id: "request-open",
          submission_round_id: "round-open",
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
      ]
    ]);

    await expect(
      submitParameterChanges(db, makeAuth(), {
        projectId: "project-1",
        items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }]
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Parameter already has an open change request.", 409));
  });

  it("submitting duplicate parameter ids rejects before write inserts", async () => {
    const { db, txCalls } = createFakeDb();

    await expect(
      submitParameterChanges(db, makeAuth(), {
        projectId: "project-1",
        items: [
          { parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." },
          { parameterId: "param-1", targetValue: "3050", reason: "Duplicate edit." }
        ]
      })
    ).rejects.toMatchObject(
      new ApiError("VALIDATION_FAILED", "Each parameter can only appear once per submission round.", 400, {
        parameterId: "param-1"
      })
    );

    expect(txCalls.some((call) => call.text.includes("insert into parameter_submission_rounds"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_change_requests"))).toBe(false);
  });

  it("submit uses the current value_version as baseVersion", async () => {
    const { db, txCalls } = createFakeDb([
      [parameterRow({ value_version: 42 })],
      [],
      [
        {
          id: "round-1",
          project_id: "project-1",
          project_name: "Aurora",
          submitter: "Riley Chen",
          status: "submitted",
          summary: "Parameter changes submitted.",
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
      ],
      [],
      []
    ]);

    await submitParameterChanges(db, makeAuth(), {
      projectId: "project-1",
      items: [{ parameterId: "param-1", targetValue: "3100", reason: "Reduce thermal risk." }]
    });

    const insertRequest = txCalls.find((call) => call.text.includes("insert into parameter_change_requests"));
    expect(insertRequest?.values).toContain(42);
  });

  it("ordinary user cannot advance review", async () => {
    const { db, txCalls } = createFakeDb([[changeRequestRow()]]);

    await expect(
      reviewChange(db, makeAuth(), {
        requestId: "request-1",
        decision: "advance",
        note: "Looks good."
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter review permission is required.", 403));

    expect(txCalls.some((call) => call.text.includes("update parameter_change_requests"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(false);
  });

  it("committer advances hardware review to software review", async () => {
    const { db, txCalls } = createFakeDb([
      [changeRequestRow({ status: "hardware_review" })],
      [changeRequestRow({ status: "software_review", updated_at: "2026-05-25T05:11:00.000Z" })],
      [reviewDecisionRow({ from_status: "hardware_review", to_status: "software_review" })],
      [{ status: "software_review" }],
      []
    ]);

    const request = await reviewChange(
      db,
      makeAuth({ permissions: ["parameter:view", "parameter:edit", "parameter:review"], roles: [{ projectId: "project-1", roleId: "hardware-committer" }] }),
      {
        requestId: "request-1",
        decision: "advance",
        note: "Hardware reviewed."
      }
    );

    expect(request.status).toBe("software_review");
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("update parameter_submission_rounds"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain(
      "parameter-review-advance"
    );
  });

  it("committer advances software review to software merge", async () => {
    const { db } = createFakeDb([
      [changeRequestRow({ status: "software_review" })],
      [changeRequestRow({ status: "software_merge", updated_at: "2026-05-25T05:12:00.000Z" })],
      [reviewDecisionRow({ from_status: "software_review", to_status: "software_merge" })],
      [{ status: "software_merge" }],
      []
    ]);

    const request = await reviewChange(
      db,
      makeAuth({ permissions: ["parameter:view", "parameter:edit", "parameter:review"], roles: [{ projectId: "project-1", roleId: "software-committer" }] }),
      {
        requestId: "request-1",
        decision: "advance",
        note: "Software reviewed."
      }
    );

    expect(request.status).toBe("software_merge");
  });

  it("software user can merge software merge request", async () => {
    const { db, txCalls } = createFakeDb([
      [changeRequestRow({ status: "software_merge", risk: "Medium" })],
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
      ],
      [],
      [changeRequestRow({ status: "merged", risk: "Medium", current_value: "3100", updated_at: "2026-05-25T05:13:00.000Z" })],
      [reviewDecisionRow({ from_status: "software_merge", to_status: "merged" })],
      [{ status: "merged" }],
      []
    ]);

    const request = await reviewChange(db, makeAuth(), {
      requestId: "request-1",
      decision: "advance",
      expectedVersion: 7,
      note: "Merge approved."
    });

    expect(request.status).toBe("merged");
    expect(txCalls.some((call) => call.text.includes("insert into parameter_history_entries"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("parameter-merge");
  });

  it("high-risk request cannot merge unless prior hardware and software decisions exist", async () => {
    const { db } = createFakeDb([[changeRequestRow({ status: "software_merge", risk: "High" })], []]);

    await expect(
      reviewChange(db, makeAuth(), {
        requestId: "request-1",
        decision: "advance",
        expectedVersion: 7
      })
    ).rejects.toMatchObject(
      new ApiError(
        "CONFLICT",
        "High-risk parameter changes require hardware and software review before merge.",
        409,
        { requestId: "request-1" }
      )
    );
  });

  it("merge with stale expectedVersion throws conflict", async () => {
    const { db, txCalls } = createFakeDb([
      [changeRequestRow({ status: "software_merge", risk: "Medium" })],
      []
    ]);

    await expect(
      reviewChange(db, makeAuth(), {
        requestId: "request-1",
        decision: "advance",
        expectedVersion: 6
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Parameter value changed before merge.", 409));

    expect(txCalls.some((call) => call.text.includes("insert into parameter_history_entries"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(false);
  });

  it("merge updates parameter value, inserts history, inserts decision, writes audit", async () => {
    const { db, txCalls } = createFakeDb([
      [changeRequestRow({ status: "software_merge", risk: "High" })],
      [
        reviewDecisionRow({ id: "decision-hardware", from_status: "hardware_review", to_status: "software_review" }),
        reviewDecisionRow({ id: "decision-software", from_status: "software_review", to_status: "software_merge" })
      ],
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
      ],
      [],
      [changeRequestRow({ status: "merged", current_value: "3100", updated_at: "2026-05-25T05:14:00.000Z" })],
      [reviewDecisionRow({ from_status: "software_merge", to_status: "merged" })],
      [{ status: "merged" }],
      []
    ]);

    const request = await reviewChange(db, makeAuth(), {
      requestId: "request-1",
      decision: "advance",
      expectedVersion: 7,
      note: "Merge approved."
    });

    expect(request.status).toBe("merged");
    expect(txCalls.find((call) => call.text.includes("update project_parameter_values"))?.values).toEqual([
      "org-1",
      "request-1",
      7,
      "user-1"
    ]);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_history_entries"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("parameter-merge");
  });
});
