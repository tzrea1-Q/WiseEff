import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { applyImportBatch, createImportPreview, listDrafts, reviewChange, saveDraft, submitParameterChanges } from "./service";
import { createImportBatchBodySchema } from "./schemas";

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

function makeAdminAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return makeAuth({
    roles: [{ projectId: "project-1", roleId: "admin" }],
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
    ...overrides
  });
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

function definitionRow(overrides: Record<string, unknown> = {}) {
  return {
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
    value_version: 7,
    ...overrides
  };
}

function importBatchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    project_id: "project-1",
    source_name: "admin-upload.csv",
    status: "previewed",
    summary: { added: 1, updated: 1, unchanged: 0, conflict: 0, highRisk: 1 },
    items: [
      {
        id: "item-added",
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
        definitionId: "thermal_guard_threshold_c",
        projectParameterValueId: "project-1-thermal_guard_threshold_c",
        riskFlag: false
      },
      {
        id: "item-updated",
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        risk: "High",
        unit: "mA",
        range: "1000 - 5000",
        currentValue: "4000",
        recommendedValue: "3800",
        description: "Limit fast charge current.",
        explanation: "Controls fast charging current.",
        configFormat: "ENV: FAST_CHARGE_CURRENT=number",
        classification: "updated",
        definitionId: "definition-1",
        projectParameterValueId: "param-1",
        riskFlag: true
      }
    ],
    created_at: "2026-05-25T06:00:00.000Z",
    applied_at: null,
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
  it("non-admin cannot create or apply import batches", async () => {
    const { db, calls, txCalls } = createFakeDb();

    await expect(
      createImportPreview(db, makeAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "1000 - 5000",
            currentValue: "3200"
          }
        ]
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Admin access is required for parameter import.", 403));

    await expect(
      applyImportBatch(db, makeAuth(), {
        batchId: "batch-1"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Admin access is required for parameter import.", 403));

    expect(calls).toHaveLength(0);
    expect(txCalls).toHaveLength(0);
  });

  it("invalid import item shape returns validation failed", async () => {
    expect(() =>
      createImportBatchBodySchema.parse({
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "1000 - 5000"
          }
        ]
      })
    ).toThrow();

    const { db } = createFakeDb();
    await expect(
      createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "1000 - 5000"
          }
        ]
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Invalid parameter import item.", 400));
  });

  it("preview classifies added updated unchanged conflict and flags high-risk value deltas", async () => {
    const { db, calls } = createFakeDb([
      [
        definitionRow({ id: "definition-updated", project_parameter_value_id: "param-updated" }),
        definitionRow({
          id: "definition-unchanged",
          name: "thermal_guard_threshold_c",
          module: "Thermal",
          risk: "Medium",
          unit: "C",
          default_range: "40 - 90",
          current_value: "70",
          recommended_value: "68",
          project_parameter_value_id: "param-unchanged",
          value_version: 2
        }),
        definitionRow({
          id: "definition-conflict",
          name: "pack_voltage_limit_v",
          module: "Power",
          risk: "High",
          unit: "V",
          default_range: "300 - 450",
          current_value: "400",
          recommended_value: "395",
          project_parameter_value_id: "param-conflict",
          value_version: 5
        })
      ],
      [],
      [],
      [{ id: "request-open" }],
      (call) => [
        importBatchRow({
          summary: JSON.parse(call.values[6] as string),
          items: JSON.parse(call.values[7] as string)
        })
      ]
    ]);

    const batch = await createImportPreview(db, makeAdminAuth(), {
      projectId: "project-1",
      sourceName: "admin-upload.csv",
      items: [
        {
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "4000",
          recommendedValue: "3800",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          configFormat: "ENV: FAST_CHARGE_CURRENT=number"
        },
        {
          name: "thermal_guard_threshold_c",
          module: "Thermal",
          risk: "Medium",
          unit: "C",
          range: "40 - 90",
          currentValue: "70",
          recommendedValue: "68",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          configFormat: "ENV: FAST_CHARGE_CURRENT=number"
        },
        {
          name: "new_balancing_window_s",
          module: "Balancing",
          risk: "Low",
          unit: "s",
          range: "1 - 30",
          currentValue: "10"
        },
        {
          name: "pack_voltage_limit_v",
          module: "Power",
          risk: "High",
          unit: "V",
          range: "300 - 450",
          currentValue: "410",
          recommendedValue: "405"
        }
      ]
    });

    expect(batch.summary).toEqual({ added: 1, updated: 1, unchanged: 1, conflict: 1, highRisk: 1 });
    expect(batch.items.map((item) => ({ id: item.id, classification: item.classification, riskFlag: item.riskFlag }))).toEqual([
      { id: "fast_charge_current_limit_ma", classification: "updated", riskFlag: true },
      { id: "thermal_guard_threshold_c", classification: "unchanged", riskFlag: false },
      { id: "new_balancing_window_s", classification: "added", riskFlag: false },
      { id: "pack_voltage_limit_v", classification: "conflict", riskFlag: false }
    ]);
    expect(calls[0].text).toContain("from parameter_definitions pd");
    expect(calls[0].values).toEqual([
      "org-1",
      "project-1",
      ["fast_charge_current_limit_ma", "thermal_guard_threshold_c", "new_balancing_window_s", "pack_voltage_limit_v"],
      []
    ]);
    expect(calls[4].text).toContain("insert into parameter_import_batches");
  });

  it("preview flags high-risk recommended value deltas without over-flagging zero or nonnumeric baselines", async () => {
    const { db } = createFakeDb([
      [
        definitionRow({
          id: "definition-recommended-delta",
          name: "recommended_delta",
          current_value: "100",
          recommended_value: "100",
          project_parameter_value_id: "param-recommended-delta"
        }),
        definitionRow({
          id: "definition-zero-baseline",
          name: "zero_baseline_delta",
          current_value: "100",
          recommended_value: "0",
          project_parameter_value_id: "param-zero-baseline"
        }),
        definitionRow({
          id: "definition-nonnumeric-baseline",
          name: "nonnumeric_delta",
          current_value: "100",
          recommended_value: "auto",
          project_parameter_value_id: "param-nonnumeric-baseline"
        })
      ],
      [],
      [],
      [],
      (call) => [
        importBatchRow({
          summary: JSON.parse(call.values[6] as string),
          items: JSON.parse(call.values[7] as string)
        })
      ]
    ]);

    const batch = await createImportPreview(db, makeAdminAuth(), {
      projectId: "project-1",
      sourceName: "admin-upload.csv",
      items: [
        {
          name: "recommended_delta",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "100",
          recommendedValue: "130",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          configFormat: "ENV: FAST_CHARGE_CURRENT=number"
        },
        {
          name: "zero_baseline_delta",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "100",
          recommendedValue: "130",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          configFormat: "ENV: FAST_CHARGE_CURRENT=number"
        },
        {
          name: "nonnumeric_delta",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "100",
          recommendedValue: "130",
          description: "Limit fast charge current.",
          explanation: "Controls fast charging current.",
          configFormat: "ENV: FAST_CHARGE_CURRENT=number"
        }
      ]
    });

    expect(batch.summary).toMatchObject({ updated: 3, highRisk: 1 });
    expect(batch.items.map((item) => ({ id: item.id, riskFlag: item.riskFlag }))).toEqual([
      { id: "recommended_delta", riskFlag: true },
      { id: "zero_baseline_delta", riskFlag: false },
      { id: "nonnumeric_delta", riskFlag: false }
    ]);
  });

  it("apply creates added values, updates selected values, skips unselected items, and writes audit", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [
        {
          id: "item-added",
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
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    const applied = await applyImportBatch(db, makeAdminAuth(), {
      batchId: "batch-1",
      selectedItemIds: ["item-added", "item-updated"]
    });

    expect(applied.status).toBe("applied");
    expect(txCalls.find((call) => call.text.includes("insert into parameter_definitions"))?.values).toEqual([
      "org-1",
      "project-1",
      "user-1",
      "project-1-thermal_guard_threshold_c",
      "thermal_guard_threshold_c",
      "thermal_guard_threshold_c",
      "Thermal",
      "Medium",
      "C",
      "40 - 90",
      "72",
      "70",
      "",
      "",
      "",
      expect.any(String)
    ]);
    expect(txCalls.find((call) => call.values.includes("param-1"))?.text).toContain("insert into project_parameter_values");
    expect(txCalls.filter((call) => call.text.includes("parameter_history_entries"))).toHaveLength(2);
    expect(txCalls.find((call) => call.text.includes("update parameter_import_batches"))?.values).toEqual([
      "org-1",
      "batch-1"
    ]);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("batch-import");
    expect(auditCall?.values).toContain("parameter-import-batch");
    expect(auditCall?.values).toContain("batch-1");
    expect(JSON.parse(auditCall?.values[11] as string)).toMatchObject({
      batchId: "batch-1",
      summary: { added: 1, updated: 1, skipped: 0 }
    });
  });

  it("apply skips unselected items", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [
        {
          id: "item-updated",
          definition_id: "definition-1",
          project_parameter_value_id: "param-1",
          new_version: 8
        }
      ],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await applyImportBatch(db, makeAdminAuth(), {
      batchId: "batch-1",
      selectedItemIds: ["item-updated"]
    });

    expect(txCalls.some((call) => call.values.includes("item-added"))).toBe(false);
    expect(txCalls.some((call) => call.values.includes("thermal_guard_threshold_c"))).toBe(false);
    expect(txCalls.find((call) => call.values.includes("param-1"))?.text).toContain("insert into project_parameter_values");
  });

  it("apply updates definition metadata for selected updated items", async () => {
    const metadataBatch = importBatchRow({
      summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-metadata-only",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy V2",
          risk: "High",
          unit: "A",
          range: "1 - 5",
          currentValue: "3200",
          recommendedValue: "3000",
          description: "Updated description.",
          explanation: "Updated explanation.",
          configFormat: "ENV: FAST_CHARGE_CURRENT_V2=number",
          classification: "updated",
          definitionId: "definition-1",
          projectParameterValueId: "param-1",
          riskFlag: false
        }
      ]
    });
    const { db, txCalls } = createFakeDb([
      [metadataBatch],
      [
        {
          id: "item-metadata-only",
          definition_id: "definition-1",
          project_parameter_value_id: "param-1",
          new_version: 8
        }
      ],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await applyImportBatch(db, makeAdminAuth(), {
      batchId: "batch-1",
      selectedItemIds: ["item-metadata-only"]
    });

    const applyCall = txCalls.find((call) => call.values.includes("param-1"));
    expect(applyCall?.text).toContain("insert into parameter_definitions");
    expect(applyCall?.text).toContain("on conflict (id) do update set");
    expect(applyCall?.values).toEqual([
      "org-1",
      "project-1",
      "user-1",
      "param-1",
      "definition-1",
      "fast_charge_current_limit_ma",
      "Charging Policy V2",
      "High",
      "A",
      "1 - 5",
      "3200",
      "3000",
      "Updated description.",
      "Updated explanation.",
      "ENV: FAST_CHARGE_CURRENT_V2=number",
      expect.any(String)
    ]);
  });

  it("apply creates a project value when an updated definition has no project row", async () => {
    const missingValueBatch = importBatchRow({
      summary: { added: 0, updated: 1, unchanged: 0, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-existing-definition",
          name: "orphan_definition",
          module: "Charging Policy",
          risk: "Medium",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "2500",
          recommendedValue: "2400",
          description: "Existing definition without project value.",
          explanation: "Creates project scoped value.",
          configFormat: "ENV: ORPHAN=number",
          classification: "updated",
          definitionId: "definition-orphan",
          projectParameterValueId: "project-1-definition-orphan",
          riskFlag: false
        }
      ]
    });
    const { db, txCalls } = createFakeDb([
      [missingValueBatch],
      [
        {
          id: "item-existing-definition",
          definition_id: "definition-orphan",
          project_parameter_value_id: "project-1-definition-orphan",
          new_version: 1
        }
      ],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await applyImportBatch(db, makeAdminAuth(), {
      batchId: "batch-1",
      selectedItemIds: ["item-existing-definition"]
    });

    const applyCall = txCalls.find((call) => call.values.includes("project-1-definition-orphan"));
    expect(applyCall?.text).toContain("insert into project_parameter_values");
    expect(applyCall?.text).toContain("on conflict (project_id, parameter_definition_id) do update set");
    expect(applyCall?.text).toContain("insert into parameter_history_entries");
    expect(applyCall?.values).toContain("project-1-definition-orphan");
  });

  it("apply rejects selected conflict items", async () => {
    const conflictBatch = importBatchRow({
      items: [
        {
          id: "item-conflict",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "4000",
          classification: "conflict",
          definitionId: "definition-1",
          projectParameterValueId: "param-1",
          riskFlag: false
        }
      ]
    });
    const { db, txCalls } = createFakeDb([[conflictBatch]]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-conflict"]
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409));

    expect(txCalls.some((call) => call.text.includes("update project_parameter_values"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

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
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter hardware review role is required for this project.", 403));

    expect(txCalls.some((call) => call.text.includes("update parameter_change_requests"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(false);
  });

  it("cross-project committer cannot advance review", async () => {
    const { db, txCalls } = createFakeDb([[changeRequestRow({ project_id: "project-1", status: "hardware_review" })]]);

    await expect(
      reviewChange(
        db,
        makeAuth({ roles: [{ projectId: "project-2", roleId: "hardware-committer" }], permissions: ["parameter:review"] }),
        {
          requestId: "request-1",
          decision: "advance",
          note: "Wrong project."
        }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter hardware review role is required for this project.", 403));

    expect(txCalls.some((call) => call.text.includes("update parameter_change_requests"))).toBe(false);
  });

  it("wrong-stage committer cannot advance review", async () => {
    const { db, txCalls } = createFakeDb([[changeRequestRow({ status: "software_review" })]]);

    await expect(
      reviewChange(
        db,
        makeAuth({ roles: [{ projectId: "project-1", roleId: "hardware-committer" }], permissions: ["parameter:review"] }),
        {
          requestId: "request-1",
          decision: "advance",
          note: "Hardware committer at software stage."
        }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter software review role is required for this project.", 403));

    expect(txCalls.some((call) => call.text.includes("update parameter_change_requests"))).toBe(false);
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

  it("cross-project software user cannot merge software merge request", async () => {
    const { db, txCalls } = createFakeDb([[changeRequestRow({ project_id: "project-1", status: "software_merge", risk: "Medium" })]]);

    await expect(
      reviewChange(
        db,
        makeAuth({ roles: [{ projectId: "project-2", roleId: "software-user" }], permissions: ["parameter:view", "parameter:edit"] }),
        {
          requestId: "request-1",
          decision: "advance",
          expectedVersion: 7
        }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter merge role is required for this project.", 403));

    expect(txCalls.some((call) => call.text.includes("update project_parameter_values"))).toBe(false);
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
      "user-1",
      expect.any(String)
    ]);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_history_entries"))).toBe(true);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_review_decisions"))).toBe(true);
    expect(txCalls.find((call) => call.text.includes("insert into audit_events"))?.values).toContain("parameter-merge");
  });

  it("high-risk submitted request advances through hardware and software review before merge", async () => {
    const hardwareAuth = makeAuth({
      roles: [{ projectId: "project-1", roleId: "hardware-committer" }],
      permissions: ["parameter:view", "parameter:edit", "parameter:review"]
    });
    const softwareCommitterAuth = makeAuth({
      roles: [{ projectId: "project-1", roleId: "software-committer" }],
      permissions: ["parameter:view", "parameter:edit", "parameter:review"]
    });
    const softwareUserAuth = makeAuth({
      roles: [{ projectId: "project-1", roleId: "software-user" }],
      permissions: ["parameter:view", "parameter:edit"]
    });

    const { db } = createFakeDb([
      [changeRequestRow({ status: "submitted", risk: "High" })],
      [changeRequestRow({ status: "hardware_review", risk: "High" })],
      [reviewDecisionRow({ from_status: "submitted", to_status: "hardware_review" })],
      [{ status: "hardware_review" }],
      [],
      [],
      [changeRequestRow({ status: "hardware_review", risk: "High" })],
      [changeRequestRow({ status: "software_review", risk: "High" })],
      [reviewDecisionRow({ from_status: "hardware_review", to_status: "software_review" })],
      [{ status: "software_review" }],
      [],
      [],
      [changeRequestRow({ status: "software_review", risk: "High" })],
      [changeRequestRow({ status: "software_merge", risk: "High" })],
      [reviewDecisionRow({ from_status: "software_review", to_status: "software_merge" })],
      [{ status: "software_merge" }],
      [],
      [],
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
      [changeRequestRow({ status: "merged", risk: "High", current_value: "3100" })],
      [reviewDecisionRow({ from_status: "software_merge", to_status: "merged" })],
      [{ status: "merged" }],
      [],
      []
    ]);

    const hardwareReview = await reviewChange(db, hardwareAuth, {
      requestId: "request-1",
      decision: "advance",
      note: "Route high-risk request to hardware review."
    });
    const softwareReview = await reviewChange(db, hardwareAuth, {
      requestId: "request-1",
      decision: "advance",
      note: "Hardware reviewed."
    });
    const softwareMerge = await reviewChange(db, softwareCommitterAuth, {
      requestId: "request-1",
      decision: "advance",
      note: "Software reviewed."
    });
    const merged = await reviewChange(db, softwareUserAuth, {
      requestId: "request-1",
      decision: "advance",
      expectedVersion: 7,
      note: "Merge approved."
    });

    expect(hardwareReview.status).toBe("hardware_review");
    expect(softwareReview.status).toBe("software_review");
    expect(softwareMerge.status).toBe("software_merge");
    expect(merged.status).toBe("merged");
  });
});
