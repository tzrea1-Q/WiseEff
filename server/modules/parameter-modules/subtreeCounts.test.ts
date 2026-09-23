import { describe, expect, it } from "vitest";

import { rollupSubtreeAttributionCounts } from "./subtreeCounts";

describe("rollupSubtreeAttributionCounts", () => {
  it("keeps current binding counts separate from active definition counts", () => {
    const totals = rollupSubtreeAttributionCounts([{ id: "module", parentId: null }], [
      { moduleId: "module", bindingId: "bound-retired-definition", definitionId: null },
      { moduleId: "module", bindingId: null, definitionId: "active-unbound-definition" }
    ]);
    expect(totals.get("module")).toEqual({ parameterCount: 1, definitionCount: 1 });
  });
  it("counts subtree bindings and distinct definitions without summing overlapping definitions", () => {
    const modules = [
      { id: "business", parentId: null },
      { id: "group", parentId: "business" },
      { id: "node-a", parentId: "group" },
      { id: "node-b", parentId: "group" }
    ];
    const facts = [
      { moduleId: "node-a", definitionId: "spec-shared" },
      { moduleId: "node-a", definitionId: "spec-shared" },
      { moduleId: "node-b", definitionId: "spec-shared" },
      { moduleId: "node-b", definitionId: "spec-other" },
      { moduleId: "group", definitionId: "spec-group" }
    ];

    const totals = rollupSubtreeAttributionCounts(modules, facts);

    expect(totals.get("node-a")).toEqual({ parameterCount: 2, definitionCount: 1 });
    expect(totals.get("node-b")).toEqual({ parameterCount: 2, definitionCount: 2 });
    expect(totals.get("group")).toEqual({ parameterCount: 5, definitionCount: 3 });
    expect(totals.get("business")).toEqual({ parameterCount: 5, definitionCount: 3 });
  });

  it("returns zero counts when a subtree has no bindings", () => {
    const totals = rollupSubtreeAttributionCounts(
      [
        { id: "empty", parentId: null },
        { id: "child", parentId: "empty" }
      ],
      []
    );

    expect(totals.get("empty")).toEqual({ parameterCount: 0, definitionCount: 0 });
    expect(totals.get("child")).toEqual({ parameterCount: 0, definitionCount: 0 });
  });
});
