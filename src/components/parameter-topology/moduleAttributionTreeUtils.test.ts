import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  canDeleteModule,
  canEditImportance,
  canMoveModule,
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
    importance: "medium",
    kind: "instance",
    origin: "auto",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 1
  }
];

describe("moduleAttributionTreeUtils", () => {
  it("defaults expansion to business and driver-group layers", () => {
    expect([...defaultExpandedModuleIds(modules)].sort()).toEqual(["b", "g"]);
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

  it("keeps ancestors when filtering by kind", () => {
    const visible = filterModulesForAttribution(modules, {
      kinds: ["instance"],
      origins: ["auto", "curated"]
    });
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g", "i"]);
  });
});
