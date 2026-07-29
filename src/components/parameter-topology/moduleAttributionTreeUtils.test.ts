import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  aggregateSubtreeParameterCounts,
  allowedCreateKindsForParent,
  canAddChildModule,
  canDeleteModule,
  canEditImportance,
  canMoveModule,
  canReclassifyModule,
  defaultExpandedModuleIds,
  filterModulesForAttribution,
  isNotYetObservedModule,
  summarizeDriverCoverage,
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
      origins: ["auto", "curated"],
      hideNotYetObserved: false,
      onlyUncoveredParse: false
    });
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g", "i"]);
  });

  it("rolls direct parameter counts up the parent tree for display", () => {
    const totals = aggregateSubtreeParameterCounts(modules);
    expect(totals.get("i")).toBe(1);
    expect(totals.get("g")).toBe(2); // group direct 1 + instance 1
    expect(totals.get("b")).toBe(2); // business 0 + subtree 2
  });

  it("marks curated empty driver-group, instance, and logical modules as not yet observed", () => {
    expect(
      isNotYetObservedModule({
        ...modules[1]!,
        origin: "curated",
        parameterCount: 0
      })
    ).toBe(true);
    expect(
      isNotYetObservedModule({
        ...modules[2]!,
        origin: "curated",
        parameterCount: 0
      })
    ).toBe(true);
    expect(
      isNotYetObservedModule({
        ...modules[2]!,
        kind: "logical",
        origin: "curated",
        parameterCount: 0
      })
    ).toBe(true);
    expect(isNotYetObservedModule(modules[1]!)).toBe(false);
  });

  it("scopes create kinds by parent kind", () => {
    expect(allowedCreateKindsForParent(null)).toEqual(["business"]);
    expect(allowedCreateKindsForParent("business")).toEqual([
      "business",
      "driver-group",
      "logical"
    ]);
    expect(allowedCreateKindsForParent("driver-group")).toEqual(["instance"]);
    expect(canAddChildModule(modules[0]!)).toBe(true);
    expect(canAddChildModule(modules[1]!)).toBe(true);
    expect(canAddChildModule(modules[2]!)).toBe(false);
  });

  it("summarizes parse coverage per driver-group module", () => {
    const summary = summarizeDriverCoverage([
      {
        moduleId: "g",
        name: "Group",
        origin: "auto",
        businessCategoryId: "b",
        businessCategoryName: "Power",
        compatibles: ["a", "b", "c"],
        parameterCount: 1,
        observed: true,
        notYetObserved: false,
        parseCoverages: [
          {
            compatible: "a",
            coverage: { covered: true, pattern: "a", driverId: "d1", source: "yaml", scope: "platform" }
          },
          {
            compatible: "b",
            coverage: {
              covered: true,
              pattern: "b",
              driverId: "driver:org/org-1/b:v1",
              source: "manual",
              scope: "organization"
            }
          },
          { compatible: "c", coverage: { covered: false } }
        ]
      }
    ]);
    expect(summary.get("g")).toEqual({
      total: 3,
      covered: 2,
      overlayCovered: 1,
      platformCovered: 1,
      shadowedCount: 0,
      promotedCount: 0
    });
  });

  it("counts shadowed coverages when a lower-tier match lost to platform", () => {
    const summary = summarizeDriverCoverage([
      {
        moduleId: "g",
        name: "Group",
        origin: "auto",
        businessCategoryId: "b",
        businessCategoryName: "Power",
        compatibles: ["a"],
        parameterCount: 1,
        observed: true,
        notYetObserved: false,
        parseCoverages: [
          {
            compatible: "a",
            coverage: {
              covered: true,
              pattern: "a",
              driverId: "vendor-a",
              source: "vendor",
              scope: "platform",
              shadowedBy: [
                {
                  pattern: "a",
                  driverId: "driver:org/org-1/a:v1",
                  source: "manual",
                  scope: "organization"
                }
              ]
            }
          }
        ]
      }
    ]);
    expect(summary.get("g")).toEqual({
      total: 1,
      covered: 1,
      overlayCovered: 0,
      platformCovered: 1,
      shadowedCount: 1,
      promotedCount: 0
    });
  });

  it("filters to uncovered driver-groups while keeping ancestors", () => {
    const coverage = summarizeDriverCoverage([
      {
        moduleId: "g",
        name: "Group",
        origin: "auto",
        businessCategoryId: "b",
        businessCategoryName: "Power",
        compatibles: ["a"],
        parameterCount: 1,
        observed: true,
        notYetObserved: false,
        parseCoverages: [{ compatible: "a", coverage: { covered: false } }]
      }
    ]);
    const visible = filterModulesForAttribution(
      modules,
      {
        kinds: ["business", "driver-group", "instance", "logical", "unclassified"],
        origins: ["curated", "auto"],
        hideNotYetObserved: false,
        onlyUncoveredParse: true
      },
      coverage
    );
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g"]);
  });
});
