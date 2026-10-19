import { runLogPrefilter } from "../../prefilter";
import { z } from "zod";

import { compileFileGlob, compileLogPattern, type LogPattern } from "../../adminPattern";
import { extractLogSignals } from "../../genericSignals";
import { MAX_SOURCE_EXCERPT_CHARS, MAX_SOURCE_LINE_CHARS, MAX_SOURCE_RANGE_LINES, MAX_SOURCE_SEARCH_RESULTS, MAX_SOURCE_TOOL_BYTES,
  type SourceRangeParams, type SourceSearchParams } from "../../sourceSearchRepository";
import type { LogAnalysisToolContext, LogAnalysisToolOutcome } from "./toolContext";

/**
 * The read-only tools of the log analysis agent (ADR-0022). Every tool
 * validates its arguments with zod, truncates its result to a stated bound so a
 * single call can never blow the token budget, and never writes anything.
 */
export const LOG_ANALYSIS_TOOL_NAMES = [
  "locate_log_statement",
  "search_source",
  "read_source_range",
  "search_log_lines",
  "search_lines",
  "list_files",
  "describe_event_schema",
  "query_events",
  "read_line_range",
  "get_signals",
  "get_line_templates",
  "get_timeline",
  "get_prefilter_findings",
  "read_domain_knowledge",
  "get_related_parameter_context"
] as const;

export type LogAnalysisToolName = (typeof LOG_ANALYSIS_TOOL_NAMES)[number];

const MAX_MATCHES_HARD_CAP = 20;
const MAX_RANGE_LINES = 40;
const MAX_LINE_CHARS = 400;
const MAX_KNOWLEDGE_ITEMS = 5;
const MAX_KNOWLEDGE_EXCERPT_CHARS = 400;
const MAX_PREFILTER_LINE_REFS = 30;

function clipLine(content: string) {
  return content.length > MAX_LINE_CHARS ? `${content.slice(0, MAX_LINE_CHARS)}…` : content;
}

function analyzedFiles(context: LogAnalysisToolContext): Array<{
  path?: string; parsed?: LogAnalysisToolContext["parsed"];
  reader?: import("../../fileReader").LogFileReader; prefilter?: LogAnalysisToolContext["prefilter"];
}> {
  return context.files?.filter((file) => file.parsed || file.reader) ?? [{ path: context.filePath, parsed: context.parsed }];
}

export const searchLogLinesParamsSchema = z.object({
  file: z.string().min(1).max(1024).optional(),
  pattern: z.string().min(1).max(200),
  isRegex: z.boolean().optional().default(false),
  maxMatches: z.number().int().min(1).max(MAX_MATCHES_HARD_CAP).optional().default(8),
  neighborhood: z.number().int().min(0).max(3).optional().default(1)
});

export async function searchLogLines(
  context: LogAnalysisToolContext,
  params: z.infer<typeof searchLogLinesParamsSchema>
): Promise<LogAnalysisToolOutcome> {
  let matcher: (line: string) => boolean;
  if (params.isRegex) {
    let regex: LogPattern;
    try {
      regex = compileLogPattern(params.pattern, "i");
    } catch (error) {
      return { ok: false, error: `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}` };
    }
    matcher = (line) => regex.test(line);
  } else {
    const needle = params.pattern.toLowerCase();
    matcher = (line) => line.toLowerCase().includes(needle);
  }

  let fileMatcher: LogPattern | undefined;
  if (params.file) {
    fileMatcher = compileFileGlob(params.file);
  }
  const files = analyzedFiles(context);
  let totalMatches = 0, returnedMatches = 0;
  const lines: Array<{ file?: string; line?: number; lineNumber: number; isMatch: boolean; content: string }> = [];
  for (const file of files) {
    if (fileMatcher && (!file.path || !fileMatcher.test(file.path))) continue;
    const rawLines = file.parsed!.rawLines;
    const totalLines = file.reader?.lineCount ?? rawLines.length;
    const kept: number[] = [];
    const source = file.reader ? file.reader.lines() : rawLines.map((content, index) => ({ lineNumber: index + 1, content }));
    for await (const { lineNumber: line, content } of source) {
      if (matcher(content)) {
        totalMatches++;
        if (returnedMatches < params.maxMatches) { kept.push(line); returnedMatches++; }
      }
    }
    const included = new Set<number>();
    for (const line of kept) for (let offset = -params.neighborhood; offset <= params.neighborhood; offset++) {
      if (line + offset >= 1 && line + offset <= totalLines) included.add(line + offset);
    }
    const matched = new Set(kept);
    const ordered = [...included].sort((a, b) => a - b);
    const contents = new Map<number, string>();
    if (file.reader) for (let at = 0; at < ordered.length;) {
      const start = ordered[at];
      let end = at;
      while (end + 1 < ordered.length && ordered[end + 1] - start < 400) end++;
      for (const item of await file.reader.readRange(start, ordered[end])) if (included.has(item.lineNumber)) contents.set(item.lineNumber, clipLine(item.content));
      at = end + 1;
    }
    for (const line of ordered) lines.push({
      ...(file.path ? { file: file.path, line } : {}), lineNumber: line,
      isMatch: matched.has(line), content: file.reader ? contents.get(line)! : clipLine(rawLines[line - 1])
    });
  }
  return { ok: true, result: { totalMatches, returnedMatches, truncated: totalMatches > returnedMatches, lines } };
}

