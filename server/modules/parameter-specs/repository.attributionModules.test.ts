import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../shared/database/client";
import { loadAttributionModulesBySpecIds } from "./repository";

function makeDb(rows: Array<{
  parameter_spec_id: string;
  id: string;
  name: string;
  kind: "driver-group" | "node-type";
  path_names: string[];
}>): Queryable {
  return {
    query: vi.fn(async () => ({ rows })),
  };
}

describe("loadAttributionModulesBySpecIds", () => {
  it("returns an empty map when no spec ids are requested", async () => {
    const db = makeDb([]);
    const result = await loadAttributionModulesBySpecIds(db, {
      organizationId: "org-1",
      specIds: [],
    });
    expect(result.size).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("groups distinct attribution modules per spec with root-to-leaf paths", async () => {
    const db = makeDb([
      {
        parameter_spec_id: "spec-a",
        id: "mod-charge",
        name: "充电策略",
        kind: "driver-group",
        path_names: ["Power", "充电策略"],
      },
      {
        parameter_spec_id: "spec-b",
        id: "mod-mt",
        name: "mt5788",
        kind: "driver-group",
        path_names: ["Wireless Charging", "mt5788"],
      },
      {
        parameter_spec_id: "spec-c",
        id: "mod-comp",
        name: "direct_charge_comp",
        kind: "node-type",
        path_names: ["Power", "Direct Charging", "direct_charge_comp"],
      },
    ]);

    const result = await loadAttributionModulesBySpecIds(db, {
      organizationId: "org-1",
      specIds: ["spec-a", "spec-b", "spec-c", "spec-empty"],
    });

    expect(result.get("spec-a")).toEqual([
      { id: "mod-charge", name: "充电策略", kind: "driver-group", path: ["Power", "充电策略"] },
    ]);
    expect(result.get("spec-b")).toEqual([
      { id: "mod-mt", name: "mt5788", kind: "driver-group", path: ["Wireless Charging", "mt5788"] },
    ]);
    expect(result.get("spec-c")).toEqual([
      {
        id: "mod-comp",
        name: "direct_charge_comp",
        kind: "node-type",
        path: ["Power", "Direct Charging", "direct_charge_comp"],
      },
    ]);
    expect(result.get("spec-empty")).toBeUndefined();
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("with recursive leaves"),
      ["org-1", ["spec-a", "spec-b", "spec-c", "spec-empty"]],
    );
  });
});
