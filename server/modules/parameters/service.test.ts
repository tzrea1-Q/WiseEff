import { describe, expect, it } from "vitest";
import type { AuthContext } from "../auth/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { applyImportBatch, createImportPreview, listDrafts, parseDtsImportForAuth, reviewChange, saveDraft, submitParameterChanges } from "./service";
import { createImportBatchBodySchema } from "./schemas";

type QueryCall = {
  text: string;
  values: unknown[];
};

type QueuedResult = unknown[] | ((call: QueryCall) => unknown[]);

function createFakeDb(
  results: QueuedResult[] = [],
  options: {
    /** When true, semantic/post-cutover identity path is active. */
    semanticCutoverComplete?: boolean;
  } = {}
) {
  const calls: QueryCall[] = [];
  const txCalls: QueryCall[] = [];
  const transactions: QueryCall[][] = [];
  const semanticCutoverComplete = options.semanticCutoverComplete ?? false;
  setParameterIdentityMode(semanticCutoverComplete ? "semantic" : "legacy");

  const runQuery = async <Row,>(target: QueryCall[], text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
    const call = { text, values };
    // Cutover probes must not consume the queued fixture rows.
    if (text.includes("parameter_identity_cutovers")) {
      return { rows: [{ c: semanticCutoverComplete ? "1" : "0" } as Row], rowCount: 1 };
    }
    if (text.includes("information_schema.tables") && text.includes("parameter_definitions")) {
      // When cutover is complete, legacy flat tables are retired.
      return { rows: [{ c: semanticCutoverComplete ? "0" : "1" } as Row], rowCount: 1 };
    }
    // C1 init lock: default unlocked so existing submit fixtures stay focused.
    if (text.includes("initialization_status") && text.includes("from projects")) {
      return { rows: [{ initialization_status: "initialized" } as Row], rowCount: 1 };
    }
    target.push(call);
    if (text.includes("from parameter_file_sync_conflicts")) {
      return { rows: [] as Row[], rowCount: 0 };
    }
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

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Aurora",
    code: "AUR",
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
    initSuggestionText: "3000",
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
    initSuggestionText: "3000",
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

const PROJECT_ID = "project-1";

const completeAssignees = {
  hardwareCommitterId: "u-hardware",
  softwareCommitterId: "u-software-committer",
  softwareUserId: "u-software-user"
};

function bindingDraftSubmissionRow(overrides: Record<string, unknown> = {}) {
  const draftId = (overrides.id as string) ?? "draft-a";
  const bindingId = (overrides.project_parameter_binding_id as string) ?? "binding-a";
  const specId = (overrides.parameter_spec_id as string) ?? "spec-1";
  const tipId = (overrides.candidate_config_revision_id as string) ?? "candidate-tip-a";
  const targetValue = (overrides.target_value as string) ?? "<3000>";
  const reason = (overrides.reason as string) ?? "Edit A";
  const suffix = draftId.endsWith("b") ? "b" : "a";

  return {
    id: draftId,
    project_id: PROJECT_ID,
    project_parameter_binding_id: bindingId,
    parameter_spec_id: specId,
    candidate_config_revision_id: tipId,
    candidate_status: "draft",
    candidate_has_binding_revision: true,
    candidate_value_matches_draft: true,
    candidate_delete_tombstone: false,
    candidate_action_proven: true,
    write_lock_matches_binding: true,
    target_value: targetValue,
    action: "set",
    reason,
    base_config_revision_id: "base-rev-1",
    binding_revision_id: `bpr-${suffix}`,
    property_occurrence_id: null,
    source_file_version_id: `fv-${suffix}`,
    expected_checksum: `checksum-${suffix}`,
    occurrence_span: null,
    ...overrides
  };
}

function bindingParameterRow(bindingId: string, overrides: Record<string, unknown> = {}) {
  return parameterRow({
    id: bindingId,
    name: `binding_${bindingId}`,
    ...overrides
  });
}

function writeLockFixtureRows(suffix: "a" | "b") {
  return [
    [{ id: `bpr-${suffix}`, config_revision_id: "base-rev-1" }],
    [{ id: `fv-${suffix}`, checksum: `checksum-${suffix}` }]
  ] as const;
}

function enablementWriteLockFixtureRows() {
  return [[{ id: "fv-en", checksum: "checksum-en" }]] as const;
}

function enablementDraftSubmissionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: (overrides.id as string) ?? "draft-enablement",
    project_id: PROJECT_ID,
    logical_node_id: (overrides.logical_node_id as string) ?? "logical-node-1",
    candidate_config_revision_id: (overrides.candidate_config_revision_id as string) ?? "candidate-tip-en",
    candidate_status: "draft",
    candidate_has_status_effect: true,
    candidate_value_matches_draft: true,
    candidate_delete_tombstone: false,
    candidate_action_proven: true,
    write_lock_matches_revision: true,
    target_value: (overrides.target_value as string) ?? '"disabled"',
    action: "set",
    reason: (overrides.reason as string) ?? "Disable node",
    base_config_revision_id: "base-rev-1",
    binding_revision_id: null,
    property_occurrence_id: null,
    source_file_version_id: "fv-en",
    expected_checksum: "checksum-en",
    occurrence_span: null,
    ...overrides
  };
}