export const readLineRangeParamsSchema = z.object({
  file: z.string().min(1).max(1024).optional(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1)
});

export async function readLineRange(
  context: LogAnalysisToolContext,
  params: z.infer<typeof readLineRangeParamsSchema>
): Promise<LogAnalysisToolOutcome> {
  if (params.endLine < params.startLine) {
    return { ok: false, error: "endLine must be greater than or equal to startLine." };
  }
  const files = analyzedFiles(context);
  if (!params.file && files.length > 1) return { ok: false, error: "file is required for multi-file records." };
  const selected = params.file ? files.find((file) => file.path === params.file) : files[0];
  if (!selected) return { ok: false, error: "File was not found or was skipped." };
  const totalLines = selected.reader?.lineCount ?? selected.parsed!.rawLines.length;
  if (params.startLine > totalLines) {
    return { ok: false, error: `startLine ${params.startLine} is beyond the end of the log (${totalLines} lines).` };
  }

  const clampedEnd = Math.min(params.endLine, totalLines);
  const cappedEnd = Math.min(clampedEnd, params.startLine + MAX_RANGE_LINES - 1);
  const read = selected.reader ? await selected.reader.readRange(params.startLine, cappedEnd) : undefined;
  const lines: Array<{ file?: string; line?: number; lineNumber: number; content: string }> = [];
  for (let lineNumber = params.startLine; lineNumber <= cappedEnd; lineNumber += 1) {
    const content = read ? read[lineNumber - params.startLine].content : selected.parsed!.rawLines[lineNumber - 1];
    lines.push({ ...(selected.path ? { file: selected.path, line: lineNumber } : {}), lineNumber, content: clipLine(content) });
  }

  return {
    ok: true,
    result: {
      startLine: params.startLine,
      endLine: cappedEnd,
      totalLines,
      truncated: cappedEnd < clampedEnd,
      lines
    }
  };
}

export const getPrefilterFindingsParamsSchema = z.object({ file: z.string().min(1).max(1024).optional() }).strict();

export function getPrefilterFindings(context: LogAnalysisToolContext, filePath?: string): LogAnalysisToolOutcome {
  if (context.files) {
    const files = context.files.filter((file) => file.parsed && (!filePath || file.path === filePath));
    return { ok: true, result: { totalFiles: files.length, truncated: files.length > MAX_MATCHES_HARD_CAP,
      files: files.slice(0, MAX_MATCHES_HARD_CAP).map((file) => ({ file: file.path,
        findings: getPrefilterFindings({ ...context, files: undefined, prefilter: file.prefilter ?? runLogPrefilter(file.parsed!.entries, context.signalRules) }) })) } };
  }
  const findings = context.prefilter;
  return {
    ok: true,
    result: {
      ...(findings.truncated ? { truncated: true } : {}),
      ruleHits: findings.ruleHits,
      evidence: findings.evidence.map((item) => ({
        ruleHit: item.ruleHit,
        inference: item.inference,
        lineNumbers: item.lineNumbers.slice(0, MAX_PREFILTER_LINE_REFS)
      })),
      errorCodeStats: findings.errorCodeStats.map((stat) => ({
        code: stat.code,
        count: stat.count,
        lineNumbers: stat.lineNumbers.slice(0, MAX_PREFILTER_LINE_REFS)
      })),
      severityCounts: findings.severityCounts,
      anomalyLineNumbers: findings.anomalyLineNumbers.slice(0, 50)
    }
  };
}

