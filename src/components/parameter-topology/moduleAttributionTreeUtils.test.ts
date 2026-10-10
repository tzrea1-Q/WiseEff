import { describe, expect, it } from "vitest";

import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import {
  aggregateSubtreeAttributionCounts,
  addChildModuleDecision,
  canAddChildModule,
  canDeleteModule,
  canEditImportance,
  canMoveModule,
  defaultExpandedModuleIds,
  deleteModuleDecision,
  filterModulesForAttribution,
  isNotYetObservedModule,
  siblingModules,
  sortOrderSwapUpdates,
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
    parameterCount: 0,
    definitionCount: 0
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
    parameterCount: 1,
    definitionCount: 1
  },
  {
    id: "i",
    name: "sc8562",
    parentId: "g",
    sortOrder: 0,
    description: "",
    scope: "",
    importance: "medium",
    kind: "node-type",
    origin: "auto",
    sourceKey: null,
    effectiveImportance: "high",
    parameterCount: 2,
    definitionCount: 1
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
    expect(deleteModuleDecision(modules[2]!).allowed).toBe(false);
    expect(canMoveModule(modules[2]!)).toBe(true);
    expect(canEditImportance(modules[0]!)).toBe(true);
    expect(canEditImportance(modules[1]!)).toBe(false);
    expect(canDeleteModule(modules[1]!)).toBe(true);
  });

  it("returns reasons for forbidden child creation on node-type modules", () => {
    const decision = addChildModuleDecision(modules[2]!);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toMatch(/节点类型/);
    }
  });

  it("swaps sortOrder among siblings for reorder", () => {
    const siblings: ParameterModule[] = [
      { ...modules[0]!, sortOrder: 0 },
      {
        ...modules[0]!,
        id: "b2",
        name: "Thermal",
        sortOrder: 1
      }
    ];
    const updates = sortOrderSwapUpdates(siblings[1]!, "up", siblings);
    expect(updates).toEqual([
      { id: "b2", sortOrder: 0 },
      { id: "b", sortOrder: 1 }
    ]);
    expect(siblingModules(siblings, siblings[1]!).map((module) => module.id)).toEqual(["b", "b2"]);
  });

  it.each(["driver-group", "node-type"] as const)("rejects either historical %s swap participant only in canonical mode", (kind) => {
    const business = modules[0]!;
    const historical = { ...modules[1]!, kind, parentId: null, sortOrder: 10 };
    const siblings = [business, historical];
    expect(sortOrderSwapUpdates(business, "down", siblings, true)).toBeNull();
    expect(sortOrderSwapUpdates(historical, "up", siblings, true)).toBeNull();
    expect(sortOrderSwapUpdates(business, "down", siblings)).toEqual([
      { id: "b", sortOrder: 10 }, { id: "g", sortOrder: 0 }
    ]);
  });


  it("keeps ancestors when filtering by kind", () => {
    const visible = filterModulesForAttribution(modules, {
      kinds: ["node-type"],
      origins: ["auto", "curated"],
      hideNotYetObserved: false,
      onlyUncoveredParse: false
    });
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g", "i"]);
  });

  it("rolls direct definition and occurrence counts up the parent tree for mock display", () => {
    const totals = aggregateSubtreeAttributionCounts(modules);
    expect(totals.get("i")).toEqual({ parameterCount: 2, definitionCount: 1 });
    expect(totals.get("g")).toEqual({ parameterCount: 3, definitionCount: 2 });
    expect(totals.get("b")).toEqual({ parameterCount: 3, definitionCount: 2 });
  });

  it("marks curated empty driver-group and node-type modules as not yet observed", () => {
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
    expect(isNotYetObservedModule(modules[1]!)).toBe(false);
  });

  it("keeps historical child-add guards for read-only module rows", () => {
    expect(canAddChildModule(modules[0]!)).toBe(true);
    expect(canAddChildModule(modules[1]!)).toBe(true);
    expect(canAddChildModule(modules[2]!)).toBe(false);
  });

  it("returns disabled reasons and swaps only sibling sort orders", () => {
    const unclassified: ParameterModule = {
      ...modules[0]!,
      id: "u",
      name: "未分类",
      kind: "unclassified",
      origin: "auto",
      sortOrder: 99
    };
    const sibling: ParameterModule = {
      ...modules[1]!,
      id: "g2",
      name: "Group 2",
      sortOrder: 10
    };

    expect(deleteModuleDecision(modules[2]!)).toEqual({
      allowed: false,
      reason: "节点类型不可删除，请改挂到其它父级或联系运维。"
    });
    expect(addChildModuleDecision(unclassified)).toEqual({
      allowed: false,
      reason: "该模块类型不可添加子模块。"
    });
    expect(sortOrderSwapUpdates(modules[1]!, "down", [...modules, sibling])).toEqual([
      { id: "g", sortOrder: 10 },
      { id: "g2", sortOrder: 0 }
    ]);
    expect(sortOrderSwapUpdates(modules[1]!, "up", [...modules, sibling])).toBeNull();
  });

  it("summarizes parse coverage per driver-group module", () => {
    const summary = summarizeDriverCoverage([
      {
        moduleId: "g",
        name: "Group",
        origin: "auto",
        businessCategoryId: "b",
        businessCategoryName: "Power",
        defaultBusinessCategoryId: "b",
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

  it("counts promoted coverages when platform coverage replaces a superseded org overlay", () => {
    const summary = summarizeDriverCoverage([
      {
        moduleId: "g",
        name: "Group",
        origin: "auto",
        businessCategoryId: "b",
        businessCategoryName: "Power",
        defaultBusinessCategoryId: "b",
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
              driverId: "driver:platform/a:v1",
              source: "manual",
              scope: "platform",
              promoted: true
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
      shadowedCount: 0,
      promotedCount: 1
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
        defaultBusinessCategoryId: "b",
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
        defaultBusinessCategoryId: "b",
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
        kinds: ["business", "driver-group", "node-type", "unclassified"],
        origins: ["curated", "auto"],
        hideNotYetObserved: false,
        onlyUncoveredParse: true
      },
      coverage
    );
    expect(visible.map((module) => module.id).sort()).toEqual(["b", "g"]);
  });
});
