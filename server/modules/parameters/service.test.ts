/**
 * Parameter service coverage.
 *
 * Import preview/apply and draft/submission guard behaviors run against a real
 * database (`createInMemoryTestDatabase`), asserting returned DTOs and
 * subsequent reads — never SQL text. Review-workflow behaviors live in
 * serviceReviewWorkflow.integration.test.ts.
 *
 * A small fake-db section survives at the bottom for behaviors a real schema
 * cannot host (see the comments on each kept test).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AuthContext } from "../auth/types";
import { setParameterIdentityMode } from "../parameter-kernel/parameterIdentityMode";
import type { Database, QueryResult, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import {
  createInMemoryTestDatabase,
  isTestDatabaseAvailable,
  type InMemoryTestDatabase
} from "../../testing/testDatabase";
import { seedCoreGraph } from "../../testing/fixtures";
import {
  applyImportBatch,
  createImportPreview,
  listDrafts,
  parseDtsImportForAuth,
  reviewChange,
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
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Admin access is required for parameter import.", 403));

      await expect(applyImportBatch(db, makeAuth(), { batchId: "batch-1" })).rejects.toMatchObject(
        new ApiError("FORBIDDEN", "Admin access is required for parameter import.", 403)
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
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "Invalid parameter import item.", 400));
      await expect(countBatches()).resolves.toBe(0);
    });

    it("preview rejects projects outside the organization without persisting a batch", async () => {
      await expect(
        createImportPreview(db, makeAdminAuth(), {
          projectId: "project-foreign",
          sourceName: "admin-upload.csv",
          items: [baseImportItems()[1]]
        })
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization.", 404));

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
      ).rejects.toMatchObject(new ApiError("NOT_FOUND", "Project was not found for this organization.", 404));

      await expect(readBatchStatus("batch-foreign")).resolves.toBe("previewed");
      await expect(findDefinitionByName("thermal_guard_threshold_c")).resolves.toBeUndefined();
    });

    it("apply rejects unknown selected item ids without consuming the batch", async () => {
      const batch = await previewBaseBatch();

      await expect(
        applyImportBatch(db, makeAdminAuth(), { batchId: batch.id, selectedItemIds: ["item-missing"] })
      ).rejects.toMatchObject(
        new ApiError("VALIDATION_FAILED", "Selected import item was not found in the batch.", 400)
      );

      await expect(readBatchStatus(batch.id)).resolves.toBe("previewed");
    });

    it("apply rejects an empty selected item list without consuming the batch", async () => {
      const batch = await previewBaseBatch();

      await expect(
        applyImportBatch(db, makeAdminAuth(), { batchId: batch.id, selectedItemIds: [] })
      ).rejects.toMatchObject(new ApiError("VALIDATION_FAILED", "At least one import item must be selected.", 400));

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
        new ApiError("VALIDATION_FAILED", "At least one eligible import item must be selected.", 400)
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
      ).rejects.toMatchObject(new ApiError("CONFLICT", "Import item definition id already exists.", 409));

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
        new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409)
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
        new ApiError("CONFLICT", "Cannot apply import items with open change requests.", 409)
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
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit permission is required.", 403));

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
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project.", 403));

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
        new ApiError("NOT_FOUND", "Parameter was not found for this project.", 404, {
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
      ).rejects.toMatchObject(new ApiError("FORBIDDEN", "Parameter edit role is required for this project.", 403));

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
        new ApiError("NOT_FOUND", "Parameter was not found for this project.", 404, {
          parameterId: "param-from-other-project",
          projectId: "project-1"
        })
      );

      await expect(countDrafts()).resolves.toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Kept fake-db coverage.
//
// These behaviors cannot run on the shared real-database harness:
// - "rejects semantic merge when projectId is missing": parameter_change_requests
//   .project_id is NOT NULL, so a project-less request cannot exist in a real
//   database; the check is defensive-only.
// - The two semantic submit tests need full post-cutover topology graphs.
//   Slice 4 re-evaluated them against the shared seedSpecBindingGraph fixture:
//   the fixture covers the spec/binding/config-revision spine, but these paths
//   additionally require candidate-proof state that getBindingDraftForSubmission
//   computes from write-lock rows (binding revisions on both base and candidate
//   revisions, file versions with matching checksums, and — for enablement —
//   logical-node status occurrence effects). That per-test graph is exactly what
//   parameter-topology/postCutoverWorkflow.integration.test.ts already builds on
//   a temp database where the merged behavior is covered end to end, so these
//   two stay fake-db preflight-order guards rather than duplicating that harness.
// ---------------------------------------------------------------------------

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

const PROJECT_ID = "project-1";

const completeAssignees = {
  hardwareCommitterId: "u-hardware",
  softwareCommitterId: "u-software-committer",
  softwareUserId: "u-software-user"
};

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

describe("parameter service (fake-db residuals)", () => {
  afterEach(() => {
    setParameterIdentityMode(null);
  });

  // Post-cutover semantic submit needs a full topology graph (candidate revisions,
  // binding revisions, write locks); the merged behavior runs on a temp database in
  // parameter-topology/postCutoverWorkflow.integration.test.ts. Kept on the fake db
  // per the slice-4 evaluation in the section comment above.
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

  // Same topology dependency as above; see the section comment.
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