export const readDomainKnowledgeParamsSchema = z.object({
  query: z.string().min(1).max(200)
});

export async function readDomainKnowledge(
  context: LogAnalysisToolContext,
  params: z.infer<typeof readDomainKnowledgeParamsSchema>
): Promise<LogAnalysisToolOutcome> {
  if (!context.searchDomainKnowledge) {
    return {
      ok: true,
      result: {
        available: false,
        note: "Knowledge retrieval is not available in this run; proceed from the log content alone.",
        items: []
      }
    };
  }

  const search = await context.searchDomainKnowledge(params.query);
  return {
    ok: true,
    result: {
      available: true,
      // organization-generic mirrors the uncategorized-log-domain semantics and is stated explicitly.
      scope: search.scope,
      scopeNote:
        search.scope === "domain-linked"
          ? "Results are restricted to the knowledge entries linked to this log domain."
          : "No knowledge entries are linked to this log domain; results come from organization-wide generic retrieval.",
      retrievalMode: search.retrievalMode,
      items: search.items.slice(0, MAX_KNOWLEDGE_ITEMS).map((item) => ({
        entryId: item.entryId,
        revisionId: item.revisionId,
        title: item.title,
        excerpt:
          item.excerpt.length > MAX_KNOWLEDGE_EXCERPT_CHARS
            ? `${item.excerpt.slice(0, MAX_KNOWLEDGE_EXCERPT_CHARS)}…`
            : item.excerpt
      }))
    }
  };
}

export const getRelatedParameterContextParamsSchema = z.object({}).strict();

export async function getRelatedParameterContext(context: LogAnalysisToolContext): Promise<LogAnalysisToolOutcome> {
  if (!context.loadRelatedParameterContext) {
    return {
      ok: true,
      result: { available: false, note: "This log was uploaded without a related parameter." }
    };
  }

  const parameter = await context.loadRelatedParameterContext();
  if (!parameter) {
    return {
      ok: true,
      result: { available: false, note: "The related parameter could not be found in this organization." }
    };
  }
  const { recentChanges, ...contextWithoutHistory } = parameter;

  return {
    ok: true,
    result: {
      available: true,
      parameter: {
        ...contextWithoutHistory,
        ...(recentChanges ? { recentChanges: recentChanges.slice(0, 5) } : {})
      }
    }
  };
}

type ToolDefinition = {
  description: string;
  paramsSchema: z.ZodTypeAny;
  execute: (context: LogAnalysisToolContext, params: unknown) => Promise<LogAnalysisToolOutcome> | LogAnalysisToolOutcome;
};

export const MAX_SIGNAL_TOOL_BYTES = 16 * 1024;
const pageParams = { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(20).default(10) };
export const getSignalsParamsSchema = z.object({ ...pageParams, kind: z.string().min(1).max(200).optional(),
  severity: z.enum(["Critical", "Warning", "Info"]).optional() }).strict();
export const getLineTemplatesParamsSchema = z.object(pageParams).strict();
export const getTimelineParamsSchema = z.object({ time: z.string().datetime({ offset: true }).optional(),
  file: z.string().min(1).max(1024).optional(), line: z.number().int().min(1).optional(),
  before: z.number().int().min(0).max(20).default(10), after: z.number().int().min(0).max(20).default(10)
}).strict().refine((params) => params.time !== undefined ? params.file === undefined && params.line === undefined
  : params.file !== undefined && params.line !== undefined, "Provide either time or both file and line.");

function signalSummary(context: LogAnalysisToolContext) {
  return context.signalSummary ??= extractLogSignals(context.files ?? [{ path: context.filePath ?? "", parsed: context.parsed }], context.signalRules);
}

