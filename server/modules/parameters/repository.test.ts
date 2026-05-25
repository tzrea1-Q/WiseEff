import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  createChangeRequest,
  createSubmissionItem,
  createSubmissionRound,
  deleteDraft,
  findOpenChangeRequest,
  getParameterById,
  getProjectParameterForUpdate,
  listChangeRequests,
  listDraftsForUser,
  listParameterHistory,
  listParameters,
  listProjects,
  listSubmissionRounds,
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
      "Reduce thermal risk."
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

  it("findOpenChangeRequest and getProjectParameterForUpdate use organization scoped parameter ids", async () => {
    const { db, calls } = createFakeDb([[], []]);

    await findOpenChangeRequest(db, { organizationId: "org-chargelab", projectId: "project-1", parameterId: "param-1" });
    await getProjectParameterForUpdate(db, { organizationId: "org-chargelab", projectId: "project-1", parameterId: "param-1" });

    expect(calls[0].text).toContain("status not in ('merged', 'rejected', 'withdrawn')");
    expect(calls[0].values).toEqual(["org-chargelab", "project-1", "param-1"]);
    expect(calls[1].text).toContain("for update");
    expect(calls[1].values).toEqual(["org-chargelab", "project-1", "param-1"]);
  });
});
