import { describe, expect, it } from "vitest";

import { rollupSubtreeAttributionCounts } from "./subtreeCounts";

describe("rollupSubtreeAttributionCounts", () => {
  it("counts subtree bindings and distinct specs without summing overlapping definitions", () => {
    const modules = [
      { id: "business", parentId: null },
      { id: "group", parentId: "business" },
      { id: "node-a", parentId: "group" },
      { id: "node-b", parentId: "group" }
    ];
    const facts = [
      { moduleId: "node-a", parameterSpecId: "spec-shared" },
      { moduleId: "node-a", parameterSpecId: "spec-shared" },
      { moduleId: "node-b", parameterSpecId: "spec-shared" },
      { moduleId: "node-b", parameterSpecId: "spec-other" },
      { moduleId: "group", parameterSpecId: "spec-group" }
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