function signalPage(field: "signals" | "templates", items: unknown[], params: { offset: number; limit: number }, extractionTruncated: boolean, reason?: string): LogAnalysisToolOutcome {
  const page: unknown[] = [];
  const outcome = () => ({ ok: true as const, result: { [field]: page, total: items.length,
    nextOffset: params.offset + page.length < items.length ? params.offset + page.length : null,
    truncated: extractionTruncated || params.offset + page.length < items.length, ...(reason ? { reason } : {}) } });
  for (const item of items.slice(params.offset, params.offset + params.limit)) {
    page.push(item);
    if (Buffer.byteLength(JSON.stringify(outcome()), "utf8") > MAX_SIGNAL_TOOL_BYTES) {
      page.pop();
      if (!page.length) return { ok: false, error: "Signal item exceeds the 16 KiB tool output cap; read its lines directly." };
      break;
    }
  }
  return outcome();
}

export async function getTimeline(context: LogAnalysisToolContext, params: z.infer<typeof getTimelineParamsSchema>): Promise<LogAnalysisToolOutcome> {
  const files = analyzedFiles(context);
  const selected = files.find((file) => file.path === params.file);
  let anchor = selected?.parsed?.entries.find((entry) => entry.lineNumber === params.line);
  if (selected?.reader) for await (const entry of selected.reader.entries()) {
    if (entry.lineNumber > params.line!) break;
    if (entry.lineNumber === params.line) { anchor = entry; break; }
  }
  const targetTime = Date.parse(params.time ?? anchor?.timestamp ?? "");
  if (!Number.isFinite(targetTime)) return { ok: false, error: "The anchor must identify an analyzed line with a valid timestamp." };
  type TimedLine = { file: string; line: number; lineNumber: number; timestamp: string; content: string; time: number };
  const compare = (a: TimedLine, b: TimedLine) => a.time - b.time || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line;
  const target: TimedLine = { file: params.file ?? "", line: params.line ?? 0, lineNumber: 0, timestamp: "", content: "", time: targetTime };
  const before: TimedLine[] = [], after: TimedLine[] = [];
  let total = 0;
  for (const file of files) for await (const entry of file.reader ? file.reader.entries() : file.parsed!.entries) {
    const time = Date.parse(entry.timestamp ?? "");
    if (!Number.isFinite(time)) continue;
    total++;
    const item: TimedLine = { file: file.path ?? "", line: entry.lineNumber, lineNumber: entry.lineNumber,
      timestamp: new Date(time).toISOString(), content: file.reader ? "" : clipLine(file.parsed!.rawLines[entry.lineNumber - 1]), time };
    const earlier = params.time !== undefined ? time < targetTime : compare(item, target) < 0;
    const list = earlier ? before : after;
    list.push(item); list.sort(compare);
    if (list.length > (earlier ? params.before : params.after + 1)) list.splice(earlier ? 0 : list.length - 1, 1);
  }
  const lines = [...before, ...after].map(({ time: _time, ...line }) => line);
  for (const line of lines) {
    const reader = files.find((file) => file.path === line.file)?.reader;
    if (reader) line.content = clipLine((await reader.readRange(line.lineNumber, line.lineNumber))[0].content);
  }
  const outcome = () => ({ ok: true as const, result: { lines, truncated: total > lines.length } });
  while (lines.length && Buffer.byteLength(JSON.stringify(outcome()), "utf8") > MAX_SIGNAL_TOOL_BYTES) {
    // Drop the farther edge; the requested time/anchor remains in the window.
    const firstDistance = Math.abs(Date.parse(lines[0].timestamp) - targetTime);
    const lastDistance = Math.abs(Date.parse(lines[lines.length - 1].timestamp) - targetTime);
    const firstIsAnchor = lines[0].file === params.file && lines[0].line === params.line;
    const lastIsAnchor = lines[lines.length - 1].file === params.file && lines[lines.length - 1].line === params.line;
    lines.splice(!firstIsAnchor && (lastIsAnchor || firstDistance > lastDistance) ? 0 : lines.length - 1, 1);
  }
  return outcome();
}

const queryScalar = z.union([z.string().max(8192), z.number().finite(), z.boolean(), z.null(), z.object({ hex: z.string().max(8192), length: z.number().int().min(0).max(4096) }).strict()]);
export const queryEventsParamsSchema = z.object({ extractor: z.string().min(1).max(100), file: z.string().max(1024).optional(),
  where: z.array(z.object({ field: z.string().max(512), op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in"]),
    value: z.union([queryScalar, z.array(queryScalar).max(100)]) }).strict()).max(20).default([]),
  limit: z.number().int().min(1).max(50).default(50), cursor: z.string().regex(/^\d{1,6}$/).optional() }).strict();

