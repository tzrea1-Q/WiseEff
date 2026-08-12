import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import {
  deleteDraft,
  getImportBatchForUpdate,
  getParameterById,
  hasOpenFileSyncConflict,
  insertFileSyncConflict,
  insertImportBatch,
  listDraftsForParameterValue,
  listDraftsForUser,
  listOpenBindingDraftsForUser,
  listOpenConflicts,
  listParameterHistory,
  listParameters,
  listParameterDefinitionsForImport,
  rebaseOpenBindingDraftCandidates,
  applyAddedImportItem,
  applyUpdatedImportItem,
  markImportBatchApplied,
  resolveConflict,
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

describe("parameter repository", () => {
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
        initSuggestionText: "3000",
        source_file_name: "config.json",
        source_node_path: "battery/temp_max",
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

    expect(calls[0].text).toContain("ppv.source_file_name");
    expect(calls[0].text).toContain("ppv.source_node_path");
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
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      risk: "High",
      updatedAt: "2026-05-25T02:00:00.000Z",
      updatedAtTs: "2026-05-25T02:00:00.000Z",
      history: []
    });
  });

  it("getParameterById maps source fields and loads history", async () => {
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
        initSuggestionText: "3000",
        source_file_name: "config.json",
        source_node_path: "battery/temp_max",
        updated_at: updatedAt
      },
      []
    ]);

    const row = await getParameterById(db, {
      organizationId: "org-chargelab",
      parameterId: "aurora-fast-charge-current"
    });

    expect(calls[0].text).toContain("ppv.source_file_name");
    expect(calls[0].text).toContain("ppv.source_node_path");
    expect(calls[0].values).toEqual(["org-chargelab", "aurora-fast-charge-current"]);
    expect(row).toMatchObject({
      id: "aurora-fast-charge-current",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
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
