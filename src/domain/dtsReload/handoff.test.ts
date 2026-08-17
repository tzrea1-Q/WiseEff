import { describe, expect, it } from "vitest";

import {
  buildDtsReloadHandoffPath,
  parseDtsReloadHandoffQuery,
  resolveWorkbenchReloadHandoff
} from "./handoff";

describe("parseDtsReloadHandoffQuery / buildDtsReloadHandoffPath", () => {
  it("round-trips project and binding ids without touching runId", () => {
    const path = buildDtsReloadHandoffPath({
      projectId: "project-teaching",
      bindingIds: ["binding-a", "binding-b"]
    });
    expect(path).toBe("/dts-reload?project=project-teaching&bindingIds=binding-a%2Cbinding-b");
    expect(parseDtsReloadHandoffQuery(path.slice(path.indexOf("?")))).toEqual({
      projectId: "project-teaching",
      bindingIds: ["binding-a", "binding-b"]
    });
  });

  it("drops empty ids and preserves first-seen order", () => {
    expect(
      parseDtsReloadHandoffQuery("project=p1&bindingIds=b1,,b2,b1&runId=run-9")
    ).toEqual({ projectId: "p1", bindingIds: ["b1", "b2"] });
  });

  it("returns an empty binding list when the query has no handoff ids", () => {
    expect(parseDtsReloadHandoffQuery("runId=run-1")).toEqual({ projectId: null, bindingIds: [] });
  });
});

describe("resolveWorkbenchReloadHandoff", () => {
  const base = {
    projectId: "project-1",
    selectedDraftBindingIds: new Set<string>(),
    visibleBindingIds: ["a", "b", "c"],
    totalRowCount: 3
  };

  it("prefers draft checkbox selection over a narrowed visible set", () => {
    expect(
      resolveWorkbenchReloadHandoff({
        ...base,
        selectedDraftBindingIds: new Set(["b"]),
        visibleBindingIds: ["a"]
      })
    ).toEqual({ ok: true, bindingIds: ["b"], source: "draft-selection" });
  });

  it("uses the narrowed visible set instead of dumping the whole table", () => {
    expect(
      resolveWorkbenchReloadHandoff({
        ...base,
        visibleBindingIds: ["a"],
        totalRowCount: 3
      })
    ).toEqual({ ok: true, bindingIds: ["a"], source: "visible-filter" });
  });

  it("stays disabled when the table is unfiltered and nothing is selected", () => {
    const result = resolveWorkbenchReloadHandoff(base);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.disabledReason).toContain("请先勾选草稿");
    }
  });

  it("stays disabled without a project id", () => {
    const result = resolveWorkbenchReloadHandoff({ ...base, projectId: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.disabledReason).toContain("缺少项目");
    }
  });
});