export const MAX_QUERY_EVENTS_BYTES = 16 * 1024;
export const MAX_QUERY_FIELD_BYTES = 1024;

export function availableLogAnalysisTools(context: Pick<LogAnalysisToolContext, "decoding" | "sourceSnapshot" | "locateLogStatement" | "searchSource" | "readSourceRange">) {
  const sourceBackends = { locate_log_statement: context.locateLogStatement, search_source: context.searchSource, read_source_range: context.readSourceRange };
  return LOG_ANALYSIS_TOOL_NAMES.filter((name) => Object.hasOwn(sourceBackends, name)
    ? context.sourceSnapshot?.status === "ready" && !!sourceBackends[name as keyof typeof sourceBackends]
    : context.decoding?.spec.extractors.length || (name !== "query_events" && name !== "describe_event_schema"));
}

export function queryEvents(context: LogAnalysisToolContext, params: z.infer<typeof queryEventsParamsSchema>): LogAnalysisToolOutcome {
  const decoding = context.decoding;
  const extractor = decoding?.spec.extractors.find((item) => item.id === params.extractor);
  if (!decoding || !extractor) return { ok: false, error: "Unknown extractor" };
  for (const condition of params.where) {
    if (!Object.hasOwn(extractor.fields, condition.field)) return { ok: false, error: `Unknown field ${condition.field}` };
    if ((condition.op === "in") !== Array.isArray(condition.value)) return { ok: false, error: "Only in requires an array value" };
  }
  const events: typeof decoding.events = [];
  let truncated = false;
  const outcome = (cursor: number) => ({ ok: true as const, result: { events,
    nextCursor: cursor < decoding.events.length ? String(cursor) : null, truncated } });
  const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value), "utf8");
  let index = Number(params.cursor ?? 0);
  for (; index < decoding.events.length; index++) {
    const event = decoding.events[index];
    if (event.extractor !== params.extractor || params.file && event.file !== params.file) continue;
    const matches = params.where.every(({ field, op, value: expected }) => {
      const decoded = event.fields[field];
      const value = decoded && typeof decoded === "object" && "value" in decoded ? decoded.value : decoded;
      if (value === undefined) return false;
      const equal = (other: unknown) => value === other || !!(value && other && typeof value === "object" && typeof other === "object"
        && "hex" in value && "hex" in other && "length" in other && value.hex === other.hex && value.length === other.length);
      if (op === "in") return (expected as unknown[]).some(equal);
      if (op === "eq") return equal(expected);
      if (op === "ne") return !equal(expected);
      if (!(typeof value === "number" && typeof expected === "number" || typeof value === "string" && typeof expected === "string")) return false;
      return op === "lt" ? value < expected : op === "lte" ? value <= expected : op === "gt" ? value > expected : value >= expected;
    });
    if (matches) {
      const bounded = { ...event, fields: Object.create(null) as typeof event.fields };
      for (const [field, value] of Object.entries(event.fields)) {
        const serialized = JSON.stringify(value);
        // A string preview also bounds escaped control characters and UTF-8.
        const preview = size(value) > MAX_QUERY_FIELD_BYTES ? `${serialized.slice(0, 128)}… [truncated]` : value;
        if (preview !== value) truncated = true;
        bounded.fields[field] = preview;
        if (size(bounded) > MAX_QUERY_EVENTS_BYTES - 1024) { delete bounded.fields[field]; truncated = true; break; }
      }
      events.push(bounded);
      if (size(outcome(index + 1)) > MAX_QUERY_EVENTS_BYTES) {
        events.pop(); truncated = true;
        if (!events.length) return { ok: false, error: "Decoded event metadata exceeds the 16 KiB query output cap" };
        break;
      }
    }
    if (events.length === params.limit) { index++; break; }
  }
  truncated ||= index < decoding.events.length;
  return outcome(index);
}

