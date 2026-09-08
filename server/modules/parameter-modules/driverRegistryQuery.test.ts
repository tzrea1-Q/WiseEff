import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { listDriverRegistry } from "./service";
import * as service from "./service";
import * as schemaCache from "../parameter-specs/schemaRegistryCache";
import * as overlays from "../parameter-specs/driverSchemaOverlayRepository";
import * as coverage from "../parameter-specs/parseCoverage";
import { readModComparisonSourceInventory } from "./parameterCatalogComparisonContribution";

afterEach(() => vi.restoreAllMocks());

function makeAuth(): AuthContext {
  return makeTestAuthContext({
    userId: "user-1",
    organizationId: "org-1",
    name: "Admin",
    email: "admin@example.com",
    organizationName: "ChargeLab",
    permissions: ["parameter:view", "parameter:edit", "admin:access"],
  });
}

describe("listDriverRegistry", () => {
  it("lists driver groups with compatible rules, observed coverage, and skips scaffolding labels", async () => {
    const query = vi.fn(async (text: string) => {
      if (
        text.includes("from parameter_modules") &&
        !text.includes("driver_registrations") &&
        !text.includes("select id from")
      ) {
        return {
          rows: [
            {
              id: "biz-power",
              name: "Power",
              parent_id: null,
              sort_order: 0,
              description: "",
              scope: "",
              importance: "high",
              kind: "business",
              origin: "curated",
              source_key: null,
              path: "biz-power",
              parameter_count: "0",
            },
            {
              id: "group-hl",
              name: "hl7603",
              parent_id: "biz-power",
              sort_order: 0,
              description: "",
              scope: "",
              importance: "medium",
              kind: "driver-group",
              origin: "curated",
              source_key: "compatible:huawei,bypass_bst_hl7603",
              path: "biz-power/group-hl",
              parameter_count: "0",
            },
            {
              id: "group-sc",
              name: "sc8562",
              parent_id: "biz-power",
              sort_order: 1,
              description: "",
              scope: "",
              importance: "medium",
              kind: "driver-group",
              origin: "auto",
              source_key: "compatible:sc8562",
              path: "biz-power/group-sc",
              parameter_count: "3",
            },
            {
              id: "group-i2c",
              name: "i2c@FDF5E000",
              parent_id: "biz-power",
              sort_order: 2,
              description: "",
              scope: "",
              importance: "medium",
              kind: "driver-group",
              origin: "auto",
              source_key: "compatible:arm,amba-bus",
              path: "biz-power/group-i2c",
              parameter_count: "0",
            },
          ],
          rowCount: 4,
        };
      }
      if (text.includes("parameter_spec_id") && text.includes("project_parameter_bindings")) {
        return {
          rows: [
            { module_id: "group-sc", parameter_spec_id: "spec-a" },
            { module_id: "group-sc", parameter_spec_id: "spec-b" },
            { module_id: "group-sc", parameter_spec_id: "spec-c" }
          ],
          rowCount: 3
        };
      }
      if (text.includes("from parameter_module_mappings")) {
        return {
          rows: [
            {
              id: "m1",
              parameter_module_id: "group-hl",
              match_kind: "compatible",
              match_value: "huawei,bypass_bst_hl7603",
              priority: 0,
            },
            {
              id: "m2",
              parameter_module_id: "group-sc",
              match_kind: "compatible",
              match_value: "sc8562",
              priority: 0,
            },
            {
              id: "m3",
              parameter_module_id: "group-i2c",
              match_kind: "compatible",
              match_value: "i2c@fdf5e000",
              priority: 0,
            },
          ],
          rowCount: 3,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const db = { query, transaction: vi.fn() } as unknown as Database;

    const result = await listDriverRegistry(db, makeAuth());

    expect(result.items.map((item) => item.moduleId).sort()).toEqual(["group-hl", "group-sc"]);
    const hl = result.items.find((item) => item.moduleId === "group-hl");
    expect(hl).toMatchObject({
      name: "hl7603",
      origin: "curated",
      businessCategoryId: "biz-power",
      businessCategoryName: "Power",
      observed: false,
      compatibles: ["huawei,bypass_bst_hl7603"],
    });
    expect(hl?.notYetObserved).toBe(true);

    const sc = result.items.find((item) => item.moduleId === "group-sc");
    expect(sc?.observed).toBe(true);
    expect(sc?.notYetObserved).toBe(false);
    expect(sc?.parameterCount).toBe(3);
  });
});

function projectionDatabase() {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    expect(values).toEqual(["org-1"]);
    if (text.includes("driver_registrations")) return { rows: [
      { module_id: "driver", driver_nature: "physical", instance_cardinality: "multiple", default_business_category_module_id: "default-category" },
    ] };
    if (text.includes("from parameter_modules")) return { rows: [
      { id: "category", name: "Category", kind: "business", origin: "curated", parent_id: null },
      { id: "driver", name: "Driver", kind: "driver-group", origin: "curated", parent_id: "category" },
      { id: "empty", name: "Empty", kind: "driver-group", origin: "curated", parent_id: null },
      { id: "scaffold-name", name: "i2c@FDF5E000", kind: "driver-group", origin: "auto", parent_id: null },
      { id: "scaffold-compatible", name: "Hidden", kind: "driver-group", origin: "auto", parent_id: null },
    ] };
    if (text.includes("from project_parameter_bindings")) return { rows: [{ module_id: "driver", parameter_spec_id: "spec" }] };
    if (text.includes("from parameter_module_mappings")) return { rows: [
      { id: "mapping", parameter_module_id: "driver", match_kind: "compatible", match_value: "vendor,driver", priority: 1 },
      { id: "scaffold", parameter_module_id: "scaffold-compatible", match_kind: "compatible", match_value: "i2c@fdf5e000", priority: 0 },
    ] };
    throw new Error("unexpected-projection-query");
  });
  return { query, transaction: vi.fn() } as unknown as Database;
}

describe("driver identity and placement projection", () => {
  const read = (db: Database, auth = makeAuth()) =>
    Reflect.get(service, "listDriverRegistryIdentityPlacements")(db, auth) as Promise<{ items: unknown[]; total: number }>;

  it("preserves every production identity field and filter while coverage stays in the production list", async () => {
    const cache = vi.spyOn(schemaCache, "getCachedOrganizationSchemaRegistry").mockResolvedValue({ drivers: [] } as never);
    const promoted = vi.spyOn(overlays, "listOrganizationDriverSchemas").mockResolvedValue([
      { compatible: "VENDOR,DRIVER", supersededBySchemaId: "promoted-schema" },
    ] as never);
    const lookup = vi.spyOn(coverage, "lookupParseCoverage").mockReturnValue({
      covered: true, scope: "platform", source: "vendor", pattern: "vendor,driver", driverId: "schema",
    });
    const projection = await read(projectionDatabase());
    expect(cache).not.toHaveBeenCalled();
    expect(promoted).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    const production = await listDriverRegistry(projectionDatabase(), makeAuth());
    expect(projection).toEqual({
      total: 2,
      items: production.items.map(({ parseCoverages: _coverage, ...identity }) => identity),
    });
    expect(projection.items).toEqual([
      { moduleId: "driver", name: "Driver", origin: "curated", businessCategoryId: "category", businessCategoryName: "Category",
        defaultBusinessCategoryId: "default-category", compatibles: ["vendor,driver"], parameterCount: 1, observed: true,
        notYetObserved: false, driverNature: "physical", instanceCardinality: "multiple" },
      { moduleId: "empty", name: "Empty", origin: "curated", businessCategoryId: null, businessCategoryName: null,
        defaultBusinessCategoryId: null, compatibles: [], parameterCount: 0, observed: false,
        notYetObserved: true, driverNature: null, instanceCardinality: null },
    ]);
    expect(production.items[0]!.parseCoverages).toEqual([{ compatible: "vendor,driver", coverage: {
      covered: true, scope: "platform", source: "vendor", pattern: "vendor,driver", driverId: "schema", promoted: true,
    } }]);
    expect(cache).toHaveBeenCalledTimes(1);
    expect(promoted).toHaveBeenCalledTimes(1);
  });

  it("does not turn a production coverage failure into an empty P0 inventory", async () => {
    const failure = new Error("schema-cache-unavailable");
    vi.spyOn(schemaCache, "getCachedOrganizationSchemaRegistry").mockRejectedValue(failure);
    expect((await read(projectionDatabase())).total).toBe(2);
    await expect(listDriverRegistry(projectionDatabase(), makeAuth())).rejects.toBe(failure);
  });

  it("retains view permission and actual database failure rejection", async () => {
    const db = projectionDatabase();
    const auth = makeTestAuthContext({ organizationId: "org-1", permissions: [] });
    await expect(read(db, auth)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.query).not.toHaveBeenCalled();
    const failure = new Error("source-query-unavailable");
    vi.mocked(db.query).mockRejectedValue(failure);
    await expect(read(db)).rejects.toBe(failure);
  });

  it("feeds the actual P0 consumer all module, mapping, dismissal, registration and placement rows without coverage I/O", async () => {
    const cache = vi.spyOn(schemaCache, "getCachedOrganizationSchemaRegistry").mockRejectedValue(new Error("no-checkout-schema"));
    const overlay = vi.spyOn(overlays, "listOrganizationDriverSchemas").mockRejectedValue(new Error("no-overlay-coverage"));
    const database = projectionDatabase();
    const db = { query: async (text: string, values?: unknown[]) => {
      if (text === "select id from organizations order by id") return { rows: [{ id: "org-1" }] };
      if (text.includes("from parameter_module_dismissed_compatibles dc\n")) return { rows: [
        { compatible: "dismissed,driver", reason: "operator", dismissed_at: "2026-01-01", binding_count: "0", project_count: "0" },
      ] };
      if (text.includes("group by lower(trim")) return { rows: [] };
      return database.query(text, values);
    }, transaction: vi.fn() } as unknown as Database;
    const inventory = await readModComparisonSourceInventory(db);
    expect(inventory.map(row => `${row.kind}:${row.id}`).sort()).toEqual([
      "parameter-module:category", "parameter-module:driver", "parameter-module:empty",
      "parameter-module:scaffold-name", "parameter-module:scaffold-compatible",
      "parameter-module-mapping:mapping", "parameter-module-mapping:scaffold",
      "parameter-module-dismissed-compatible:dismissed,driver",
      "subject-registration:driver", "subject-registration:empty", "subject-placement:driver",
    ].sort());
    expect(cache).not.toHaveBeenCalled();
    expect(overlay).not.toHaveBeenCalled();
  });
});
