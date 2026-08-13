/**
 * Behavior-level integration coverage for the import batch repository:
 * candidate matching, jsonb batch persistence, added/updated item application
 * with history rows, and cross-organization guards against a real database.
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
import {
  applyAddedImportItem,
  applyUpdatedImportItem,
  getImportBatchForUpdate,
  insertImportBatch,
  listParameterDefinitionsForImport,
  markImportBatchApplied
} from "./importBatchRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("import batch repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-chargelab", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });
    await seedCoreGraph(db, {
      organization: { id: "org-foreign", name: "Foreign Org" },
      users: [{ id: "user-foreign", name: "Foreign User", email: "foreign@example.com" }],
      projects: [{ id: "project-foreign", name: "Foreign", code: "FRN" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
  });

  async function seedDefinition(input: {
    id: string;
    organizationId?: string;
    name: string;
    module?: string;
    risk?: string;
    unit?: string;
    range?: string;
  }) {
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ($1, $2, $3, 'Limit fast charge current.', 'Controls fast charging current.', 'ENV: FAST_CHARGE_CURRENT=number', $4, $5, $6, $7)`,
      [
        input.id,
        input.organizationId ?? "org-chargelab",
        input.name,
        input.module ?? "Charging Policy",
        input.range ?? "1000 - 5000",
        input.unit ?? "mA",
        input.risk ?? "High"
      ]
    );
  }

  async function seedValue(input: {
    id: string;
    organizationId?: string;
    projectId?: string;
    definitionId: string;
    currentValue?: string;
    recommendedValue?: string;
    valueVersion?: number;
  }) {
    await db.query(
      `insert into project_parameter_values (
         id, organization_id, project_id, parameter_definition_id,
         current_value, recommended_value, value_version, updated_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7, null)`,
      [
        input.id,
        input.organizationId ?? "org-chargelab",
        input.projectId ?? "project-1",
        input.definitionId,
        input.currentValue ?? "3200",
        input.recommendedValue ?? "3000",
        input.valueVersion ?? 7
      ]
    );
  }

  function importItem(overrides: Partial<Parameters<typeof applyAddedImportItem>[1]["item"]> = {}) {
    return {
      id: "item-1",
      name: "thermal_guard_threshold_c",
      module: "Thermal",
      risk: "Medium" as const,
      unit: "C",
      range: "40 - 90",
      currentValue: "72",
      recommendedValue: "70",
      description: "Thermal guard threshold.",
      explanation: "Guards the pack from overheating.",
      configFormat: "ENV: THERMAL_GUARD=number",
      classification: "added" as const,
      riskFlag: false,
      definitionId: "thermal_guard_threshold_c",
      projectParameterValueId: "project-1-thermal_guard_threshold_c",
      ...overrides
    };
  }

  async function readValue(valueId: string) {
    const result = await db.query<{
      current_value: string;
      recommended_value: string;
      value_version: number;
      parameter_definition_id: string;
    }>(
      `select current_value, recommended_value, value_version, parameter_definition_id
       from project_parameter_values where id = $1`,
      [valueId]
    );
    return result.rows[0];
  }

  async function readHistory(valueId: string) {
    const result = await db.query<{ version: number; value: string; changed_by_user_id: string | null }>(
      `select version, value, changed_by_user_id from parameter_history_entries
       where project_parameter_value_id = $1 order by version asc`,
      [valueId]
    );
    return result.rows;
  }

  it("lists import match candidates by definition id or name within the organization and project", async () => {
    await seedDefinition({ id: "definition-1", name: "fast_charge_current_limit_ma" });
    await seedValue({ id: "param-1", definitionId: "definition-1" });
    // Matched by id even though the name differs from the query names.
    await seedDefinition({ id: "definition-2", name: "pack_voltage_limit_v", module: "Power", unit: "V", range: "300 - 450" });
    // Matched definition whose only value lives in another project: no value columns surface.
    await seedDefinition({ id: "definition-other-project", name: "thermal_guard_threshold_c", module: "Thermal" });
    await seedValue({ id: "param-other-project", projectId: "project-2", definitionId: "definition-other-project" });
    // Same name in a foreign organization must not leak.
    await seedDefinition({ id: "definition-foreign", organizationId: "org-foreign", name: "fast_charge_current_limit_ma" });
    // Neither name nor id requested.
    await seedDefinition({ id: "definition-unrelated", name: "unrelated_parameter" });

    const rows = await listParameterDefinitionsForImport(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      names: ["fast_charge_current_limit_ma", "thermal_guard_threshold_c"],
      definitionIds: ["definition-2"]
    });

    expect(rows.map((row) => row.id)).toEqual([
      "definition-1",
      "definition-2",
      "definition-other-project"
    ]);
    expect(rows[0]).toMatchObject({
      id: "definition-1",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      range: "1000 - 5000",
      unit: "mA",
      risk: "High",
      projectParameterValueId: "param-1",
      currentValue: "3200",
      recommendedValue: "3000",
      valueVersion: 7
    });
    // definition-2 has no project value at all; definition-other-project only in project-2.
    expect(rows[1].projectParameterValueId).toBeUndefined();
    expect(rows[2].projectParameterValueId).toBeUndefined();
    expect(rows[2].valueVersion).toBeUndefined();
  });

  it("inserts and reloads import preview batches with jsonb payload fidelity", async () => {
    const items = [importItem({ riskFlag: true })];
    const summary = { added: 1, updated: 0, unchanged: 0, conflict: 0, highRisk: 1 };

    const inserted = await insertImportBatch(db, {
      id: "batch-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      createdByUserId: "user-1",
      sourceName: "admin-upload.csv",
      summary,
      items
    });

    expect(inserted).toMatchObject({
      id: "batch-1",
      projectId: "project-1",
      sourceName: "admin-upload.csv",
      status: "previewed",
      summary,
      items
    });
    expect(inserted.appliedAt).toBeUndefined();

    const loaded = await getImportBatchForUpdate(db, {
      organizationId: "org-chargelab",
      batchId: "batch-1"
    });
    expect(loaded).toEqual(inserted);

    // Organization scoping: another organization cannot load the batch.
    await expect(
      getImportBatchForUpdate(db, { organizationId: "org-foreign", batchId: "batch-1" })
    ).resolves.toBeNull();
  });

  it("applies added and updated items with history rows and marks the batch applied", async () => {
    await seedDefinition({ id: "definition-1", name: "fast_charge_current_limit_ma" });
    await seedValue({ id: "param-1", definitionId: "definition-1", valueVersion: 7 });
    await insertImportBatch(db, {
      id: "batch-1",
      organizationId: "org-chargelab",
      projectId: "project-1",
      createdByUserId: "user-1",
      sourceName: "admin-upload.csv",
      summary: { added: 1, updated: 1, unchanged: 0, conflict: 0, highRisk: 1 },
      items: [importItem()]
    });

    const added = await applyAddedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-added",
      item: importItem()
    });
    expect(added).toEqual({
      id: "project-1-thermal_guard_threshold_c",
      definitionId: "thermal_guard_threshold_c",
      projectParameterValueId: "project-1-thermal_guard_threshold_c",
      newVersion: 1
    });
    expect(await readValue("project-1-thermal_guard_threshold_c")).toMatchObject({
      current_value: "72",
      recommended_value: "70",
      value_version: 1,
      parameter_definition_id: "thermal_guard_threshold_c"
    });
    expect(await readHistory("project-1-thermal_guard_threshold_c")).toEqual([
      { version: 1, value: "72", changed_by_user_id: "user-1" }
    ]);

    const updated = await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated",
      item: importItem({
        id: "item-updated",
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        risk: "High",
        unit: "mA",
        range: "1000 - 5000",
        currentValue: "4000",
        recommendedValue: "3800",
        classification: "updated",
        definitionId: "definition-1",
        projectParameterValueId: "param-1"
      })
    });
    expect(updated).toEqual({
      id: "param-1",
      definitionId: "definition-1",
      projectParameterValueId: "param-1",
      newVersion: 8
    });
    expect(await readValue("param-1")).toMatchObject({
      current_value: "4000",
      recommended_value: "3800",
      value_version: 8
    });
    expect(await readHistory("param-1")).toEqual([{ version: 8, value: "4000", changed_by_user_id: "user-1" }]);

    const applied = await markImportBatchApplied(db, { organizationId: "org-chargelab", batchId: "batch-1" });
    expect(applied).toMatchObject({ id: "batch-1", status: "applied" });
    expect(applied?.appliedAt).toBeTruthy();
  });

  it("updated items upsert definition metadata and create missing project values", async () => {
    // Definition exists (stale metadata) but the project has no value row yet.
    await seedDefinition({
      id: "definition-1",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      unit: "mA",
      range: "1000 - 5000"
    });

    const applied = await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated-metadata",
      item: importItem({
        id: "item-updated-metadata",
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy V2",
        risk: "High",
        unit: "mA",
        range: "500 - 4500",
        currentValue: "4100",
        recommendedValue: "3900",
        description: "Updated definition description.",
        explanation: "Updated explanation.",
        configFormat: "ENV: FAST_CHARGE_CURRENT_V2=number",
        classification: "updated",
        definitionId: "definition-1",
        projectParameterValueId: "project-1-definition-1"
      })
    });

    expect(applied).toEqual({
      id: "project-1-definition-1",
      definitionId: "definition-1",
      projectParameterValueId: "project-1-definition-1",
      newVersion: 1
    });
    const definition = await db.query<{
      module: string;
      default_range: string;
      description: string;
      explanation: string;
      config_format: string;
    }>(`select module, default_range, description, explanation, config_format from parameter_definitions where id = 'definition-1'`);
    expect(definition.rows[0]).toEqual({
      module: "Charging Policy V2",
      default_range: "500 - 4500",
      description: "Updated definition description.",
      explanation: "Updated explanation.",
      config_format: "ENV: FAST_CHARGE_CURRENT_V2=number"
    });
    expect(await readValue("project-1-definition-1")).toMatchObject({
      current_value: "4100",
      recommended_value: "3900",
      value_version: 1
    });
    expect(await readHistory("project-1-definition-1")).toEqual([
      { version: 1, value: "4100", changed_by_user_id: "user-1" }
    ]);
  });

  it("updated items with unchanged values report the existing version without new history", async () => {
    await seedDefinition({ id: "definition-1", name: "fast_charge_current_limit_ma" });
    await seedValue({
      id: "param-1",
      definitionId: "definition-1",
      currentValue: "3200",
      recommendedValue: "3000",
      valueVersion: 7
    });

    const applied = await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-noop",
      item: importItem({
        id: "item-noop",
        name: "fast_charge_current_limit_ma",
        currentValue: "3200",
        recommendedValue: "3000",
        classification: "updated",
        definitionId: "definition-1",
        projectParameterValueId: "param-1"
      })
    });

    // The value row is untouched: same version, no history entry appended.
    expect(applied).toEqual({
      id: "param-1",
      definitionId: "definition-1",
      projectParameterValueId: "param-1",
      newVersion: 7
    });
    expect(await readValue("param-1")).toMatchObject({ current_value: "3200", value_version: 7 });
    expect(await readHistory("param-1")).toEqual([]);
  });

  it("definition upserts do not bind cross-organization id conflicts", async () => {
    // The definition id exists, but in a different organization.
    await seedDefinition({
      id: "definition-cross-org",
      organizationId: "org-foreign",
      name: "fast_charge_current_limit_ma",
      module: "Foreign Module"
    });
    const item = importItem({
      id: "item-cross-org",
      name: "fast_charge_current_limit_ma",
      module: "Charging Policy",
      currentValue: "4100",
      recommendedValue: "3900",
      definitionId: "definition-cross-org",
      projectParameterValueId: "project-1-definition-cross-org"
    });

    const added = await applyAddedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-added-cross-org",
      item
    });
    const updated = await applyUpdatedImportItem(db, {
      organizationId: "org-chargelab",
      projectId: "project-1",
      actorUserId: "user-1",
      historyId: "history-updated-cross-org",
      item: { ...item, classification: "updated" }
    });

    expect(added).toBeNull();
    expect(updated).toBeNull();
    // The foreign organization's definition is untouched and no local rows appeared.
    const foreign = await db.query<{ organization_id: string; module: string }>(
      `select organization_id, module from parameter_definitions where id = 'definition-cross-org'`
    );
    expect(foreign.rows).toEqual([{ organization_id: "org-foreign", module: "Foreign Module" }]);
    await expect(readValue("project-1-definition-cross-org")).resolves.toBeUndefined();
    expect(await readHistory("project-1-definition-cross-org")).toEqual([]);
  });
});
