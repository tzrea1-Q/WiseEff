/**
 * Parameter service coverage.
 *
 * Import preview/apply and draft/submission guard behaviors run against a real
 * database (`createInMemoryTestDatabase`), asserting returned DTOs and
 * subsequent reads — never SQL text. Review-workflow behaviors live in
 * serviceReviewWorkflow.integration.test.ts.
 *
 * Semantic draft submission likewise uses the public service seam with real
 * candidate, occurrence, and write-lock rows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph, seedSpecBindingGraph } from "../../testing/fixtures";
import {
  applyImportBatch,
  createImportPreview,
  listDrafts,
  parseDtsImportForAuth,
  saveDraft,
  submitParameterChanges
} from "./service";
import { createImportBatchBodySchema } from "./schemas";

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

describe("parameter service DTS parse authorization", () => {
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
});

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("parameter service", () => {
  let db: InMemoryTestDatabase;

  beforeEach(async () => {
    setParameterIdentityMode(null);
    db = await createInMemoryTestDatabase();
    await seedCoreGraph(db, {
      organization: { id: "org-1", name: "ChargeLab" },
      users: [{ id: "user-1", name: "Riley Chen", email: "riley@example.com" }],
      projects: [
        { id: "project-1", name: "Aurora", code: "AUR" },
        { id: "project-2", name: "Borealis", code: "BOR" }
      ]
    });
    // Foreign organization owns a project whose id we can smuggle into batches.
    await seedCoreGraph(db, {
      organization: { id: "org-2", name: "Foreign Org" },
      users: [{ id: "user-foreign", name: "Foreign User", email: "foreign@example.com" }],
      projects: [{ id: "project-foreign", name: "Foreign", code: "FRN" }]
    });
  });

  afterEach(async () => {
    await db?.rollback();
    setParameterIdentityMode(null);
  });

  async function seedDefinition(input: {
    id: string;
    name: string;
    module?: string;
    risk?: string;
    unit?: string;
    range?: string;
    description?: string;
    explanation?: string;
    configFormat?: string;
  }) {
    await db.query(
      `insert into parameter_definitions (
         id, organization_id, name, description, explanation, config_format, module, default_range, unit, risk
       ) values ($1, 'org-1', $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.id,
        input.name,
        input.description ?? "Limit fast charge current.",
        input.explanation ?? "Controls fast charging current.",
        input.configFormat ?? "ENV: FAST_CHARGE_CURRENT=number",
        input.module ?? "Charging Policy",
        input.range ?? "1000 - 5000",
        input.unit ?? "mA",
        input.risk ?? "High"
      ]
    );
  }

  async function seedValue(input: {
    id: string;
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
       ) values ($1, 'org-1', $2, $3, $4, $5, $6, 'user-1')`,
      [
        input.id,
        input.projectId ?? "project-1",
        input.definitionId,
        input.currentValue ?? "3200",
        input.recommendedValue ?? "3000",
        input.valueVersion ?? 7
      ]
    );
  }

  /** definition-1/param-1: the fast-charge parameter most import tests update. */
  async function seedFastChargeParameter() {
    await seedDefinition({ id: "definition-1", name: "fast_charge_current_limit_ma" });
    await seedValue({ id: "param-1", definitionId: "definition-1" });
  }

  async function seedOpenChangeRequest(input: { id: string; parameterId: string; definitionId: string }) {
    await db.query(
      `insert into parameter_change_requests (
         id, organization_id, project_id, project_parameter_value_id, parameter_definition_id,
         base_version, current_value, target_value, status, submitter_user_id
       ) values ($1, 'org-1', 'project-1', $2, $3, 1, '3200', '3100', 'submitted', 'user-1')`,
      [input.id, input.parameterId, input.definitionId]
    );
  }

  /** The classic two-item import: one brand-new parameter, one value update. */
  function baseImportItems() {
    return [
      {
        name: "thermal_guard_threshold_c",
        module: "Thermal",
        risk: "Medium" as const,
        unit: "C",
        range: "40 - 90",
        currentValue: "72",
        recommendedValue: "70"
      },
      {
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        risk: "High" as const,
        unit: "mA",
        range: "1000 - 5000",
        currentValue: "4000",
        recommendedValue: "3800",
        description: "Limit fast charge current.",
        explanation: "Controls fast charging current.",
        configFormat: "ENV: FAST_CHARGE_CURRENT=number"
      }
    ];
  }

  async function countBatches() {
    const result = await db.query<{ c: string }>(
      `select count(*)::text as c from parameter_import_batches where organization_id = 'org-1'`
    );
    return Number(result.rows[0].c);
  }

  async function readBatchStatus(batchId: string) {
    const result = await db.query<{ status: string }>(
      `select status from parameter_import_batches where id = $1`,
      [batchId]
    );
    return result.rows[0]?.status;
  }

  async function readImportAudits() {
    const result = await db.query<{
      action: string;
      target_id: string;
      trace_id: string;
      metadata: Record<string, unknown>;
    }>(
      `select action, target_id, trace_id, metadata
       from audit_events
       where organization_id = 'org-1' and kind = 'batch-import'
       order by created_at asc, id asc`
    );
    return result.rows;
  }

  async function readValue(valueId: string) {
    const result = await db.query<{ current_value: string; recommended_value: string; value_version: number }>(
      `select current_value, recommended_value, value_version from project_parameter_values where id = $1`,
      [valueId]
    );
    return result.rows[0];
  }

  async function findDefinitionByName(name: string) {
    const result = await db.query<{ id: string; module: string }>(
      `select id, module from parameter_definitions where organization_id = 'org-1' and name = $1`,
      [name]
    );
    return result.rows[0];
  }

  describe("import preview", () => {
    it("non-admin cannot create or apply import batches", async () => {
      await expect(
        createImportPreview(db, makeAuth(), {
          projectId: "project-1",
          sourceName: "admin-upload.csv",
          items: [baseImportItems()[1]]
        })
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Admin access is required for parameter import."));

      await expect(applyImportBatch(db, makeAuth(), { batchId: "batch-1" })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Admin access is required for parameter import.")
      );

      await expect(countBatches()).resolves.toBe(0);
    });

    it("invalid import item shape returns validation failed before any writes", async () => {
      const invalidBody = {
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
      };
      expect(() => createImportBatchBodySchema.parse(invalidBody)).toThrow();

      await expect(
        createImportPreview(db, makeAdminAuth(), invalidBody as never)
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Invalid parameter import item."));
      await expect(countBatches()).resolves.toBe(0);
    });

    it("preview rejects projects outside the organization without persisting a batch", async () => {
      await expect(
        createImportPreview(db, makeAdminAuth(), {
          projectId: "project-foreign",
          sourceName: "admin-upload.csv",
          items: [baseImportItems()[1]]
        })
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization."));

      await expect(countBatches()).resolves.toBe(0);
    });

    it("preview classifies added updated unchanged conflict and flags high-risk value deltas", async () => {
      await seedDefinition({ id: "definition-updated", name: "fast_charge_current_limit_ma" });
      await seedValue({ id: "param-updated", definitionId: "definition-updated" });
      await seedDefinition({
        id: "definition-unchanged",
        name: "thermal_guard_threshold_c",
        module: "Thermal",
        risk: "Medium",
        unit: "C",
        range: "40 - 90"
      });
      await seedValue({
        id: "param-unchanged",
        definitionId: "definition-unchanged",
        currentValue: "70",
        recommendedValue: "68",
        valueVersion: 2
      });
      await seedDefinition({
        id: "definition-conflict",
        name: "pack_voltage_limit_v",
        module: "Power",
        unit: "V",
        range: "300 - 450"
      });
      await seedValue({
        id: "param-conflict",
        definitionId: "definition-conflict",
        currentValue: "400",
        recommendedValue: "395",
        valueVersion: 5
      });
      await seedOpenChangeRequest({
        id: "request-open",
        parameterId: "param-conflict",
        definitionId: "definition-conflict"
      });

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
      expect(
        batch.items.map((item) => ({ id: item.id, classification: item.classification, riskFlag: item.riskFlag }))
      ).toEqual([
        { id: "fast_charge_current_limit_ma", classification: "updated", riskFlag: true },
        { id: "thermal_guard_threshold_c", classification: "unchanged", riskFlag: false },
        { id: "new_balancing_window_s", classification: "added", riskFlag: false },
        { id: "pack_voltage_limit_v", classification: "conflict", riskFlag: false }
      ]);
      // The preview batch persists for the later apply step.
      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("preview flags high-risk recommended deltas without over-flagging zero or nonnumeric baselines", async () => {
      await seedDefinition({ id: "definition-recommended-delta", name: "recommended_delta" });
      await seedValue({
        id: "param-recommended-delta",
        definitionId: "definition-recommended-delta",
        currentValue: "100",
        recommendedValue: "100"
      });
      await seedDefinition({ id: "definition-zero-baseline", name: "zero_baseline_delta" });
      await seedValue({
        id: "param-zero-baseline",
        definitionId: "definition-zero-baseline",
        currentValue: "100",
        recommendedValue: "0"
      });
      await seedDefinition({ id: "definition-nonnumeric-baseline", name: "nonnumeric_delta" });
      await seedValue({
        id: "param-nonnumeric-baseline",
        definitionId: "definition-nonnumeric-baseline",
        currentValue: "100",
        recommendedValue: "auto"
      });

      const item = (name: string) => ({
        name,
        module: "Charging Policy",
        risk: "High" as const,
        unit: "mA",
        range: "1000 - 5000",
        currentValue: "100",
        recommendedValue: "130",
        description: "Limit fast charge current.",
        explanation: "Controls fast charging current.",
        configFormat: "ENV: FAST_CHARGE_CURRENT=number"
      });

      const batch = await createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [item("recommended_delta"), item("zero_baseline_delta"), item("nonnumeric_delta")]
      });

      expect(batch.summary).toMatchObject({ updated: 3, highRisk: 1 });
      expect(batch.items.map((entry) => ({ id: entry.id, riskFlag: entry.riskFlag }))).toEqual([
        { id: "recommended_delta", riskFlag: true },
        { id: "zero_baseline_delta", riskFlag: false },
        { id: "nonnumeric_delta", riskFlag: false }
      ]);
    });

    it("preview mints import-owned definition ids for added items with unmatched supplied ids", async () => {
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

    it("createImportPreview with reviewMetadata writes audit metadata containing skippedRows", async () => {
      const reviewMetadata = {
        skippedRows: [{ name: "weak_source_sleep_enabled", module: "demo_bool", reason: "布尔属性暂不导入" }],
        notes: "wizard skip summary"
      };

      const batch = await createImportPreview(
        db,
        makeAdminAuth(),
        {
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
        },
        { requestId: "request-import-preview-meta" }
      );

      const audits = await readImportAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "preview",
        target_id: batch.id,
        trace_id: "request-import-preview-meta"
      });
      expect(audits[0].metadata).toMatchObject({ batchId: batch.id, reviewMetadata });
    });

    it("createImportPreview without reviewMetadata does not write import audit", async () => {
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

      await expect(readImportAudits()).resolves.toEqual([]);
    });
  });

  describe("import apply", () => {
    async function previewBaseBatch() {
      await seedFastChargeParameter();
      return createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: baseImportItems()
      });
    }

    it("apply creates added values, updates selected values, and writes audit", async () => {
      const batch = await previewBaseBatch();

      const applied = await applyImportBatch(
        db,
        makeAdminAuth(),
        {
          batchId: batch.id,
          selectedItemIds: ["thermal_guard_threshold_c", "fast_charge_current_limit_ma"]
        },
        { requestId: "request-import-apply-1" }
      );

      expect(applied.status).toBe("applied");
      expect(applied.appliedAt).toBeTruthy();

      // The added item created a definition, a project value, and history.
      const addedItem = batch.items.find((item) => item.id === "thermal_guard_threshold_c");
      const addedDefinition = await findDefinitionByName("thermal_guard_threshold_c");
      expect(addedDefinition?.id).toBe(addedItem?.definitionId);
      expect(await readValue(addedItem!.projectParameterValueId!)).toEqual({
        current_value: "72",
        recommended_value: "70",
        value_version: 1
      });

      // The updated item bumped the existing value and appended history.
      expect(await readValue("param-1")).toEqual({
        current_value: "4000",
        recommended_value: "3800",
        value_version: 8
      });
      const history = await db.query<{ c: string }>(
        `select count(*)::text as c from parameter_history_entries where organization_id = 'org-1'`
      );
      expect(Number(history.rows[0].c)).toBe(2);

      const audits = await readImportAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "apply",
        target_id: batch.id,
        trace_id: "request-import-apply-1"
      });
      expect(audits[0].metadata).toMatchObject({
        batchId: batch.id,
        summary: { added: 1, updated: 1, skipped: 0 }
      });
    });

    it("applyImportBatch merges reviewMetadata into apply audit metadata", async () => {
      const batch = await previewBaseBatch();
      const reviewMetadata = {
        skippedRows: [{ rowKey: "demo_bool/weak_source_sleep_enabled", reason: "skipped in wizard" }],
        notes: "final snapshot"
      };

      await applyImportBatch(
        db,
        makeAdminAuth(),
        { batchId: batch.id, reviewMetadata },
        { requestId: "request-import-apply-meta" }
      );

      const audits = await readImportAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({ batchId: batch.id, reviewMetadata });
    });

    it("apply defaults to eligible added and updated items without selecting conflicts", async () => {
      await seedFastChargeParameter();
      // Unchanged twin.
      await seedDefinition({
        id: "definition-unchanged",
        name: "unchanged_threshold_c",
        module: "Thermal",
        risk: "Low",
        unit: "C",
        range: "40 - 90",
        description: "",
        explanation: "",
        configFormat: ""
      });
      await seedValue({
        id: "param-unchanged",
        definitionId: "definition-unchanged",
        currentValue: "72",
        recommendedValue: "",
        valueVersion: 3
      });
      // Conflicted parameter with an open change request.
      await seedDefinition({ id: "definition-conflict", name: "conflicting_current_limit_ma" });
      await seedValue({ id: "param-conflict", definitionId: "definition-conflict", valueVersion: 4 });
      await seedOpenChangeRequest({
        id: "request-open",
        parameterId: "param-conflict",
        definitionId: "definition-conflict"
      });

      const batch = await createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          ...baseImportItems(),
          {
            name: "unchanged_threshold_c",
            module: "Thermal",
            risk: "Low",
            unit: "C",
            range: "40 - 90",
            currentValue: "72",
            recommendedValue: ""
          },
          {
            name: "conflicting_current_limit_ma",
            module: "Charging Policy",
            risk: "High",
            unit: "mA",
            range: "1000 - 5000",
            currentValue: "4000"
          }
        ]
      });
      expect(batch.summary).toMatchObject({ added: 1, updated: 1, unchanged: 1, conflict: 1 });

      const applied = await applyImportBatch(db, makeAdminAuth(), { batchId: batch.id });

      expect(applied.status).toBe("applied");
      // Conflicted and unchanged parameters stayed untouched.
      expect(await readValue("param-conflict")).toMatchObject({ current_value: "3200", value_version: 4 });
      expect(await readValue("param-unchanged")).toMatchObject({ current_value: "72", value_version: 3 });
      const audits = await readImportAudits();
      expect(audits[0].metadata).toMatchObject({
        summary: { added: 1, updated: 1, skipped: 2 }
      });
    });

    it("apply rejects batches whose project is outside the organization", async () => {
      // A batch row smuggled in under another organization's project id.
      await db.query(
        `insert into parameter_import_batches (id, organization_id, project_id, created_by_user_id, source_name, status, summary, items)
         values ('batch-foreign', 'org-1', 'project-foreign', 'user-1', 'admin-upload.csv', 'previewed', '{"added":1,"updated":0,"unchanged":0,"conflict":0,"highRisk":0}',
           '[{"id":"item-added","name":"thermal_guard_threshold_c","module":"Thermal","risk":"Medium","unit":"C","range":"40 - 90","currentValue":"72","classification":"added","definitionId":"thermal_guard_threshold_c","projectParameterValueId":"project-1-thermal_guard_threshold_c","riskFlag":false}]')`
      );

      await expect(
        applyImportBatch(db, makeAdminAuth(), { batchId: "batch-foreign", selectedItemIds: ["item-added"] })
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization."));

      await expect(readBatchStatus("batch-foreign")).resolves.toBe("previewed");
      await expect(findDefinitionByName("thermal_guard_threshold_c")).resolves.toBeUndefined();
    });

    it("apply rejects unknown selected item ids without consuming the batch", async () => {
      const batch = await previewBaseBatch();

      await expect(
        applyImportBatch(db, makeAdminAuth(), { batchId: batch.id, selectedItemIds: ["item-missing"] })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Selected import item was not found in the batch.")
      );

      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("apply rejects an empty selected item list without consuming the batch", async () => {
      const batch = await previewBaseBatch();

      await expect(
        applyImportBatch(db, makeAdminAuth(), { batchId: batch.id, selectedItemIds: [] })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "At least one import item must be selected."));

      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("apply rejects when selected items contain no eligible import changes", async () => {
      await seedDefinition({
        id: "definition-1",
        name: "fast_charge_current_limit_ma"
      });
      await seedValue({ id: "param-1", definitionId: "definition-1" });
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
            currentValue: "3200",
            recommendedValue: "3000",
            description: "Limit fast charge current.",
            explanation: "Controls fast charging current.",
            configFormat: "ENV: FAST_CHARGE_CURRENT=number"
          }
        ]
      });
      expect(batch.items[0].classification).toBe("unchanged");

      await expect(
        applyImportBatch(db, makeAdminAuth(), {
          batchId: batch.id,
          selectedItemIds: ["fast_charge_current_limit_ma"]
        })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "At least one eligible import item must be selected.")
      );

      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("apply rejects added definition id collisions discovered after preview", async () => {
      const batch = await previewBaseBatch();
      const addedItem = batch.items.find((item) => item.id === "thermal_guard_threshold_c");
      // Race: the minted definition id gets taken between preview and apply.
      await seedDefinition({ id: addedItem!.definitionId!, name: "occupies_the_minted_id" });

      await expect(
        applyImportBatch(db, makeAdminAuth(), {
          batchId: batch.id,
          selectedItemIds: ["thermal_guard_threshold_c"]
        })
      ).rejects.toMatchObject(new ApiError("CONFLICT", "Import item definition id already exists."));

      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
      await expect(readImportAudits()).resolves.toEqual([]);
    });

    it("apply rechecks open requests created after preview", async () => {
      const batch = await previewBaseBatch();
      expect(batch.items.find((item) => item.id === "fast_charge_current_limit_ma")?.classification).toBe(
        "updated"
      );
      // The conflict appears only after the preview classified the item as updated.
      await seedOpenChangeRequest({
        id: "request-open-after-preview",
        parameterId: "param-1",
        definitionId: "definition-1"
      });

      await expect(
        applyImportBatch(db, makeAdminAuth(), {
          batchId: batch.id,
          selectedItemIds: ["fast_charge_current_limit_ma"]
        })
      ).rejects.toMatchObject(
        new ApiError("CONFLICT", "Cannot apply import items with open change requests.")
      );

      expect(await readValue("param-1")).toMatchObject({ current_value: "3200", value_version: 7 });
      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("apply skips unselected items", async () => {
      const batch = await previewBaseBatch();

      await applyImportBatch(db, makeAdminAuth(), {
        batchId: batch.id,
        selectedItemIds: ["fast_charge_current_limit_ma"]
      });

      // The unselected added item created nothing.
      await expect(findDefinitionByName("thermal_guard_threshold_c")).resolves.toBeUndefined();
      // The selected update went through.
      expect(await readValue("param-1")).toMatchObject({ current_value: "4000", value_version: 8 });
    });

    it("apply updates definition metadata for selected updated items", async () => {
      await seedFastChargeParameter();
      const batch = await createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          {
            name: "fast_charge_current_limit_ma",
            module: "Charging Policy V2",
            risk: "High",
            unit: "A",
            range: "1 - 5",
            currentValue: "3200",
            recommendedValue: "3000",
            description: "Updated description.",
            explanation: "Updated explanation.",
            configFormat: "ENV: FAST_CHARGE_CURRENT_V2=number"
          }
        ]
      });
      expect(batch.items[0].classification).toBe("updated");

      await applyImportBatch(db, makeAdminAuth(), {
        batchId: batch.id,
        selectedItemIds: ["fast_charge_current_limit_ma"]
      });

      const definition = await db.query<{
        module: string;
        unit: string;
        default_range: string;
        description: string;
        explanation: string;
        config_format: string;
      }>(
        `select module, unit, default_range, description, explanation, config_format
         from parameter_definitions where id = 'definition-1'`
      );
      expect(definition.rows[0]).toEqual({
        module: "Charging Policy V2",
        unit: "A",
        default_range: "1 - 5",
        description: "Updated description.",
        explanation: "Updated explanation.",
        config_format: "ENV: FAST_CHARGE_CURRENT_V2=number"
      });
      // Values were identical, so the metadata-only update leaves version and history alone.
      expect(await readValue("param-1")).toMatchObject({ current_value: "3200", value_version: 7 });
    });

    it("apply creates a project value when an updated definition has no project row", async () => {
      await seedDefinition({
        id: "definition-orphan",
        name: "orphan_definition",
        module: "Charging Policy",
        risk: "Medium",
        range: "1000 - 5000"
      });

      const batch = await createImportPreview(db, makeAdminAuth(), {
        projectId: "project-1",
        sourceName: "admin-upload.csv",
        items: [
          {
            name: "orphan_definition",
            module: "Charging Policy",
            risk: "Medium",
            unit: "mA",
            range: "1000 - 5000",
            currentValue: "2500",
            recommendedValue: "2400",
            description: "Existing definition without project value.",
            explanation: "Creates project scoped value.",
            configFormat: "ENV: ORPHAN=number"
          }
        ]
      });
      const previewItem = batch.items[0];
      expect(previewItem.classification).toBe("updated");
      expect(previewItem.projectParameterValueId).toBe("project-1-definition-orphan");

      await applyImportBatch(db, makeAdminAuth(), {
        batchId: batch.id,
        selectedItemIds: [previewItem.id]
      });

      expect(await readValue("project-1-definition-orphan")).toEqual({
        current_value: "2500",
        recommended_value: "2400",
        value_version: 1
      });
      const history = await db.query<{ version: number; value: string }>(
        `select version, value from parameter_history_entries where project_parameter_value_id = 'project-1-definition-orphan'`
      );
      expect(history.rows).toEqual([{ version: 1, value: "2500" }]);
    });

    it("apply rejects selected conflict items", async () => {
      await seedFastChargeParameter();
      await seedOpenChangeRequest({ id: "request-open", parameterId: "param-1", definitionId: "definition-1" });
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
            currentValue: "4000"
          }
        ]
      });
      expect(batch.items[0].classification).toBe("conflict");

      await expect(
        applyImportBatch(db, makeAdminAuth(), {
          batchId: batch.id,
          selectedItemIds: ["fast_charge_current_limit_ma"]
        })
      ).rejects.toMatchObject(
        new ApiError("CONFLICT", "Cannot apply import items with open change requests.")
      );

      expect(await readValue("param-1")).toMatchObject({ current_value: "3200", value_version: 7 });
      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });
  });

  describe("drafts and submission guards", () => {
    async function countDrafts() {
      const result = await db.query<{ c: string }>(
        `select count(*)::text as c from parameter_drafts where organization_id = 'org-1'`
      );
      return Number(result.rows[0].c);
    }

    it("guest cannot save draft", async () => {
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
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit permission is required."));

      await expect(countDrafts()).resolves.toBe(0);
    });

    it("rejects saving a draft for a project the editor is not bound to", async () => {
      await seedFastChargeParameter();

      // software-user on project-1 carries the flat parameter:edit permission, but
      // must not be able to write drafts into project-2.
      await expect(
        saveDraft(db, makeAuth({ roles: [{ projectId: "project-1", roleId: "software-user" }] }), {
          projectId: "project-2",
          parameterId: "param-1",
          targetValue: "3100",
          reason: "cross-project"
        })
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project."));

      await expect(countDrafts()).resolves.toBe(0);
    });

    it("accepts an organization-wide (null-project) editor binding for any project", async () => {
      // Self-service registration approval and the M0 seed grant business roles
      // with projectId null: an organization-wide binding, not a no-project one.
      // The project-scope guard must not reject it; the call proceeds past
      // authorization into the domain lookup, which reports the parameter as
      // missing from project-2 instead of a role failure.
      await expect(
        saveDraft(db, makeAuth({ roles: [{ projectId: null, roleId: "hardware-user" }] }), {
          projectId: "project-2",
          parameterId: "param-1",
          targetValue: "3100",
          reason: "org-wide binding"
        })
      ).rejects.toMatchObject(
        new ApiError("NOT_FOUND", "Parameter was not found for this project.", {
          parameterId: "param-1",
          projectId: "project-2"
        })
      );
    });

    it("rejects submitting a change round for a project the editor is not bound to", async () => {
      await expect(
        submitParameterChanges(
          db,
          makeAuth({ roles: [{ projectId: "project-1", roleId: "software-user" }] }),
          {
            projectId: "project-2",
            items: [{ parameterId: "param-1", targetValue: "3100", reason: "cross-project" }]
          },
          { requestId: "req-cross" }
        )
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project."));

      const rounds = await db.query<{ c: string }>(
        `select count(*)::text as c from parameter_submission_rounds where organization_id = 'org-1'`
      );
      expect(Number(rounds.rows[0].c)).toBe(0);
    });

    it("user can save and list own draft", async () => {
      await seedFastChargeParameter();

      const draft = await saveDraft(db, makeAuth(), {
        projectId: "project-1",
        parameterId: "param-1",
        targetValue: "3100",
        reason: "Reduce thermal risk."
      });
      expect(draft).toMatchObject({
        projectId: "project-1",
        parameterId: "param-1",
        targetValue: "3100",
        action: "set",
        reason: "Reduce thermal risk."
      });

      const drafts = await listDrafts(db, makeAuth(), { projectId: "project-1" });
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        id: draft.id,
        projectId: "project-1",
        parameterId: "param-1",
        targetValue: "3100",
        reason: "Reduce thermal risk.",
        // The list view enriches drafts with definition metadata.
        name: "fast_charge_current_limit_ma",
        module: "Charging Policy",
        currentValue: "3200"
      });
    });

    it("saveDraft rejects when parameter is not in the project before upserting", async () => {
      // The parameter exists, but in project-2.
      await seedDefinition({ id: "definition-elsewhere", name: "elsewhere_parameter" });
      await seedValue({
        id: "param-from-other-project",
        projectId: "project-2",
        definitionId: "definition-elsewhere"
      });

      await expect(
        saveDraft(db, makeAuth(), {
          projectId: "project-1",
          parameterId: "param-from-other-project",
          targetValue: "3100",
          reason: "Reduce thermal risk."
        })
      ).rejects.toMatchObject(
        new ApiError("NOT_FOUND", "Parameter was not found for this project.", {
          parameterId: "param-from-other-project",
          projectId: "project-1"
        })
      );

      await expect(countDrafts()).resolves.toBe(0);
    });
  });

  describe("semantic draft submission", () => {
    async function seedBindingDraftsAtDifferentWorkingTips() {
      const baseRevisionId = "base-submit-revision";
      const sourceFileVersionId = "fv-submit-base";
      const expectedChecksum = "checksum-submit-base";
      const draftCases = [
        { suffix: "a", propertyKey: "limit_a", baseValue: "<1000>", targetValue: "<3000>" },
        { suffix: "b", propertyKey: "limit_b", baseValue: "<2000>", targetValue: "<4000>" }
      ] as const;

      await seedSpecBindingGraph(db, {
        organizationId: "org-1",
        specs: draftCases.map(({ suffix, propertyKey }) => ({
          id: `spec-submit-${suffix}`,
          specificationKey: `charging/${propertyKey}`,
          versions: [
            {
              id: `spec-version-submit-${suffix}`,
              displayName: `Limit ${suffix.toUpperCase()}`,
              valueShape: { kind: "cells", bits: 32 }
            }
          ],
          propertySpec: { id: `property-spec-submit-${suffix}`, propertyKey }
        })),
        modules: [{ id: "module-submit", name: "Charging" }],
        configSets: [
          {
            id: "config-set-submit",
            projectId: "project-1",
            revisions: [
              { id: baseRevisionId, revisionNumber: 1, status: "resolved" },
              { id: "candidate-tip-a", revisionNumber: 2, status: "draft" },
              { id: "candidate-tip-b", revisionNumber: 3, status: "draft" }
            ]
          }
        ],
        bindings: draftCases.map(({ suffix, baseValue, targetValue }) => ({
          id: `binding-${suffix}`,
          projectId: "project-1",
          parameterSpecId: `spec-submit-${suffix}`,
          moduleId: "module-submit",
          revisions: [
            {
              id: `binding-revision-${suffix}`,
              configRevisionId: baseRevisionId,
              parameterSpecVersionId: `spec-version-submit-${suffix}`,
              rawValue: baseValue
            },
            {
              id: `candidate-binding-revision-${suffix}`,
              configRevisionId: `candidate-tip-${suffix}`,
              parameterSpecVersionId: `spec-version-submit-${suffix}`,
              rawValue: targetValue
            }
          ]
        }))
      });

      await db.query(
        `insert into project_parameter_files (
           id, organization_id, project_id, file_name, format, enabled,
           config_set_id, config_set_role, config_set_sort_order
         ) values ('file-submit-base', 'org-1', 'project-1', 'submit-base.dts', 'dts', true,
           'config-set-submit', 'base', 0)`
      );
      await db.query(
        `insert into project_parameter_file_versions (
           id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
         ) values ($1, 'file-submit-base', 1, 'org-1/submit-base.dts', $2, 128, '{}'::jsonb, 'upload', 'user-1')`,
        [sourceFileVersionId, expectedChecksum]
      );
      await db.query(
        `insert into dts_config_revision_members (
           id, config_revision_id, file_id, file_version_id, role, sort_order
         ) values ('member-submit-base', $1, 'file-submit-base', $2, 'base', 0)`,
        [baseRevisionId, sourceFileVersionId]
      );
      await db.query(
        `insert into dts_node_occurrences (
           id, config_revision_id, file_version_id, name, labels, node_path,
           start_offset, end_offset, start_line, start_column, end_line, end_column,
           raw_text, ast_json, source_order
         ) values (
           'node-occurrence-submit', $1, $2, 'charging', '[]'::jsonb, 'charging',
           0, 100, 1, 1, 5, 1, 'charging {}', '{}'::jsonb, 0
         )`,
        [baseRevisionId, sourceFileVersionId]
      );
      await db.query(
        `insert into dts_property_occurrences (
           id, config_revision_id, node_occurrence_id, file_version_id, property_name,
           start_offset, end_offset, start_line, start_column, end_line, end_column,
           raw_text, ast_json, source_order
         ) values
           ('property-occurrence-submit-a', $1, 'node-occurrence-submit', $2, 'limit_a',
             10, 20, 2, 3, 2, 13, '<1000>', '{}'::jsonb, 0),
           ('property-occurrence-submit-b', $1, 'node-occurrence-submit', $2, 'limit_b',
             30, 40, 3, 3, 3, 13, '<2000>', '{}'::jsonb, 1)`,
        [baseRevisionId, sourceFileVersionId]
      );
      await db.query(
        `insert into parameter_drafts (
           id, organization_id, project_id, user_id, target_value, reason,
           project_parameter_binding_id, base_config_revision_id, binding_revision_id,
           property_occurrence_id, source_file_version_id, expected_checksum,
           occurrence_span, candidate_config_revision_id, action, edit_subject_kind
         ) values
           ('draft-a', 'org-1', 'project-1', 'user-1', '<3000>', 'a',
             'binding-a', $1, 'binding-revision-a', 'property-occurrence-submit-a', $2, $3,
             '{"start":10,"end":20}'::jsonb, 'candidate-tip-a', 'set', 'binding'),
           ('draft-b', 'org-1', 'project-1', 'user-1', '<4000>', 'b',
             'binding-b', $1, 'binding-revision-b', 'property-occurrence-submit-b', $2, $3,
             '{"start":30,"end":40}'::jsonb, 'candidate-tip-b', 'set', 'binding')`,
        [baseRevisionId, sourceFileVersionId, expectedChecksum]
      );
    }

    it("submitParameterChanges rejects mixed working tips in one batch", async () => {
      setParameterIdentityMode("semantic");
      await seedBindingDraftsAtDifferentWorkingTips();

      await expect(
        submitParameterChanges(db, makeAuth(), {
          projectId: "project-1",
          items: [
            {
              draftId: "draft-a",
              projectParameterBindingId: "binding-a",
              parameterSpecId: "spec-submit-a",
              action: "set",
              targetValue: "<3000>",
              reason: "a"
            },
            {
              draftId: "draft-b",
              projectParameterBindingId: "binding-b",
              parameterSpecId: "spec-submit-b",
              action: "set",
              targetValue: "<4000>",
              reason: "b"
            }
          ]
        })
      ).rejects.toMatchObject(
        new ApiError(
          "CONFLICT",
          "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。",
          {
            reason: "mixed-working-tips",
            candidateConfigRevisionIds: expect.arrayContaining(["candidate-tip-a", "candidate-tip-b"])
          }
        )
      );

      const [drafts, workflowRows, candidates] = await Promise.all([
        db.query<{ c: string }>(
          `select count(*)::text as c from parameter_drafts where id in ('draft-a', 'draft-b')`
        ),
        db.query<{ rounds: string; requests: string; items: string }>(
          `select
             (select count(*) from parameter_submission_rounds)::text as rounds,
             (select count(*) from parameter_change_requests)::text as requests,
             (select count(*) from parameter_submission_items)::text as items`
        ),
        db.query<{ id: string; status: string }>(
          `select id, status from dts_config_revisions
           where id in ('candidate-tip-a', 'candidate-tip-b') order by id`
        )
      ]);
      expect(Number(drafts.rows[0].c)).toBe(2);
      expect(workflowRows.rows[0]).toEqual({ rounds: "0", requests: "0", items: "0" });
      expect(candidates.rows).toEqual([
        { id: "candidate-tip-a", status: "draft" },
        { id: "candidate-tip-b", status: "draft" }
      ]);
    });

    async function seedEnablementDraft() {
      const baseRevisionId = "base-enablement-revision";
      const candidateRevisionId = "candidate-enablement-revision";
      const logicalNodeId = "logical-node-enablement";
      const baseFileVersionId = "fv-enablement-base";
      const candidateFileVersionId = "fv-enablement-candidate";
      const expectedChecksum = "checksum-enablement-base";

      // The migrated test template is intentionally pre-cutover. Enablement submission
      // exists only after the identity cutover removes these retired legacy columns.
      await db.query(`alter table parameter_change_requests drop column parameter_definition_id`);
      await db.query(`alter table parameter_change_requests drop column project_parameter_value_id`);

      await seedSpecBindingGraph(db, {
        organizationId: "org-1",
        configSets: [
          {
            id: "config-set-enablement",
            projectId: "project-1",
            revisions: [
              { id: baseRevisionId, revisionNumber: 1, status: "resolved" },
              { id: candidateRevisionId, revisionNumber: 2, status: "draft" }
            ],
            logicalNodes: [
              {
                id: logicalNodeId,
                revisions: [
                  {
                    id: "logical-node-revision-enablement-base",
                    configRevisionId: baseRevisionId,
                    nodeLocator: "/charging_core",
                    name: "charging_core",
                    compatible: "wiseeff,charging_core"
                  },
                  {
                    id: "logical-node-revision-enablement-candidate",
                    configRevisionId: candidateRevisionId,
                    nodeLocator: "/charging_core",
                    name: "charging_core",
                    compatible: "wiseeff,charging_core"
                  }
                ]
              }
            ]
          }
        ]
      });

      await db.query(
        `insert into project_parameter_files (
           id, organization_id, project_id, file_name, format, enabled,
           config_set_id, config_set_role, config_set_sort_order
         ) values ('file-enablement', 'org-1', 'project-1', 'enablement.dts', 'dts', true,
           'config-set-enablement', 'base', 0)`
      );
      await db.query(
        `insert into project_parameter_file_versions (
           id, file_id, version_number, storage_key, checksum, size_bytes, parsed_index, origin, created_by_user_id
         ) values
           ($1, 'file-enablement', 1, 'org-1/enablement-base.dts', $3, 128, '{}'::jsonb, 'upload', 'user-1'),
           ($2, 'file-enablement', 2, 'org-1/enablement-candidate.dts', 'checksum-enablement-candidate', 144,
             '{}'::jsonb, 'writeback', 'user-1')`,
        [baseFileVersionId, candidateFileVersionId, expectedChecksum]
      );
      await db.query(
        `insert into dts_config_revision_members (
           id, config_revision_id, file_id, file_version_id, role, sort_order
         ) values
           ('member-enablement-base', $1, 'file-enablement', $3, 'base', 0),
           ('member-enablement-candidate', $2, 'file-enablement', $4, 'base', 0)`,
        [baseRevisionId, candidateRevisionId, baseFileVersionId, candidateFileVersionId]
      );
      await db.query(
        `insert into dts_node_occurrences (
           id, config_revision_id, file_version_id, name, labels, node_path,
           start_offset, end_offset, start_line, start_column, end_line, end_column,
           raw_text, ast_json, source_order
         ) values (
           'node-occurrence-enablement-candidate', $1, $2, 'charging_core', '[]'::jsonb, 'charging_core',
           0, 120, 1, 1, 6, 1, 'charging_core { status = "disabled"; };', '{}'::jsonb, 0
         )`,
        [candidateRevisionId, candidateFileVersionId]
      );
      await db.query(
        `insert into dts_property_occurrences (
           id, config_revision_id, node_occurrence_id, file_version_id, property_name,
           start_offset, end_offset, start_line, start_column, end_line, end_column,
           raw_text, ast_json, source_order
         ) values (
           'property-occurrence-enablement-candidate', $1, 'node-occurrence-enablement-candidate', $2, 'status',
           24, 44, 3, 3, 3, 23, '"disabled"', '{}'::jsonb, 0
         )`,
        [candidateRevisionId, candidateFileVersionId]
      );
      await db.query(
        `insert into dts_occurrence_effects (
           id, config_revision_id, logical_node_revision_id, property_name, effect_kind,
           node_occurrence_id, property_occurrence_id, source_order
         ) values (
           'effect-enablement-candidate', $1, 'logical-node-revision-enablement-candidate', 'status', 'set',
           'node-occurrence-enablement-candidate', 'property-occurrence-enablement-candidate', 0
         )`,
        [candidateRevisionId]
      );
      await db.query(
        `insert into parameter_drafts (
           id, organization_id, project_id, user_id, target_value, reason,
           project_parameter_binding_id, logical_node_id, base_config_revision_id,
           source_file_version_id, expected_checksum, candidate_config_revision_id,
           action, edit_subject_kind
         ) values (
           'draft-enablement', 'org-1', 'project-1', 'user-1', '"disabled"', 'Disable node',
           null, $1, $2, $3, $4, $5, 'set', 'node-enablement'
         )`,
        [logicalNodeId, baseRevisionId, baseFileVersionId, expectedChecksum, candidateRevisionId]
      );

      return { candidateRevisionId, logicalNodeId };
    }

    it("submitParameterChanges creates enablement change requests from node-enablement drafts", async () => {
      setParameterIdentityMode("semantic");
      const { candidateRevisionId, logicalNodeId } = await seedEnablementDraft();

      const round = await submitParameterChanges(db, makeAuth(), {
        projectId: "project-1",
        items: [
          {
            draftId: "draft-enablement",
            editSubjectKind: "node-enablement",
            logicalNodeId,
            action: "set",
            targetValue: '"disabled"',
            reason: "Disable node"
          }
        ]
      });

      expect(round).toMatchObject({
        projectId: "project-1",
        status: "submitted",
        items: [
          {
            parameterId: logicalNodeId,
            name: "status",
            module: "节点启用",
            currentValue: "",
            targetValue: '"disabled"',
            action: "set",
            candidateConfigRevisionId: candidateRevisionId,
            reason: "Disable node"
          }
        ]
      });

      const durable = await db.query<{
        submission_round_id: string;
        edit_subject_kind: string;
        logical_node_id: string;
        project_parameter_binding_id: string | null;
        parameter_spec_id: string | null;
        candidate_config_revision_id: string;
        base_config_revision_id: string;
        source_file_version_id: string;
        expected_checksum: string;
        action: string;
        target_value: string;
        item_subject_kind: string;
        item_logical_node_id: string;
        item_candidate_config_revision_id: string;
        candidate_status: string;
        draft_count: number;
      }>(
        `select request.submission_round_id, request.edit_subject_kind, request.logical_node_id,
           request.project_parameter_binding_id, request.parameter_spec_id,
           request.candidate_config_revision_id, request.base_config_revision_id,
           request.source_file_version_id, request.expected_checksum, request.action, request.target_value,
           item.edit_subject_kind as item_subject_kind, item.logical_node_id as item_logical_node_id,
           item.candidate_config_revision_id as item_candidate_config_revision_id,
           candidate.status as candidate_status,
           (select count(*)::int from parameter_drafts where id = 'draft-enablement') as draft_count
         from parameter_change_requests request
         inner join parameter_submission_items item on item.change_request_id = request.id
         inner join dts_config_revisions candidate on candidate.id = request.candidate_config_revision_id
         where request.submission_round_id = $1`,
        [round.id]
      );
      expect(durable.rows).toEqual([
        {
          submission_round_id: round.id,
          edit_subject_kind: "node-enablement",
          logical_node_id: logicalNodeId,
          project_parameter_binding_id: null,
          parameter_spec_id: null,
          candidate_config_revision_id: candidateRevisionId,
          base_config_revision_id: "base-enablement-revision",
          source_file_version_id: "fv-enablement-base",
          expected_checksum: "checksum-enablement-base",
          action: "set",
          target_value: '"disabled"',
          item_subject_kind: "node-enablement",
          item_logical_node_id: logicalNodeId,
          item_candidate_config_revision_id: candidateRevisionId,
          candidate_status: "pending_approval",
          draft_count: 0
        }
      ]);
    });
  });
});
