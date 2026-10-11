export type WorkbenchCanvasMode = "working" | "history" | "unified-diff" | "side-by-side" | "candidate";

export type InspectorLevel = "config-set" | "file" | "node" | "property" | "activity";

export function formatSourceCanvasEmpty(mode: WorkbenchCanvasMode, versionId: string | null, historySource: string, workingSource: string, candidateSource: string, historySourceAvailable: boolean) {
  return mode === "unified-diff" || mode === "side-by-side"
    ? !versionId
      ? { title: "选择要对比的版本", message: "从版本历史中选择一个版本，与工作配置进行只读对比。", actionLabel: "选择版本" }
      : !historySourceAvailable
        ? { title: "对比版本不可用", message: "该版本已被清理或尚未生成；可返回工作源查看当前配置。", actionLabel: "返回工作源" }
        : historySource === workingSource
          ? { title: "两个版本没有差异", message: "所选版本与工作配置的源码内容一致。", actionLabel: undefined }
          : null
    : mode === "candidate" && !candidateSource
      ? { title: "暂无上传的候选", message: "上传候选后可在这里查看只读源码；上传不会自动激活工作配置。", actionLabel: "上传候选" }
      : mode === "history" && !historySource
        ? { title: "暂无历史版本", message: "首次发布后，历史版本的只读源码会显示在这里。", actionLabel: undefined }
        : null;
}

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
  clearActivity: boolean;
} {
  switch (level) {
    case "activity":
      return {
        level: "config-set",
        clearNode: false,
        clearProperty: false,
        clearFile: false,
        clearActivity: true
      };
    case "property":
      return { level: "node", clearNode: false, clearProperty: true, clearFile: false, clearActivity: true };
    case "node":
      return { level: "file", clearNode: true, clearProperty: true, clearFile: false, clearActivity: true };
    case "file":
      return {
        level: "config-set",
        clearNode: true,
        clearProperty: true,
        clearFile: false,
        clearActivity: true
      };
    default:
      return {
        level: "config-set",
        clearNode: false,
        clearProperty: false,
        clearFile: false,
        clearActivity: true
      };
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
