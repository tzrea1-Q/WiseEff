export type WorkbenchCanvasMode = "working" | "history" | "unified-diff" | "side-by-side" | "candidate";

export type InspectorLevel = "config-set" | "file" | "node" | "property";

export function parseCanvasMode(raw: string | null | undefined): WorkbenchCanvasMode {
  switch (raw) {
    case "history":
      return "history";
    case "unified-diff":
      return "unified-diff";
    case "side-by-side":
      return "side-by-side";
    case "candidate":
      return "candidate";
    case "working":
    case "structured":
    case "raw":
    case null:
    case undefined:
    case "":
      return "working";
    default:
      return "working";
  }
}

export function canvasModeQueryValue(mode: WorkbenchCanvasMode): string | null {
  return mode === "working" ? null : mode;
}

export function resolveInspectorLevel(input: {
  fileSelected: boolean;
  nodePath: string | null | undefined;
  propertyName: string | null | undefined;
}): InspectorLevel {
  if (input.propertyName && input.nodePath) return "property";
  if (input.nodePath) return "node";
  if (input.fileSelected) return "file";
  return "config-set";
}

export function inspectorBackTarget(level: InspectorLevel): {
  level: InspectorLevel;
  clearNode: boolean;
  clearProperty: boolean;
  clearFile: boolean;
} {
  switch (level) {
    case "property":
      return { level: "node", clearNode: false, clearProperty: true, clearFile: false };
    case "node":
      return { level: "file", clearNode: true, clearProperty: true, clearFile: false };
    case "file":
      return { level: "config-set", clearNode: true, clearProperty: true, clearFile: false };
    default:
      return { level: "config-set", clearNode: false, clearProperty: false, clearFile: false };
  }
}

/** PCW-D15: persistent inspector only when source canvas keeps ≥640px. */
export function shouldPersistInspector(input: {
  workbenchWidth: number;
  treeWidth: number;
  inspectorWidth?: number;
  sourceMinWidth?: number;
}): boolean {
  const inspectorWidth = input.inspectorWidth ?? 360;
  const sourceMinWidth = input.sourceMinWidth ?? 640;
  return input.workbenchWidth - input.treeWidth - inspectorWidth >= sourceMinWidth;
}

export function classifyNodeRisk(status: string | undefined): string {
  if (!status || status === "okay" || status === "ok") return "常规";
  if (status === "disabled" || status === "reserved") return "偏高";
  return "未评估";
}

export function buildUnifiedDiff(left: string, right: string, leftLabel: string, rightLabel: string): string {
  const leftLines = left.split("\n");
  const rightLines = right.split("\n");
  const max = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  for (let i = 0; i < max; i += 1) {
    const a = leftLines[i];
    const b = rightLines[i];
    if (a === b) {
      if (a !== undefined) out.push(` ${a}`);
      continue;
    }
    if (a !== undefined) out.push(`-${a}`);
    if (b !== undefined) out.push(`+${b}`);
  }
  return out.join("\n");
}

export function formatSourceSpan(source?: {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}): string {
  if (!source) return "未记录";
  return `L${source.startLine}:${source.startColumn}–L${source.endLine}:${source.endColumn}`;
}
