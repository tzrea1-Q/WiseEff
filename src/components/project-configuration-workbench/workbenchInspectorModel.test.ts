import { describe, expect, it } from "vitest";

import {
  buildUnifiedDiff,
  canvasModeQueryValue,
  classifyNodeRisk,
  formatSourceSpan,
  inspectorBackTarget,
  parseCanvasMode,
  resolveInspectorLevel,
  shouldPersistInspector
} from "./workbenchInspectorModel";

describe("workbenchInspectorModel", () => {
  it("parses canvas modes and keeps structured/raw as working aliases", () => {
    expect(parseCanvasMode(null)).toBe("working");
    expect(parseCanvasMode("structured")).toBe("working");
    expect(parseCanvasMode("raw")).toBe("working");
    expect(parseCanvasMode("history")).toBe("history");
    expect(parseCanvasMode("unified-diff")).toBe("unified-diff");
    expect(parseCanvasMode("side-by-side")).toBe("side-by-side");
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

  it("builds a minimal unified diff and classifies risk/span labels", () => {
    expect(buildUnifiedDiff("a\nb\n", "a\nc\n", "working", "history")).toContain("-b");
    expect(buildUnifiedDiff("a\nb\n", "a\nc\n", "working", "history")).toContain("+c");
    expect(classifyNodeRisk("okay")).toBe("常规");
    expect(classifyNodeRisk("disabled")).toBe("偏高");
    expect(formatSourceSpan({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 11 })).toBe("L2:3–L2:11");
  });
});
