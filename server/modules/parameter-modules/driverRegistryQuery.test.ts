import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../auth/types";
import type { Database } from "../../shared/database/client";
import { makeTestAuthContext } from "../../testing/authContext";
import { listDriverRegistry } from "./service";

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
