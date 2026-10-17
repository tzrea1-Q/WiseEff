import { describe, expect, it } from "vitest";

import {
  buildUnifiedDiff,
  canvasModeQueryValue,
  classifyNodeRisk,
  formatSourceCanvasEmpty,
  formatSourceSpan,
  inspectorBackTarget,
  parseCanvasMode,
  resolveInspectorLevel,
  shouldPersistInspector
} from "./workbenchInspectorModel";

describe("workbenchInspectorModel", () => {
  it("routes an empty source update view to the single toolbar entry without adding an upload action", () => {
    expect(formatSourceCanvasEmpty("candidate", null, "", "working", "", false)).toEqual({
      title: "尚未选择来源更新",
      message: "从顶部打开来源更新，上传文件或继续已有记录。上传不会自动改变工作配置。",
      actionLabel: undefined
    });
    expect(formatSourceCanvasEmpty("candidate", null, "", "working", "incoming", false)).toBeNull();
  });
  it("parses canvas modes and keeps structured/raw as working aliases", () => {
    expect(parseCanvasMode(null)).toBe("working");
    expect(parseCanvasMode("structured")).toBe("working");
    expect(parseCanvasMode("raw")).toBe("working");
    expect(parseCanvasMode("history")).toBe("history");
    expect(parseCanvasMode("unified-diff")).toBe("unified-diff");
    expect(parseCanvasMode("side-by-side")).toBe("unified-diff");
    expect(parseCanvasMode("candidate")).toBe("candidate");
    expect(canvasModeQueryValue("working")).toBeNull();
    expect(canvasModeQueryValue("history")).toBe("history");
    expect(canvasModeQueryValue("candidate")).toBe("candidate");
  });

  it("resolves inspector level and back targets without clearing file on config-set back", () => {
    expect(resolveInspectorLevel({ fileSelected: false, nodePath: null, propertyName: null })).toBe("config-set");
    expect(resolveInspectorLevel({ fileSelected: true, nodePath: null, propertyName: null })).toBe("file");
    expect(resolveInspectorLevel({ fileSelected: true, nodePath: "board", propertyName: null })).toBe("node");
    expect(resolveInspectorLevel({ fileSelected: true, nodePath: "board", propertyName: "model" })).toBe("property");
    expect(inspectorBackTarget("activity")).toMatchObject({
      clearActivity: true,
      clearFile: false,
      clearNode: false,
      clearProperty: false
    });
    expect(inspectorBackTarget("property")).toEqual({
      level: "node",
      clearNode: false,
      clearProperty: true,
      clearFile: false,
      clearActivity: true
    });
    expect(inspectorBackTarget("node").clearNode).toBe(true);
    expect(inspectorBackTarget("file").clearFile).toBe(false);
  });

  it("persists inspector only when source canvas keeps at least 640px", () => {
    expect(shouldPersistInspector({ workbenchWidth: 1128, treeWidth: 260 })).toBe(false);
    expect(shouldPersistInspector({ workbenchWidth: 1280, treeWidth: 260 })).toBe(true);
    expect(shouldPersistInspector({ workbenchWidth: 900, treeWidth: 34 })).toBe(false);
  });

  it("builds a minimal unified diff and avoids inferring change risk from device availability", () => {
    expect(buildUnifiedDiff("a\nb\n", "a\nc\n", "working", "history")).toContain("-b");
    expect(buildUnifiedDiff("a\nb\n", "a\nc\n", "working", "history")).toContain("+c");
    for (const status of [undefined, "okay", "disabled", "reserved"]) expect(classifyNodeRisk(status)).toBe("未评估");
    expect(formatSourceSpan({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 11 })).toBe("L2:3–L2:11");
  });

  it("keeps unchanged lines aligned after insertion and deletion with numbered context hunks", () => {
    expect(buildUnifiedDiff("a\nb\nc\n", "a\ninserted\nb\nc\n", "before", "after"))
      .toBe("--- before\n+++ after\n@@ -1,3 +1,4 @@\n a\n+inserted\n b\n c");
    expect(buildUnifiedDiff("a\nb\nc\n", "a\nc\n", "before", "after"))
      .toBe("--- before\n+++ after\n@@ -1,3 +1,2 @@\n a\n-b\n c");
    expect(buildUnifiedDiff("", "added\n", "before", "after"))
      .toBe("--- before\n+++ after\n@@ -0,0 +1,1 @@\n+added");
    expect(buildUnifiedDiff("removed\n", "", "before", "after"))
      .toBe("--- before\n+++ after\n@@ -1,1 +0,0 @@\n-removed");
    expect(buildUnifiedDiff("a\nb\na\nb\n", "a\na\nb\n", "before", "after"))
      .toBe("--- before\n+++ after\n@@ -1,4 +1,3 @@\n a\n-b\n a\n b");
  });

  it("limits context, separates distant changes, and preserves final newline changes", () => {
    const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
    const after = before.replace("line 5\n", "updated 5\n").replace("line 25\n", "updated 25\n");
    const diff = buildUnifiedDiff(before, after, "before", "after");
    expect(diff.match(/^@@ /gm)).toHaveLength(2);
    expect(diff).toContain("@@ -2,7 +2,7 @@");
    expect(diff).toContain("@@ -22,7 +22,7 @@");
    expect(diff).not.toContain("line 15");
    expect(buildUnifiedDiff("same", "same\n", "before", "after"))
      .toContain("-same\n\\ No newline at end of file\n+same");
    expect(buildUnifiedDiff(before, before, "before", "after")).toBe("--- before\n+++ after");
  });

  it("bounds unrelated large comparisons with an explicit whole-block replacement and no lost lines", () => {
    const before = "before\n".repeat(1500);
    const after = "after\n".repeat(1500);
    const diff = buildUnifiedDiff(before, after, "before", "after");
    expect(diff).toContain("# 差异较大，以下按整块替换显示。");
    expect(diff).toContain("@@ -1,1500 +1,1500 @@");
    expect(diff.split("\n").filter((line) => line === "-before")).toHaveLength(1500);
    expect(diff.split("\n").filter((line) => line === "+after")).toHaveLength(1500);
  });
});