function enablementNodeContextRow() {
  return {
    node_locator: "/charging_core",
    compatible: "wiseeff,charging_core",
    logical_node_revision_id: "lnr-1"
  };
}

function enablementStatusEffectRows() {
  return [{ effect_kind: "set", raw_text: '"disabled"' }];
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

  it("non-admin cannot parse DTS for import", () => {
    expect(() =>
      parseDtsImportForAuth(makeAuth(), {
        sourceName: "board.dts",
        content: '/dts-v1/;\n&demo { status = "ok"; };\n'
      })
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }) as unknown as ApiError);
  });

  it("parseDtsImportForAuth no longer rejects /include/ at upload-parse time", () => {
    expect(() =>
      parseDtsImportForAuth(makeAdminAuth(), {
        sourceName: "board.dts",
        content: `/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n`
      })
    ).not.toThrow();
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

  it("preview rejects projects outside the organization", async () => {
    const { db, calls } = createFakeDb([
      [],
      (call) => [
        importBatchRow({
          summary: JSON.parse(call.values[6] as string),
          items: JSON.parse(call.values[7] as string)
        })
      ]
    ]);

    await expect(
      createImportPreview(db, makeAdminAuth(), {
        projectId: "foreign-project",
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
    ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization.", 404));

    expect(calls.some((call) => call.text.includes("insert into parameter_import_batches"))).toBe(false);
  });

  it("preview classifies added updated unchanged conflict and flags high-risk value deltas", async () => {
    const { db, calls, txCalls } = createFakeDb([
      [projectRow()],
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
          initSuggestionText: "68",
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
          initSuggestionText: "395",
          project_parameter_value_id: "param-conflict",
          value_version: 5
        })
      ],
      [],
      [],
      [changeRequestRow({ id: "request-open" })],
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
    const definitionLookupCall = calls.find((call) => call.text.includes("from parameter_definitions pd"));
    expect(definitionLookupCall?.values).toEqual([
      "org-1",
      "project-1",
      ["fast_charge_current_limit_ma", "thermal_guard_threshold_c", "new_balancing_window_s", "pack_voltage_limit_v"],
      []
    ]);
    expect(txCalls.some((call) => call.text.includes("insert into parameter_import_batches"))).toBe(true);
  });

  it("createImportPreview with reviewMetadata writes audit metadata containing skippedRows", async () => {
    const { db, calls, txCalls } = createFakeDb([
      [projectRow()],
      [],
      [
        (call) => [
          {
            id: call.values[0],
            project_id: "project-1",
            source_name: "board.dts",
            status: "previewed",
            summary: JSON.parse(call.values[6] as string),
            items: JSON.parse(call.values[7] as string),
            created_at: "2026-05-25T05:00:00.000Z",
            applied_at: null
          }
        ]
      ]
    ]);

    const reviewMetadata = {
      skippedRows: [{ name: "weak_source_sleep_enabled", module: "demo_bool", reason: "布尔属性暂不导入" }],
      notes: "wizard skip summary"
    };

    await createImportPreview(db, makeAdminAuth(), {
      projectId: "project-1",
      sourceName: "board.dts",
      items: [
        {
          name: "hex_value",
          module: "demo_integer",
          risk: "Low",
          unit: "-",
          range: "-",
          currentValue: "<0x220022>"
        }
      ],
      reviewMetadata
    });

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall).toBeDefined();
    expect(auditCall?.values).toContain("batch-import");
    expect(JSON.parse(auditCall?.values[11] as string)).toMatchObject({
      reviewMetadata
    });
  });

  it("createImportPreview without reviewMetadata does not write import audit", async () => {
    const { db, calls, txCalls } = createFakeDb([
      [projectRow()],
      [],
      [
        (call) => [
          {
            id: call.values[0],
            project_id: "project-1",
            source_name: "board.dts",
            status: "previewed",
            summary: JSON.parse(call.values[6] as string),
            items: JSON.parse(call.values[7] as string),
            created_at: "2026-05-25T05:00:00.000Z",
            applied_at: null
          }
        ]
      ]
    ]);

    await createImportPreview(db, makeAdminAuth(), {
      projectId: "project-1",
      sourceName: "board.dts",
      items: [
        {
          name: "hex_value",
          module: "demo_integer",
          risk: "Low",
          unit: "-",
          range: "-",
          currentValue: "<0x220022>"
        }
      ]
    });

    expect(calls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("applyImportBatch merges reviewMetadata into apply audit metadata", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [parameterRow()],
      [],
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

    const reviewMetadata = {
      skippedRows: [{ rowKey: "demo_bool/weak_source_sleep_enabled", reason: "skipped in wizard" }],
      notes: "final snapshot"
    };

    await applyImportBatch(
      db,
      makeAdminAuth(),
      {
        batchId: "batch-1",
        selectedItemIds: ["item-added", "item-updated"],
        reviewMetadata
      },
      { requestId: "request-import-apply-meta" }
    );

    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(JSON.parse(auditCall?.values[11] as string)).toMatchObject({
      batchId: "batch-1",
      reviewMetadata
    });
  });

  it("preview flags high-risk recommended value deltas without over-flagging zero or nonnumeric baselines", async () => {
    const { db } = createFakeDb([
      [projectRow()],
      [
        definitionRow({
          id: "definition-recommended-delta",
          name: "recommended_delta",
          current_value: "100",
          initSuggestionText: "100",
          project_parameter_value_id: "param-recommended-delta"
        }),
        definitionRow({
          id: "definition-zero-baseline",
          name: "zero_baseline_delta",
          current_value: "100",
          initSuggestionText: "0",
          project_parameter_value_id: "param-zero-baseline"
        }),
        definitionRow({
          id: "definition-nonnumeric-baseline",
          name: "nonnumeric_delta",
          current_value: "100",
          initSuggestionText: "auto",
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

  it("preview mints import-owned definition ids for added items with unmatched supplied ids", async () => {
    const { db } = createFakeDb([
      [projectRow()],
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
          id: "unmatched_caller_supplied_id",
          name: "new_unmatched_parameter",
          module: "Charging Policy",
          risk: "Medium",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "2500"
        }
      ]
    });

    expect(batch.items[0]).toMatchObject({
      id: "unmatched_caller_supplied_id",
      classification: "added"
    });
    expect(batch.items[0].definitionId).toMatch(/^import-[0-9a-f-]{36}$/);
    expect(batch.items[0].definitionId).not.toBe("unmatched_caller_supplied_id");
    expect(batch.items[0].projectParameterValueId).toBe(`project-1-${batch.items[0].definitionId}`);
  });

  it("apply creates added values, updates selected values, skips unselected items, and writes audit", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [parameterRow()],
      [],
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

    const applied = await applyImportBatch(
      db,
      makeAdminAuth(),
      {
        batchId: "batch-1",
        selectedItemIds: ["item-added", "item-updated"]
      },
      { requestId: "request-import-apply-1" }
    );

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
    expect(
      txCalls.find((call) => call.text.includes("insert into project_parameter_values") && call.values.includes("param-1"))
        ?.text
    ).toContain("insert into project_parameter_values");
    expect(txCalls.filter((call) => call.text.includes("parameter_history_entries"))).toHaveLength(2);
    const lockIndex = txCalls.findIndex((call) => call.text.includes("for update") && call.values.includes("param-1"));
    const finalRecheckIndex = txCalls.findIndex(
      (call, index) => index > lockIndex && call.text.includes("from parameter_change_requests pcr")
    );
    const updateIndex = txCalls.findIndex(
      (call) => call.text.includes("insert into project_parameter_values") && call.values.includes("param-1")
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(finalRecheckIndex).toBeGreaterThan(lockIndex);
    expect(updateIndex).toBeGreaterThan(finalRecheckIndex);
    expect(txCalls.find((call) => call.text.includes("update parameter_import_batches"))?.values).toEqual([
      "org-1",
      "batch-1"
    ]);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(auditCall?.values).toContain("batch-import");
    expect(auditCall?.values).toContain("parameter-import-batch");
    expect(auditCall?.values).toContain("batch-1");
    expect(auditCall?.values[12]).toBe("request-import-apply-1");
    expect(JSON.parse(auditCall?.values[11] as string)).toMatchObject({
      batchId: "batch-1",
      summary: { added: 1, updated: 1, skipped: 0 }
    });
  });

  it("apply defaults to eligible added and updated items without selecting conflicts", async () => {
    const mixedBatch = importBatchRow({
      summary: { added: 1, updated: 1, unchanged: 1, conflict: 1, highRisk: 1 },
      items: [
        ...importBatchRow().items,
        {
          id: "item-unchanged",
          name: "unchanged_threshold_c",
          module: "Thermal",
          risk: "Low",
          unit: "C",
          range: "40 - 90",
          currentValue: "72",
          classification: "unchanged",
          definitionId: "unchanged-threshold",
          projectParameterValueId: "param-unchanged",
          riskFlag: false
        },
        {
          id: "item-conflict",
          name: "conflicting_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "4000",
          classification: "conflict",
          definitionId: "definition-conflict",
          projectParameterValueId: "param-conflict",
          riskFlag: false
        }
      ]
    });
    const { db, txCalls } = createFakeDb([
      [mixedBatch],
      [projectRow()],
      [parameterRow()],
      [],
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

    const applied = await applyImportBatch(db, makeAdminAuth(), { batchId: "batch-1" });

    expect(applied.status).toBe("applied");
    expect(txCalls.some((call) => call.values.includes("definition-conflict"))).toBe(false);
    expect(txCalls.some((call) => call.values.includes("param-unchanged"))).toBe(false);
    expect(txCalls.find((call) => call.text.includes("update parameter_import_batches"))?.values).toEqual([
      "org-1",
      "batch-1"
    ]);
    const auditCall = txCalls.find((call) => call.text.includes("insert into audit_events"));
    expect(JSON.parse(auditCall?.values[11] as string)).toMatchObject({
      batchId: "batch-1",
      summary: { added: 1, updated: 1, skipped: 2 }
    });
  });

  it("apply rejects batches whose project is outside the organization", async () => {
    const foreignProjectBatch = importBatchRow({ project_id: "foreign-project" });
    const { db, txCalls } = createFakeDb([
      [foreignProjectBatch],
      [],
      [
        {
          id: "item-added",
          definition_id: "thermal_guard_threshold_c",
          project_parameter_value_id: "project-1-thermal_guard_threshold_c",
          new_version: 1
        }
      ],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-added"]
      })
    ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization.", 404));

    expect(txCalls.some((call) => call.text.includes("insert into project_parameter_values"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply rejects unknown selected item ids", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-missing"]
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Selected import item was not found in the batch.", 400));

    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply rejects an empty selected item list without consuming the batch", async () => {
    const { db, txCalls } = createFakeDb([[importBatchRow()]]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: []
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "At least one import item must be selected.", 400));

    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply rejects when selected items contain no eligible import changes", async () => {
    const unchangedBatch = importBatchRow({
      summary: { added: 0, updated: 0, unchanged: 1, conflict: 0, highRisk: 0 },
      items: [
        {
          id: "item-unchanged",
          name: "fast_charge_current_limit_ma",
          module: "Charging Policy",
          risk: "High",
          unit: "mA",
          range: "1000 - 5000",
          currentValue: "3200",
          classification: "unchanged",
          definitionId: "definition-1",
          projectParameterValueId: "param-1",
          riskFlag: false
        }
      ]
    });
    const { db, txCalls } = createFakeDb([[unchangedBatch], [projectRow()]]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-unchanged"]
      })
    ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "At least one eligible import item must be selected.", 400));

    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply rejects added definition id collisions", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [],
      [importBatchRow({ status: "applied", applied_at: "2026-05-25T07:00:00.000Z" })],
      []
    ]);

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-added"]
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Import item definition id already exists.", 409));

    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("insert into audit_events"))).toBe(false);
  });

  it("apply rejects open requests found after locking target values", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [parameterRow()],
      [changeRequestRow({ id: "request-open-after-lock" })],
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

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-updated"]
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409));

    const lockIndex = txCalls.findIndex((call) => call.text.includes("for update") && call.values.includes("param-1"));
    const recheckIndex = txCalls.findIndex(
      (call, index) => index > lockIndex && call.text.includes("from parameter_change_requests pcr")
    );
    expect(lockIndex).toBeGreaterThan(-1);
    expect(recheckIndex).toBeGreaterThan(lockIndex);
    expect(txCalls.some((call) => call.text.includes("insert into project_parameter_values"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply rechecks open requests created after preview", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [parameterRow()],
      [changeRequestRow({ id: "request-open-after-preview" })],
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

    await expect(
      applyImportBatch(db, makeAdminAuth(), {
        batchId: "batch-1",
        selectedItemIds: ["item-updated"]
      })
    ).rejects.toMatchObject(new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409));

    expect(txCalls.some((call) => call.text.includes("insert into project_parameter_values"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update parameter_import_batches"))).toBe(false);
  });

  it("apply skips unselected items", async () => {
    const { db, txCalls } = createFakeDb([
      [importBatchRow()],
      [projectRow()],
      [parameterRow()],
      [],
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
    expect(
      txCalls.find((call) => call.text.includes("insert into project_parameter_values") && call.values.includes("param-1"))
        ?.text
    ).toContain("insert into project_parameter_values");
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
      [projectRow()],
      [parameterRow()],
      [],
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

    const applyCall = txCalls.find(
      (call) => call.text.includes("insert into parameter_definitions") && call.values.includes("param-1")
    );
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
      [projectRow()],
      [],
      [],
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

    const applyCall = txCalls.find(
      (call) =>
        call.text.includes("insert into project_parameter_values") && call.values.includes("project-1-definition-orphan")
    );
    expect(applyCall?.text).toContain("insert into project_parameter_values");
    expect(applyCall?.text).toContain("inserted_value as");
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
    const { db, txCalls } = createFakeDb([[conflictBatch], [projectRow()]]);

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

  it("rejects saving a draft for a project the editor is not bound to", async () => {
    const { db, calls } = createFakeDb();

    // software-user on project-1 carries the flat parameter:edit permission, but
    // must not be able to write drafts into project-2.
    await expect(
      saveDraft(db, makeAuth({ roles: [{ projectId: "project-1", roleId: "software-user" }] }), {
        projectId: "project-2",
        parameterId: "param-1",
        targetValue: "3100",
        reason: "cross-project"
      })
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project.", 403));

    expect(calls).toHaveLength(0);
  });

  it("rejects submitting a change round for a project the editor is not bound to", async () => {
    const { db, txCalls } = createFakeDb();

    await expect(
      submitParameterChanges(
        db,
        makeAuth({ roles: [{ projectId: "project-1", roleId: "software-user" }] }),
        {
          projectId: "project-2",
          items: [
            {
              draftId: "draft-x",
              projectParameterBindingId: "binding-x",
              parameterSpecId: "spec-x",
              action: "set",
              targetValue: "<3000>",
              reason: "cross-project"
            }
          ]
        },
        { requestId: "req-cross" }
      )
    ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project.", 403));

    expect(txCalls).toHaveLength(0);
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
      action: "set",
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

  it("submitParameterChanges rejects mixed working tips in one batch", async () => {
    const draftA = "draft-a";
    const draftB = "draft-b";
    const bindingA = "binding-a";
    const bindingB = "binding-b";
    const specId = "spec-1";
    const tipA = "candidate-tip-a";
    const tipB = "candidate-tip-b";

    const { db, txCalls } = createFakeDb(
      [
        [
          bindingDraftSubmissionRow({
            id: draftA,
            project_parameter_binding_id: bindingA,
            parameter_spec_id: specId,
            candidate_config_revision_id: tipA,
            target_value: "<3000>",
            reason: "a"
          })
        ],
        ...writeLockFixtureRows("a"),
        [bindingParameterRow(bindingA)],
        [],
        [
          bindingDraftSubmissionRow({
            id: draftB,
            project_parameter_binding_id: bindingB,
            parameter_spec_id: "spec-2",
            candidate_config_revision_id: tipB,
            target_value: "<4000>",
            reason: "b"
          })
        ],
        ...writeLockFixtureRows("b"),
        [bindingParameterRow(bindingB)],
        [],
        [{ id: "u-hardware" }],
        [{ id: "u-software-committer" }],
        [{ id: "u-software-user" }]
      ],
      { semanticCutoverComplete: true }
    );

    await expect(
      submitParameterChanges(db, makeAuth(), {
        projectId: PROJECT_ID,
        items: [
          {
            draftId: draftA,
            projectParameterBindingId: bindingA,
            parameterSpecId: specId,
            action: "set",
            targetValue: "<3000>",
            reason: "a"
          },
          {
            draftId: draftB,
            projectParameterBindingId: bindingB,
            parameterSpecId: "spec-2",
            action: "set",
            targetValue: "<4000>",
            reason: "b"
          }
        ],
        assignees: completeAssignees
      })
    ).rejects.toMatchObject(
      new ApiError(
        "CONFLICT",
        "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
        409,
        {
          reason: "mixed-working-tips",
          candidateConfigRevisionIds: expect.arrayContaining([tipA, tipB])
        }
      )
    );

    expect(txCalls.some((call) => call.text.includes("insert into parameter_submission_rounds"))).toBe(false);
    expect(txCalls.some((call) => call.text.includes("update dts_config_revisions"))).toBe(false);
  });

  it("submitParameterChanges creates enablement change requests from node-enablement drafts", async () => {
    const draftId = "draft-enablement";
    const logicalNodeId = "logical-node-1";
    const tipId = "candidate-tip-en";

    const { db, txCalls } = createFakeDb(
      [
        [enablementDraftSubmissionRow({ id: draftId, logical_node_id: logicalNodeId, candidate_config_revision_id: tipId })],
        ...enablementWriteLockFixtureRows(),
        [],
        [enablementNodeContextRow()],
        enablementStatusEffectRows(),
        [],
        [{ id: tipId }],
        [
          {
            id: "round-1",
            project_id: PROJECT_ID,
            project_name: "Aurora",
            submitter: "Riley Chen",
            status: "submitted",
            summary: "Parameter changes submitted.",
            created_at: "2026-05-25T05:00:00.000Z"
          }
        ],
        [
          {
            id: "request-enablement",
            submission_round_id: "round-1",
            project_id: PROJECT_ID,
            project_parameter_value_id: logicalNodeId,
            module: "charging_core",
            title: "status",
            current_value: "",
            target_value: '"disabled"',
            action: "set",
            candidate_config_revision_id: tipId,
            edit_subject_kind: "node-enablement",
            logical_node_id: logicalNodeId,
            submitter: "Riley Chen",
            status: "submitted",
            risk: "Low",
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
            change_request_id: "request-enablement",
            project_parameter_value_id: logicalNodeId,
            name: "status",
            module: "节点启用",
            current_value: "",
            target_value: '"disabled"',
            action: "set",
            candidate_config_revision_id: tipId,
            unit: "",
            risk: "Low",
            reason: "Disable node"
          }
        ],
        [],
        []
      ],
      { semanticCutoverComplete: true }
    );

    const round = await submitParameterChanges(db, makeAuth(), {
      projectId: PROJECT_ID,
      items: [
        {
          draftId,
          editSubjectKind: "node-enablement",
          logicalNodeId,
          action: "set",
          targetValue: '"disabled"',
          reason: "Disable node"
        }
      ]
    });

    expect(round.items).toHaveLength(1);
    expect(txCalls.some((call) => call.text.includes("edit_subject_kind") && call.text.includes("node-enablement"))).toBe(
      true
    );
    expect(txCalls.some((call) => call.text.includes("delete from parameter_drafts"))).toBe(true);
  });

  describe("post-cutover semantic merge fail-closed preflight", () => {
    const mergeAuth = () =>
      makeAuth({
        roles: [{ projectId: null, roleId: "admin" }],
        permissions: [
          "parameter:view",
          "parameter:edit",
          "parameter:review",
          "parameter:merge",
          "admin:access"
        ]
      });

    // The objectStore-missing, binding-identity-missing, and env-bypass preflight
    // cases live in serviceReviewWorkflow.integration.test.ts. This one stays on
    // the fake db because parameter_change_requests.project_id is NOT NULL, so a
    // project-less request cannot exist in a real database.
    it("rejects semantic merge when projectId is missing", async () => {
      const { db, txCalls } = createFakeDb(
        [[changeRequestRow({ status: "software_merge", risk: "Medium", project_id: null })], []],
        { semanticCutoverComplete: true }
      );

      await expect(
        reviewChange(
          db,
          mergeAuth(),
          { requestId: "request-1", decision: "advance", expectedVersion: 7, note: "https://example.com/mr/semantic" },
          { objectStore: { get: async () => Buffer.alloc(0), put: async () => ({ storageKey: "x", checksumSha256: "y", fileSizeBytes: 0 }) } as never }
        )
      ).rejects.toMatchObject(
        new ApiError("CONFLICT", "Semantic merge requires a project-scoped change request.", 409, {
          requestId: "request-1"
        })
      );

      expect(txCalls.some((call) => call.values?.includes("parameter-merge"))).toBe(false);
    });
  });
});