export const logAnalysisToolCatalog: Record<LogAnalysisToolName, ToolDefinition> = {
  search_source: {
    description: 'Search the pinned ready source snapshot by case-sensitive path glob and literal or full-text query. Args: {pathGlob: string (e.g. drivers/power/**/*.c), query: string (3-200 characters), mode?: literal|full_text (default literal), limit?: 1-20 (default 8)}. Literal queries need three consecutive letters/numbers and no newlines. Common queries require a literal path prefix; narrow pathGlob or query if rejected. Scores at most 200 admitted indexed chunks and 200 split-line boundary windows, with a 1-second database deadline. Timeout returns truncated with reason statement_timeout. Returns ranked snapshotId/path/line/excerpt hits; max 20 hits, 400 characters per excerpt and 16 KiB total; truncated marks caps. Only returned hit locations can be source evidence.',
    paramsSchema: z.object({ pathGlob: z.string().min(1).max(1024), query: z.string().trim().min(3).max(200),
      mode: z.enum(["literal", "full_text"]).default("literal"), limit: z.number().int().min(1).max(MAX_SOURCE_SEARCH_RESULTS).default(8) }).strict()
      .refine((args) => args.mode !== "literal" || /[\p{L}\p{N}]{3}/u.test(args.query) && !/[\r\n]/.test(args.query),
        "Literal queries require at least three consecutive letters or numbers and no newlines."),
    execute: async (context, args) => {
      const params = args as SourceSearchParams;
      const result = await context.searchSource!(params);
      const items = [] as typeof result.items;
      let truncated = result.truncated;
      const outcome = () => ({ ok: true as const, result: { items, truncated, ...(result.reason ? { reason: result.reason } : {}) } });
      for (const item of result.items.slice(0, params.limit)) {
        truncated ||= item.excerpt.length > MAX_SOURCE_EXCERPT_CHARS;
        items.push({ ...item, excerpt: item.excerpt.slice(0, MAX_SOURCE_EXCERPT_CHARS) });
        if (Buffer.byteLength(JSON.stringify(outcome()), "utf8") > MAX_SOURCE_TOOL_BYTES) { items.pop(); truncated = true; break; }
      }
      truncated ||= result.items.length > items.length;
      return outcome();
    }
  },
  read_source_range: {
    description: 'Read numbered source lines from the run\'s pinned ready snapshot. Args: {snapshotId: string, path: string, startLine: positive integer, endLine: positive integer}. Range clamped to 80 lines, each line to 1000 characters, total output to 16 KiB; truncated marks caps. Only returned numbered lines can be source evidence; a different snapshot is rejected.',
    paramsSchema: z.object({ snapshotId: z.string().min(1).max(200), path: z.string().min(1).max(1024),
      startLine: z.number().int().safe().positive(), endLine: z.number().int().safe().positive() }).strict()
      .refine((args) => args.endLine >= args.startLine, "endLine must be greater than or equal to startLine."),
    execute: async (context, args) => {
      const params = args as SourceRangeParams;
      if (params.snapshotId !== context.sourceSnapshot?.id) return { ok: false, error: "Source snapshot does not match this run." };
      const cappedEnd = Math.min(params.endLine, params.startLine + MAX_SOURCE_RANGE_LINES - 1);
      const result = await context.readSourceRange!({ ...params, endLine: cappedEnd });
      if (!result) return { ok: false, error: "Source file or range unavailable." };
      const lines = [] as typeof result.lines;
      let truncated = result.truncated || cappedEnd < params.endLine;
      const outcome = () => ({ ok: true as const, result: { ...result, snapshotId: params.snapshotId, path: params.path,
        startLine: params.startLine, endLine: lines.at(-1)?.line ?? params.startLine, lines, truncated } });
      for (const item of result.lines.filter((line) => line.line >= params.startLine && line.line <= cappedEnd).slice(0, MAX_SOURCE_RANGE_LINES)) {
        truncated ||= item.content.length > MAX_SOURCE_LINE_CHARS;
        lines.push({ ...item, content: item.content.slice(0, MAX_SOURCE_LINE_CHARS) });
        if (Buffer.byteLength(JSON.stringify(outcome()), "utf8") > MAX_SOURCE_TOOL_BYTES) { lines.pop(); truncated = true; break; }
      }
      truncated ||= result.lines.length > lines.length;
      return outcome();
    }
  },
  locate_log_statement: {
    description: 'Locate output statements in the pinned ready source snapshot. Args: {line?: string (max 4000 characters), file?: string, anchorLine?: positive integer, limit?: 1-20}. Supply line OR file+anchorLine. Returns candidate snapshotId/path/line, confidence and an untrusted ±3-line excerpt, capped at 16 KiB. Only the returned statement locations can be source evidence.',
    paramsSchema: z.object({ line: z.string().min(1).max(4000).optional(), file: z.string().min(1).max(1024).optional(),
      anchorLine: z.number().int().positive().optional(), limit: z.number().int().min(1).max(20).default(8) }).strict()
      .refine((args) => !!args.line !== !!(args.file && args.anchorLine), "Supply line or file+anchorLine"),
    execute: async (context, args) => {
      const params = args as { line?: string; file?: string; anchorLine?: number; limit: number };
      const file = context.files?.find((file) => file.path === params.file && (file.reader || file.parsed));
      const content = params.line ?? (file?.reader
        ? (await file.reader.readRange(params.anchorLine!, params.anchorLine!))[0]?.content
        : (file?.parsed ?? (params.file === context.filePath ? context.parsed : undefined))?.rawLines[(params.anchorLine ?? 0) - 1]);
      if (!content || content.length > 4000 || !context.locateLogStatement) return { ok: false, error: "Source locator or log anchor unavailable" };
      const result = await context.locateLogStatement(content, params.limit);
      // Enforce output bounds before the kernel observes citations, even with an alternate backend.
      const items = [] as typeof result.items;
      let truncated = result.truncated;
      for (const item of result.items.slice(0, params.limit)) {
        items.push(item);
        if (Buffer.byteLength(JSON.stringify({ items, truncated: true }), "utf8") > 16 * 1024) { items.pop(); truncated = true; break; }
      }
      return { ok: true, result: { items, truncated: truncated || result.items.length > items.length } };
    }
  },
  get_signals: {
    description: 'Get generic signals plus pinned skill signal hits, including evidence lines. Args: {kind?, severity?: Critical|Warning|Info, offset?: number, limit?: 1-20}. Output capped at 16 KiB; follow nextOffset. Only returned anchors count as seen lines.',
    paramsSchema: getSignalsParamsSchema,
    execute: (context, args) => {
      const params = args as z.infer<typeof getSignalsParamsSchema>;
      const summary = signalSummary(context);
      return signalPage("signals", summary.signals.filter((signal) => (!params.kind || signal.kind === params.kind)
        && (!params.severity || signal.severity === params.severity)).map((signal) => ({ ...signal, title: clipLine(signal.title) })), params, !!summary.truncated || summary.truncatedSignals, summary.reason);
    }
  },
  get_line_templates: {
    description: 'Get normalized line templates ordered by descending count with first/last file:line evidence. Args: {offset?: number, limit?: 1-20}. Output capped at 16 KiB; follow nextOffset. Only returned first/last anchors count as seen lines.',
    paramsSchema: getLineTemplatesParamsSchema,
    execute: (context, args) => { const summary = signalSummary(context);
      return signalPage("templates", summary.templates, args as z.infer<typeof getLineTemplatesParamsSchema>, !!summary.truncated || summary.truncatedTemplates, summary.reason); }
  },
  get_timeline: {
    description: 'Read a cross-file timestamp-ordered window. Args: {time?: ISO timestamp, file?: string, line?: positive integer, before?: 0-20, after?: 0-20}. Provide time OR file+line (anchor needs a timestamp). Returns at most 41 lines and 16 KiB. Returned lines can be cited.',
    paramsSchema: getTimelineParamsSchema,
    execute: (context, args) => getTimeline(context, args as z.infer<typeof getTimelineParamsSchema>)
  },
  describe_event_schema: {
    description: 'Describe decoded extractors, field names/types and per-extractor event counts. Args: {}.',
    paramsSchema: z.object({}).strict(),
    execute: (context) => ({ ok: true, result: { extractors: context.decoding?.spec.extractors.map(({ id, fields }) => ({ id,
      fields, count: context.decoding!.counts.byExtractor[id] ?? 0 })), counts: context.decoding?.counts } })
  },
  query_events: {
    description: 'Query decoded events with file/line anchors. Args: {extractor, file?, where?: [{field, op: eq|ne|lt|lte|gt|gte|in, value}], limit?: 1-50, cursor?: string}. Equality uses original typed values or enum labels; bytes compare {hex,length}. Ordering uses numbers or strings (timestamps are UTC ISO strings). Output is capped at 16 KiB and each field at 1 KiB; oversized fields become marked string previews and truncated is true. Follow nextCursor for more events. Returned event lines can be cited.',
    paramsSchema: queryEventsParamsSchema,
    execute: (context, params) => queryEvents(context, params as z.infer<typeof queryEventsParamsSchema>)
  },
  list_files: {
    description: 'List file inventory, including skipped files. Args: {"offset"?: number, "limit"?: 1-200}.',
    paramsSchema: z.object({ offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(100) }),
    execute: (context, args) => {
      const { offset, limit } = args as { offset: number; limit: number };
      const files = context.files?.map(({ parsed: _parsed, reader: _reader, prefilter: _prefilter, ...file }) => file) ?? [{ path: context.filePath, lineCount: context.parsed.rawLines.length, status: "analyzed" }];
      return { ok: true, result: { files: files.slice(offset, offset + limit), total: files.length, truncated: files.length > offset + limit } };
    }
  },
  search_lines: {
    description: 'Search lines across files. Optional file path/glob; results cite file and line. Same arguments and caps as search_log_lines.',
    paramsSchema: searchLogLinesParamsSchema,
    execute: (context, params) => searchLogLines(context, params as z.infer<typeof searchLogLinesParamsSchema>)
  },
  search_log_lines: {
    description:
      'Search raw log lines by keyword or regex. Args: {"pattern": string, "isRegex"?: boolean, "maxMatches"?: 1-20, "neighborhood"?: 0-3, "file"?: string}. Returns matching lines with neighborhood context.',
    paramsSchema: searchLogLinesParamsSchema,
    execute: (context, params) => searchLogLines(context, params as z.infer<typeof searchLogLinesParamsSchema>)
  },
  read_line_range: {
    description:
      'Read a contiguous line range (max 40 lines per call). Args: {"startLine": number, "endLine": number, "file"?: string (required with multiple analyzed files)}.',
    paramsSchema: readLineRangeParamsSchema,
    execute: (context, params) => readLineRange(context, params as z.infer<typeof readLineRangeParamsSchema>)
  },
  get_prefilter_findings: {
    description: 'Get deterministic prefilter findings (rule hits, error-code stats, severity counts). Args: {"file"?: string}. Multi-file summaries show at most 20 files; use file for the others.',
    paramsSchema: getPrefilterFindingsParamsSchema,
    execute: (context, params) => getPrefilterFindings(context, (params as z.infer<typeof getPrefilterFindingsParamsSchema>).file)
  },
  read_domain_knowledge: {
    description:
      'Retrieve published domain knowledge linked to this log domain (falls back to organization-wide retrieval when the domain has no linked entries). Args: {"query": string}.',
    paramsSchema: readDomainKnowledgeParamsSchema,
    execute: (context, params) => readDomainKnowledge(context, params as z.infer<typeof readDomainKnowledgeParamsSchema>)
  },
  get_related_parameter_context: {
    description:
      "Get the definition and recent changes of the parameter this log was uploaded against, when one was provided. Args: {}.",
    paramsSchema: getRelatedParameterContextParamsSchema,
    execute: (context) => getRelatedParameterContext(context)
  }
};

export function isLogAnalysisToolName(name: string): name is LogAnalysisToolName {
  return (LOG_ANALYSIS_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Single dispatch point for the loop kernel: unknown tool names and invalid
 * arguments come back as `ok: false` so the kernel can prompt the model to
 * correct itself (and count the strike toward its illegal-call threshold).
 */
export async function executeLogAnalysisTool(
  name: string,
  args: unknown,
  context: LogAnalysisToolContext
): Promise<LogAnalysisToolOutcome> {
  const failure = (error: string): LogAnalysisToolOutcome => ({ ok: false,
    error: name === "query_events" && error.length > 1000 ? `${error.slice(0, 1000)}… [truncated]` : error });
  if (!isLogAnalysisToolName(name) || !availableLogAnalysisTools(context).includes(name)) {
    return failure(`Unknown tool "${name}". Available tools: ${availableLogAnalysisTools(context).join(", ")}.`);
  }
  const definition = logAnalysisToolCatalog[name];
  const parsed = definition.paramsSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    return failure(`Invalid arguments for tool "${name}": ${issues}`);
  }
  try {
    return await definition.execute(context, parsed.data);
  } catch (error) {
    return failure(`Tool "${name}" failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
