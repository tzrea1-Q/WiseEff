import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  getImportBatchForUpdate,
  insertImportBatch,
  listParameterDefinitionsForImport,
  markImportBatchApplied
} from "./importBatchRepository";

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

describe("import batch repository", () => {
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
          initSuggestionText: "3000",
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
});
