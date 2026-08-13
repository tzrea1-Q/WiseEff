/**
 * Behavior-level integration coverage for the parameter read repository:
 * list filters, by-id reads, and history ordering against a real database.
 * Asserts returned DTOs and subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { getParameterById, listParameterHistory, listParameters } from "./repository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter repository", () => {
  let db: InMemoryTestDatabase;

  async function seedDefinitionWithValue(input: {
    definitionId: string;
    valueId: string;
    organizationId?: string;
    projectId: string;
    name: string;
    description?: string;
    module?: string;
    risk?: string;
    currentValue?: string;
    recommendedValue?: string;
    valueVersion?: number;
    sourceFileName?: string | null;
    sourceNodePath?: string | null;
    updatedAt?: string;
  }) {
    const organizationId = input.organizationId ?? "org-1";
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ($1, $2, $3, $4, 'Controls fast charging current.', 'ENV: FAST_CHARGE_CURRENT=number', $5, '1000 - 5000', 'mA', $6)`,
      [
        input.definitionId,
        organizationId,
        input.name,
        input.description ?? "Limit fast charge current.",
        input.module ?? "Charging Policy",
        input.risk ?? "High"
      ]
    );
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id,
         source_file_name, source_node_path, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, 'user-1', $8, $9, $10)`,
      [
        input.valueId,
        organizationId,
        input.projectId,
        input.definitionId,
        input.currentValue ?? "3200",
        input.recommendedValue ?? "3000",
        input.valueVersion ?? 1,
        input.sourceFileName ?? null,
        input.sourceNodePath ?? null,
        input.updatedAt ?? "2026-05-25T02:00:00.000Z"
      ]
    );
  }

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Xu Yun", email: "xu@example.com" }],
      projects: [
        { id: "aurora", name: "Aurora", code: "AUR" },
        { id: "borealis", name: "Borealis", code: "BOR" }
      ]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "Foreign Org" },
      users: [{ id: "user-foreign", name: "Foreign User", email: "foreign@example.com" }],
      projects: [{ id: "project-foreign", name: "Foreign", code: "FRN" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  it("listParameters applies project, module, risk, and query filters together", async () => {
    // The one row every filter matches.
    await seedDefinitionWithValue({
      definitionId: "pd-fast",
      valueId: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      updatedAt: "2026-05-25T02:00:00.000Z"
    });
    // Wrong module.
    await seedDefinitionWithValue({
      definitionId: "pd-thermal",
      valueId: "aurora-thermal",
      projectId: "aurora",
      name: "fast_charge_thermal_guard_c",
      module: "Thermal",
      updatedAt: "2026-05-24T02:00:00.000Z"
    });
    // Risk below the requested levels.
    await seedDefinitionWithValue({
      definitionId: "pd-low",
      valueId: "aurora-low-risk",
      projectId: "aurora",
      name: "fast_charge_led_blink_ms",
      risk: "Low",
      updatedAt: "2026-05-23T02:00:00.000Z"
    });
    // Name, description, and explanation all miss the search term.
    await seedDefinitionWithValue({
      definitionId: "pd-unrelated",
      valueId: "aurora-unrelated",
      projectId: "aurora",
      name: "pack_voltage_limit_v",
      description: "Pack voltage ceiling.",
      updatedAt: "2026-05-22T02:00:00.000Z"
    });
    // Same shape in another project.
    await seedDefinitionWithValue({
      definitionId: "pd-borealis",
      valueId: "borealis-fast-charge",
      projectId: "borealis",
      name: "fast_charge_current_limit_ma_b"
    });
    // Same shape in another organization.
    await seedDefinitionWithValue({
      definitionId: "pd-foreign",
      valueId: "foreign-fast-charge",
      organizationId: "org-2",
      projectId: "project-foreign",
      name: "fast_charge_current_limit_ma_f"
    });

    const rows = await listParameters(db, {
      organizationId: "org-1",
      projectId: "aurora",
      module: "Charging Policy",
      risk: ["High", "Medium"],
      q: "fast_charge",
      limit: 25
    });

    expect(rows.map((row) => row.id)).toEqual(["aurora-fast-charge-current"]);
    expect(rows[0]).toMatchObject({
      id: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "3200",
      recommendedValue: "3000",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      risk: "High",
      unit: "mA",
      range: "1000 - 5000",
      updatedAt: "2026-05-25T02:00:00.000Z",
      updatedAtTs: "2026-05-25T02:00:00.000Z",
      history: []
    });
  });

  it("listParameters orders by updated_at descending and honors the limit", async () => {
    await seedDefinitionWithValue({
      definitionId: "pd-newest",
      valueId: "aurora-newest",
      projectId: "aurora",
      name: "newest_parameter",
      updatedAt: "2026-05-25T02:00:00.000Z"
    });
    await seedDefinitionWithValue({
      definitionId: "pd-middle",
      valueId: "aurora-middle",
      projectId: "aurora",
      name: "middle_parameter",
      updatedAt: "2026-05-24T02:00:00.000Z"
    });
    await seedDefinitionWithValue({
      definitionId: "pd-oldest",
      valueId: "aurora-oldest",
      projectId: "aurora",
      name: "oldest_parameter",
      updatedAt: "2026-05-23T02:00:00.000Z"
    });

    const rows = await listParameters(db, { organizationId: "org-1", projectId: "aurora", limit: 2 });

    expect(rows.map((row) => row.id)).toEqual(["aurora-newest", "aurora-middle"]);
  });

  it("getParameterById maps source fields and loads history", async () => {
    await seedDefinitionWithValue({
      definitionId: "pd-fast",
      valueId: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      valueVersion: 2
    });
    await db.query(
      `insert into parameter_change_requests (
         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
         base_version, current_value, target_value, status, submitter_user_id
       ) values ('req-1', 'org-1', 'aurora', 'aurora-fast-charge-current', 'pd-fast', 1, '3200', '3300', 'merged', 'user-1')`
    );
    await db.query(
      `insert into parameter_history_entries (
         id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
         version, value, changed_by_user_id, request_id, changed_at
       ) values ('hist-2', 'org-1', 'aurora', 'pd-fast', 'aurora-fast-charge-current', 2, '3300', 'user-1', 'req-1', '2026-05-25T04:00:00.000Z')`
    );

    const row = await getParameterById(db, {
      organizationId: "org-1",
      parameterId: "aurora-fast-charge-current"
    });

    expect(row).toMatchObject({
      id: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      sourceFileName: "config.json",
      sourceNodePath: "battery/temp_max",
      history: [
        {
          version: "2",
          value: "3300",
          changedAt: "2026-05-25T04:00:00.000Z",
          changedBy: "Xu Yun",
          requestId: "req-1"
        }
      ]
    });
  });

  it("getParameterById returns null for missing and cross-organization ids", async () => {
    await seedDefinitionWithValue({
      definitionId: "pd-foreign",
      valueId: "foreign-parameter",
      organizationId: "org-2",
      projectId: "project-foreign",
      name: "foreign_parameter"
    });

    await expect(
      getParameterById(db, { organizationId: "org-1", parameterId: "missing" })
    ).resolves.toBeNull();
    // The row exists but belongs to another organization.
    await expect(
      getParameterById(db, { organizationId: "org-1", parameterId: "foreign-parameter" })
    ).resolves.toBeNull();
  });

  it("listParameterHistory orders entries by changed time descending and maps fallbacks", async () => {
    await seedDefinitionWithValue({
      definitionId: "pd-fast",
      valueId: "aurora-fast-charge-current",
      projectId: "aurora",
      name: "fast_charge_current_limit_ma",
      valueVersion: 2
    });
    await db.query(
      `insert into parameter_change_requests (
         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
         base_version, current_value, target_value, status, submitter_user_id
       ) values ('req-1', 'org-1', 'aurora', 'aurora-fast-charge-current', 'pd-fast', 1, '3200', '3300', 'merged', 'user-1')`
    );
    // Insert the newer entry first so descending order cannot come from insertion order.
    await db.query(
      `insert into parameter_history_entries (
         id, organization_id, project_id, parameter_definition_id, project_parameter_value_id,
         version, value, changed_by_user_id, request_id, changed_at
       ) values
         ('hist-2', 'org-1', 'aurora', 'pd-fast', 'aurora-fast-charge-current', 2, '3300', 'user-1', 'req-1', '2026-05-25T04:00:00.000Z'),
         ('hist-1', 'org-1', 'aurora', 'pd-fast', 'aurora-fast-charge-current', 1, '3200', null, null, '2026-05-25T01:00:00.000Z')`
    );

    const rows = await listParameterHistory(db, {
      organizationId: "org-1",
      parameterId: "aurora-fast-charge-current"
    });

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
});
