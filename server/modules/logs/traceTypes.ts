import type { AnalyzeLogInput } from "./analyzer";

export type LogAnalysisTraceStep = {
  index: number;
  kind: "tool-call" | "model-turn" | "early-convergence" | "rule-fallback" | "degradation";
  tool: string | null;
  arguments: Record<string, string | number | boolean | null>;
  resultBytes: number;
  lines: Array<{ file: string; line: number; snapshotId?: string }>;
  outcome: "ok" | "error" | "truncated";
  reason: string | null;
  inputTokens?: number;
  outputTokens?: number;
};

export const LOG_TRACE_MAX_STEPS = 200;
export const LOG_TRACE_MAX_LINES = 50;
const LOG_TRACE_MAX_LINE_BYTES = 64 * 1024;
const tracedCallbacks = new WeakSet<NonNullable<AnalyzeLogInput["onTrace"]>>();

/** Outer wrappers keep numbering continuous when a kernel delegates to rules. */
export function withLogTrace(input: AnalyzeLogInput): AnalyzeLogInput {
  if (!input.onTrace || tracedCallbacks.has(input.onTrace)) return input;
  const record = input.onTrace;
  let index = 0;
  const onTrace: NonNullable<AnalyzeLogInput["onTrace"]> = async (step) => {
    if (index >= LOG_TRACE_MAX_STEPS) return;
    let bytes = 2;
    const lines = step.lines.slice(0, LOG_TRACE_MAX_LINES).filter((line) => {
      bytes += Buffer.byteLength(JSON.stringify(line)) + 1;
      return bytes <= LOG_TRACE_MAX_LINE_BYTES;
    });
    const truncated = lines.length < step.lines.length && step.outcome === "ok";
    await record({ ...step, index: ++index, lines, ...(truncated ? { outcome: "truncated", reason: "trace-line-cap" } : {}) });
  };
  tracedCallbacks.add(onTrace);
  return { ...input, onTrace };
}

export async function emitLogTrace(input: AnalyzeLogInput, step: Pick<LogAnalysisTraceStep, "kind"> & Partial<LogAnalysisTraceStep>) {
  await input.onTrace?.({ index: 0, tool: null, arguments: {}, resultBytes: 0, lines: [], outcome: "ok", reason: null, ...step });
}

/** Only known keys survive; file identities must match the input inventory, all other free text is redacted. */
export function summarizeTraceArguments(args: unknown, input?: Pick<AnalyzeLogInput, "files" | "filePath">): LogAnalysisTraceStep["arguments"] {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const summary: LogAnalysisTraceStep["arguments"] = {};
  for (const key of ["file", "pattern", "query", "line", "anchorLine", "startLine", "endLine", "isRegex", "maxMatches", "neighborhood", "offset", "limit", "kind", "severity", "time", "before", "after", "extractor", "where", "cursor"]) {
    if (!Object.hasOwn(args, key)) continue;
    const value = (args as Record<string, unknown>)[key];
    if (key === "file" && typeof value === "string" && value.length > 0
      && !/(?:^\/|^[a-z]:|\\|[\u0000-\u001f\u007f])/i.test(value)
      && !value.split("/").some((part) => !part || part === "." || part === "..")
      && (input?.files?.some((file) => file.path === value) || input?.filePath === value)) {
      summary[key] = value.slice(0, 120);
      continue;
    }
    summary[key] = typeof value === "number" && Number.isFinite(value) || typeof value === "boolean" || value === null ? value as number | boolean | null : "[redacted]";
  }
  return summary;
}

/** Read references only from kernel-owned result shapes, never knowledge or model JSON. */
export function traceResultLines(tool: string, result: unknown, input: AnalyzeLogInput): LogAnalysisTraceStep["lines"] {
  if (tool === "locate_log_statement") {
    if (!input.sourceSnapshot || input.sourceSnapshot.status !== "ready") return [];
    const references = new Map<string, LogAnalysisTraceStep["lines"][number]>();
    const items = result && typeof result === "object" && "items" in result ? result.items : undefined;
    if (!Array.isArray(items)) return [];
    for (const item of items) {
      if (!item || typeof item !== "object" || item.snapshotId !== input.sourceSnapshot?.id || typeof item.path !== "string"
        || item.path.length > 1024 || !Number.isSafeInteger(item.line) || item.line < 1) continue;
      const add = (line: number) => {
        if (references.size < LOG_TRACE_MAX_LINES) references.set(`${item.path}:${line}`, { file: item.path, line, snapshotId: item.snapshotId });
      };
      add(item.line);
      if (typeof item.excerpt === "string" && Number.isSafeInteger(item.startLine) && item.startLine > 0) {
        const count = Math.min(LOG_TRACE_MAX_LINES, item.excerpt.split("\n").length);
        for (let offset = 0; offset < count; offset++) add(item.startLine + offset);
      }
    }
    return [...references.values()];
  }
  if (!["search_lines", "search_log_lines", "read_line_range", "get_timeline", "get_signals", "get_line_templates", "query_events", "get_prefilter_findings"].includes(tool)) return [];
  const files = input.files?.map((file) => file.path) ?? [input.filePath ?? ""];
  const references = new Map<string, { file: string; line: number }>();
  let visited = 0;
  const visit = (value: unknown, inheritedFile: string | undefined): void => {
    if (++visited > 2000 || references.size >= LOG_TRACE_MAX_LINES || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item, inheritedFile); return; }
    const item = value as Record<string, unknown>;
    const file = typeof item.file === "string" ? item.file : inheritedFile;
    const add = (line: unknown) => {
      if (file !== undefined && files.includes(file) && typeof line === "number" && Number.isSafeInteger(line) && line > 0 && references.size < LOG_TRACE_MAX_LINES) {
        references.set(`${file}:${line}`, { file: file.slice(0, 1024), line });
      }
    };
    add(item.lineNumber ?? item.line);
    if (Array.isArray(item.lineNumbers)) item.lineNumbers.forEach(add);
    if (Array.isArray(item.anomalyLineNumbers)) item.anomalyLineNumbers.forEach(add);
    for (const key of ["lines", "events", "signals", "templates", "anchors", "first", "last", "files", "findings", "result", "evidence", "errorCodeStats"]) visit(item[key], file);
  };
  visit(result, files.length === 1 ? files[0] : undefined);
  return [...references.values()];
}
