import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  aggregateSubtreeParameterCounts,
  canDeleteModule,
  canEditImportance,
  canMoveModule,
  canReclassifyModule,
  defaultExpandedModuleIds,
  filterModulesForAttribution,
  toBusinessFlatNodes
} from "./moduleAttributionTreeUtils";

const modules: ParameterModule[] = [
  {
    id: "b",
    name: "Power",
    parentId: null,
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "high",
    kind: "business",
    origin: "curated",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 0
  },
  {
    id: "g",
    name: "Group",
    parentId: "b",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "driver-group",
    origin: "auto",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 1
  },
  {
    id: "i",
    name: "Inst",
    parentId: "g",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "instance",
    origin: "auto",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 1
  }
];

describe("moduleAttributionTreeUtils", () => {
  it("defaults expansion to business categories only", () => {
    expect([...defaultExpandedModuleIds(modules)].sort()).toEqual(["b"]);
  });

  it("restricts move targets to business modules", () => {
    expect(toBusinessFlatNodes(modules).map((node) => node.id)).toEqual(["b"]);
  });

  it("enforces kind-scoped write guards", () => {
    expect(canDeleteModule(modules[2]!)).toBe(false);
    expect(canMoveModule(modules[2]!)).toBe(false);
    expect(canEditImportance(modules[0]!)).toBe(true);
    expect(canEditImportance(modules[1]!)).toBe(false);
    expect(canDeleteModule(modules[1]!)).toBe(true);
  });

  it("allows moving logical nodes but not deleting them", () => {
    const logical: ParameterModule = {
      ...modules[2]!,
      id: "l",
      name: "btb_check",
      kind: "logical"
    };
    expect(canMoveModule(logical)).toBe(true);
    expect(canDeleteModule(logical)).toBe(false);
    expect(canReclassifyModule(logical)).toBe(true);
    expect(canReclassifyModule(modules[1]!)).toBe(false);
  });

  it("keeps ancestors when filtering by kind", () => {
    const visible = filterModulesForAttribution(modules, {
      kinds: ["instance"],
      origins: ["auto", "curated"]
    });
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g", "i"]);
  });

  it("rolls direct parameter counts up the parent tree for display", () => {
    const totals = aggregateSubtreeParameterCounts(modules);
    expect(totals.get("i")).toBe(1);
    expect(totals.get("g")).toBe(2); // group direct 1 + instance 1
    expect(totals.get("b")).toBe(2); // business 0 + subtree 2
  });
});
