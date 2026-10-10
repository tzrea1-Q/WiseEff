/**
 * Behavior-level integration coverage for the import batch repository:
 * jsonb provenance persistence and cross-organization read guards against a real database.
 * Asserts returned DTOs and subsequent reads — never SQL text.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  getImportBatchForUpdate,
  insertImportBatch,
  type PersistedImportBatchItem
} from "./importBatchRepository";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("import batch repository", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
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

  function importItem(overrides: Partial<PersistedImportBatchItem> = {}): PersistedImportBatchItem {
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

});
