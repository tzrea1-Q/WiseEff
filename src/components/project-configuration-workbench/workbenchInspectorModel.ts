export type WorkbenchCanvasMode = "working" | "history" | "unified-diff" | "candidate";

export type InspectorLevel = "config-set" | "file" | "node" | "property" | "activity" | "release" | "versions" | "candidates";

export function formatSourceCanvasEmpty(mode: WorkbenchCanvasMode, versionId: string | null, historySource: string, workingSource: string, candidateSource: string, historySourceAvailable: boolean) {
  return mode === "unified-diff"
    ? !versionId
      ? { title: "选择要对比的版本", message: "从版本历史中选择一个版本，与工作配置进行只读对比。", actionLabel: "选择版本" }
      : !historySourceAvailable
        ? { title: "对比版本不可用", message: "该版本已被清理或尚未生成；可返回工作源查看当前配置。", actionLabel: "返回工作源" }
        : historySource === workingSource
          ? { title: "两个版本没有差异", message: "所选版本与工作配置的源码内容一致。", actionLabel: undefined }
          : null
    : mode === "candidate" && !candidateSource
      ? { title: "尚未选择来源更新", message: "从顶部打开来源更新，上传文件或继续已有记录。上传不会自动改变工作配置。", actionLabel: undefined }
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
      return "unified-diff";
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
    case "release":
    case "versions":
    case "candidates":
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

export function classifyNodeRisk(_status: string | undefined): string {
  // Device availability is not evidence of the risk of changing its configuration.
  return "未评估";
}

type DiffLine = { marker: " " | "+" | "-"; text: string };

function diffLines(left: string[], right: string[]): { lines: DiffLine[]; bounded: boolean } {
  const trace: Map<number, number>[] = [];
  let frontier = new Map([[1, 0]]);
  let work = 0;
  for (let depth = 0; depth <= left.length + right.length; depth += 1) {
    const next = new Map<number, number>();
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      // ponytail: cap Myers trace work at 1M steps for unrelated large files; use
      // linear-space Myers if minimal hunks beyond this ceiling become necessary.
      if (++work > 1_000_000) return { bounded: true, lines: [
        ...left.map((text): DiffLine => ({ marker: "-", text })),
        ...right.map((text): DiffLine => ({ marker: "+", text }))
      ] };
      let x = diagonal === -depth || (diagonal !== depth &&
        (frontier.get(diagonal - 1) ?? -1) < (frontier.get(diagonal + 1) ?? -1))
        ? frontier.get(diagonal + 1) ?? 0 : (frontier.get(diagonal - 1) ?? 0) + 1;
      let y = x - diagonal;
      while (x < left.length && y < right.length && left[x] === right[y]) { x += 1; y += 1; }
      next.set(diagonal, x);
      if (x < left.length || y < right.length) continue;
      trace.push(next);
      const result: DiffLine[] = [];
      for (let step = trace.length - 1; step > 0; step -= 1) {
        const previous = trace[step - 1]!;
        const k = x - y;
        const previousK = k === -step || (k !== step &&
          (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1)) ? k + 1 : k - 1;
        const previousX = previous.get(previousK) ?? 0;
        const previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          result.push({ marker: " ", text: left[--x]! }); y -= 1;
        }
        if (x === previousX) result.push({ marker: "+", text: right[--y]! });
        else result.push({ marker: "-", text: left[--x]! });
      }
      while (x > 0 && y > 0) { result.push({ marker: " ", text: left[--x]! }); y -= 1; }
      return { lines: result.reverse(), bounded: false };
    }
    trace.push(next);
    frontier = next;
  }
  return { lines: [], bounded: false };
}

export function buildUnifiedDiff(left: string, right: string, leftLabel: string, rightLabel: string): string {
  const split = (text: string) => text === "" ? [] : text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const leftLines = split(left);
  const rightLines = split(right);
  let prefix = 0;
  let suffix = 0;
  while (prefix < Math.min(leftLines.length, rightLines.length) && leftLines[prefix] === rightLines[prefix]) prefix += 1;
  while (suffix < Math.min(leftLines.length, rightLines.length) - prefix &&
    leftLines[leftLines.length - suffix - 1] === rightLines[rightLines.length - suffix - 1]) suffix += 1;
  const difference = diffLines(leftLines.slice(prefix, leftLines.length - suffix), rightLines.slice(prefix, rightLines.length - suffix));
  const context = (lines: string[]) => lines.map((text): DiffLine => ({ marker: " ", text }));
  const edits = [...context(leftLines.slice(0, prefix)), ...difference.lines,
    ...context(suffix ? leftLines.slice(-suffix) : [])];
  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < edits.length; index += 1) {
    if (edits[index]!.marker === " ") continue;
    const start = Math.max(0, index - 3);
    const end = Math.min(edits.length, index + 4);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end) previous.end = end;
    else ranges.push({ start, end });
  }
  const out: string[] = [`--- ${leftLabel}`, `+++ ${rightLabel}`];
  if (difference.bounded) out.unshift("# 差异较大，以下按整块替换显示。");
  let oldLine = 1;
  let newLine = 1;
  let cursor = 0;
  for (const range of ranges) {
    while (cursor < range.start) {
      if (edits[cursor]!.marker !== "+") oldLine += 1;
      if (edits[cursor]!.marker !== "-") newLine += 1;
      cursor += 1;
    }
    const hunk = edits.slice(range.start, range.end);
    const oldCount = hunk.filter((line) => line.marker !== "+").length;
    const newCount = hunk.filter((line) => line.marker !== "-").length;
    out.push(`@@ -${oldCount ? oldLine : oldLine - 1},${oldCount} +${newCount ? newLine : newLine - 1},${newCount} @@`);
    for (const line of hunk) {
      out.push(`${line.marker}${line.text.replace(/\n$/, "")}`);
      if (!line.text.endsWith("\n")) out.push("\\ No newline at end of file");
    }
    oldLine += oldCount;
    newLine += newCount;
    cursor = range.end;
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
