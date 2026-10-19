import { compileLogPattern } from "./adminPattern";

export const MAX_STATEMENT_PATTERNS = 20;
export const MAX_SOURCE_STATEMENT_LENGTH = 4096;
export const MAX_SOURCE_LOCATE_LINE_LENGTH = 8192;
export const MAX_STATEMENT_CANDIDATES_PER_FILE = 2000;
export const MAX_STATEMENT_CAPTURE_GROUPS = 8;
const MATCH_WINDOW = 8192;
const MAX_STATEMENT_SCAN_LENGTH = 2 * 1024 * 1024;
export type SourceStatementBudget = { matchesRemaining: number; capturesRemaining: number; deadline: number };
export function createSourceStatementBudget(options: { maxMatches?: number; maxCaptures?: number; maxMs?: number; now?: () => number } = {}): SourceStatementBudget {
  return { matchesRemaining: options.maxMatches ?? 20_000, capturesRemaining: options.maxCaptures ?? 160_000,
    deadline: (options.now ?? (() => performance.now()))() + Math.max(0, Math.min(options.maxMs ?? 10_000, 10_000)) };
}
export function compileSourceStatementPattern(pattern: string, maxInputLength = MATCH_WINDOW) {
  const compiled = compileLogPattern(pattern, "", maxInputLength);
  if (compiled.groupCount > MAX_STATEMENT_CAPTURE_GROUPS) throw new Error(`Statement patterns support at most ${MAX_STATEMENT_CAPTURE_GROUPS} capture groups.`);
  if (compiled.test("") || [...compiled.matchAll("a \n", false)].some((match) => !match[0].length)) {
    throw new Error("Statement patterns must not match empty text.");
  }
  return compiled;
}
export type SourceStatementLimits = { maxPerFile: number; maxPerSnapshot: number };
export function getSourceStatementLimits(env: NodeJS.ProcessEnv = process.env): SourceStatementLimits {
  const read = (name: string, fallback: number) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`${name} must be a positive safe integer.`);
    return Number(raw);
  };
  return { maxPerFile: read("LOG_SOURCE_MAX_STATEMENTS_PER_FILE", 500), maxPerSnapshot: read("LOG_SOURCE_MAX_STATEMENTS", 20_000) };
}
export type SourceStatement = { path: string; line: number; functionName: string | null; rawCall: string; skeleton: string; matchKey: string };
const wildcard = "\0";
const escapeLiteral = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Short literal keys also match values attached directly to a format placeholder. */
export function statementMatchKeys(value: string): string[] {
  const lower = value.toLowerCase(), keys = new Set<string>();
  for (let at = 0; at < lower.length; at++) for (let size = 1; size <= 3 && at + size <= lower.length; size++) keys.add(lower.slice(at, at + size));
  return [...keys];
}

const percentTokens = "%%|%[-+#0 ']*(?:\\d+|\\*)?(?:\\.(?:\\d+|\\*))?p(?:OF[A-Za-z]*|[Mm][FR]?|[Ii][46][cnhbl]?|IS[A-Za-z]*|[SUu][blBL]?|h[CDN]?|[sSBVKRrxbde])|%(?:\\([^)]+\\)|[1-9]\\d*\\$)?[-+#0 ']*(?:\\d+|\\*)?(?:\\.(?:\\d+|\\*))?(?:hh|ll|[hljztL])?[diuoxXfFeEgGaAcspnbvTqUw]";
const formatTokens = [0, 1, 2, 3].map((flags) => compileLogPattern([
  flags & 2 ? "\\{\\{|\\}\\}|\\{[^{}]*\\}" : "", flags & 1 ? "\\$\\{[^}]*\\}|\\$[A-Za-z_]\\w*" : "", percentTokens
].filter(Boolean).join("|"), "", MAX_SOURCE_STATEMENT_LENGTH));
/** A bounded RE2 pass consumes format/interpolation tokens once; literal text is never rescanned. */
export function normalizeStatementFormat(format: string, interpolation = { braces: true, dollar: true }): { skeleton: string; matchKey: string } | null {
  if (format.length > MAX_SOURCE_STATEMENT_LENGTH) return null;
  const parts: string[] = [];
  let previous = 0;
  for (const match of formatTokens[Number(interpolation.braces) * 2 + Number(interpolation.dollar)].matchAll(format, false)) {
    const token = match[0];
    const replacement = token === "%%" ? "%" : token.startsWith("%") ? wildcard
      : token === "{{" && interpolation.braces ? "{" : token === "}}" && interpolation.braces ? "}"
        : (token.startsWith("$") ? interpolation.dollar : interpolation.braces) ? wildcard : token;
    parts.push(format.slice(previous, match.index), replacement);
    previous = match.index + token.length;
  }
  parts.push(format.slice(previous));
  const normalized = parts.join("").replaceAll("\x04", "$").trim();
  const literals = normalized.split(wildcard);
  let longest = "";
  for (const literal of literals) for (const word of literal.toLowerCase().match(/[\p{L}_][\p{L}\p{N}_]*/gu) ?? []) {
    if (word.length > longest.length || word.length === longest.length && word.localeCompare(longest) < 0) longest = word;
  }
  if (!longest) return null;
  const matchKey = longest.slice(0, 3);
  const skeleton = literals.map(escapeLiteral).join(".*");
  if (skeleton.length > MAX_SOURCE_STATEMENT_LENGTH) return null;
  return { skeleton, matchKey };
}

type Literal = { start: number; end: number; value: string | null; interpolated: boolean };
function decodeLiteral(value: string) {
  return value.replace(/\\(?:u([\da-fA-F]{4})|x([\da-fA-F]{2})|([0-7]{1,3})|([\s\S]))/g,
    (_token, unicode: string | undefined, hex: string | undefined, octal: string | undefined, escaped: string | undefined) => {
      if (unicode || hex || octal) return String.fromCharCode(parseInt(unicode ?? hex ?? octal!, octal ? 8 : 16));
      return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", $: "\x04", "\n": "" } as Record<string, string>)[escaped!] ?? escaped!;
    });
}

/** A lexical pass ignores comments and quoted emitters without parsing arbitrary programs. */
function* sourceLexemes(text: string): Generator<void, { mask: string; literals: Literal[] }> {
  const mask = text.split("");
  const literals: Literal[] = [];
  for (let at = 0; at < text.length;) {
    if (at % 4096 === 0) yield;
    const start = at;
    if (text.startsWith("//", at) || text[at] === "#") {
      while (at < text.length && text[at] !== "\n") { mask[at++] = " "; if (at % 4096 === 0) yield; }
    } else if (text.startsWith("/*", at)) {
      at += 2;
      while (at < text.length && !text.startsWith("*/", at)) { at++; if (at % 4096 === 0) yield; }
      at = Math.min(text.length, at + 2);
      for (let i = start; i < at; i++) { if (mask[i] !== "\n") mask[i] = " "; if (i % 4096 === 0) yield; }
    } else if (["\"", "'", "`"].includes(text[at])) {
      const quote = text[at++];
      if (quote === '"' && text[start - 1] === "R") {
        const opening = text.slice(at, at + 17).indexOf("(");
        const open = opening < 0 ? -1 : at + opening, delimiter = opening < 0 ? "" : text.slice(at, open);
        if (open >= at && delimiter.length <= 16 && !/[\s()\\]/.test(delimiter)) {
          const close = text.indexOf(`)${delimiter}"`, open + 1);
          at = close < 0 ? text.length : close + delimiter.length + 2;
          literals.push({ start, end: at, value: close >= 0 && at - start <= MAX_SOURCE_STATEMENT_LENGTH ? text.slice(open + 1, close) : null, interpolated: false });
          for (let i = start; i < at; i++) { if (mask[i] !== "\n") mask[i] = " "; if (i % 4096 === 0) yield; }
          continue;
        }
      }
      const triple = text.startsWith(quote.repeat(2), at);
      if (triple) at += 2;
      const valueStart = at;
      while (at < text.length && !text.startsWith(quote.repeat(triple ? 3 : 1), at)) {
        if (text[at] === "\\" && quote !== "`") at++;
        at++;
        if (at % 4096 < 2) yield;
      }
      const value = at < text.length && at - valueStart <= MAX_SOURCE_STATEMENT_LENGTH ? text.slice(valueStart, at) : null;
      at = Math.min(text.length, at + (triple ? 3 : 1));
      literals.push({ start, end: at, value: value === null || quote === "`" ? value : decodeLiteral(value), interpolated: /(?:^|[^\w])(?:f|fr|rf)$/i.test(text.slice(Math.max(0, start - 3), start)) });
      for (let i = start; i < at; i++) { if (mask[i] !== "\n") mask[i] = " "; if (i % 4096 === 0) yield; }
    } else at++;
  }
  return { mask: mask.join(""), literals };
}

// ponytail: lexical extraction covers literal calls, not macros expanding to calls; add a language parser if those become required.
type ExtractionInput = { path: string; text: string; patterns?: string[]; maxStatements?: number };
type ExtractionResult = { statements: SourceStatement[]; truncated: boolean };
type ExtractionOptions = { budget?: SourceStatementBudget; now?: () => number; maxMs?: number; onCheckpoint?: () => Promise<void> };
function* extractSourceStatementSteps(input: ExtractionInput, result: ExtractionResult, budget: SourceStatementBudget): Generator<void, void> {
  yield;
  const { path } = input, text = input.text.slice(0, MAX_STATEMENT_SCAN_LENGTH);
  const maxStatements = input.maxStatements ?? getSourceStatementLimits().maxPerFile;
  if (maxStatements <= 0) { result.truncated = Boolean(text.length); return; }
  if (budget.matchesRemaining <= 0 || budget.capturesRemaining <= 0) { result.truncated = true; return; }
  let candidatesTruncated = input.text.length > text.length;
  const { mask, literals } = yield* sourceLexemes(text);
  const defaultPattern = "\\b(?:printk(?:_deferred|_once|_ratelimited)?|pr_(?:emerg|alert|crit|err|warn|warning|notice|info|debug|devel|cont)(?:_once|_ratelimited)?|dev_(?:emerg|alert|crit|err|warn|notice|info|dbg|vdbg|printk)(?:_once|_ratelimited|_probe)?|ALOG(?:V|D|I|W|E|F|ASSERT)(?:_IF)?|Log\\.(?:v|d|i|w|e|wtf|println)|LOG|logging\\.(?:debug|info|warning|warn|error|critical|fatal|exception|log)|log\\.(?:Print|Printf|Println|Fatal|Fatalf|Fatalln|Panic|Panicf|Panicln|Output)|slog\\.(?:(?:Debug|Info|Warn|Error)(?:Context)?|Log|LogAttrs))\\s*\\(";
  const starts = new Map<number, string>();
  let matchesRemaining = MAX_STATEMENT_CANDIDATES_PER_FILE, capturesRemaining = 16_000;
  scanPatterns: for (const source of [defaultPattern, ...(input.patterns ?? []).slice(0, MAX_STATEMENT_PATTERNS)]) {
    yield;
    let pattern;
    try { pattern = compileSourceStatementPattern(source); }
    catch { candidatesTruncated = true; continue; } // Older stored patterns cannot bypass the current validation limits.
    for (let offset = 0; offset < mask.length; offset += MATCH_WINDOW / 2) {
      yield;
      const window = mask.slice(offset, offset + MATCH_WINDOW);
      const matches = pattern.matchAll(window, false)[Symbol.iterator]();
      while (true) {
        yield;
        const captures = pattern.groupCount + 1;
        if (matchesRemaining <= 0 || capturesRemaining < captures || budget.matchesRemaining <= 0 || budget.capturesRemaining < captures) {
          result.truncated = true; break scanPatterns;
        }
        const next = matches.next();
        if (next.done) break;
        matchesRemaining--; capturesRemaining -= captures;
        budget.matchesRemaining--; budget.capturesRemaining -= captures;
        const match = next.value;
        if (!match[0].length) { candidatesTruncated = true; break; }
        // Overlap covers calls crossing a window. Synthetic boundary anchors never create candidates.
        if (offset && match.index === 0 || offset + window.length < mask.length && match.index + match[0].length >= window.length - 1) continue;
        if (match[0].length <= MAX_SOURCE_STATEMENT_LENGTH && match[0].endsWith("(")) starts.set(offset + match.index, match[0]);
      }
    }
  }
  result.truncated ||= candidatesTruncated;
  const statements = result.statements;
  let previous = 0, line = 1, literalAt = 0;
  for (const [start, emitter] of [...starts].sort((a, b) => a[0] - b[0])) {
    yield;
    for (; previous < start; previous++) {
      if (text[previous] === "\n" || text[previous] === "\r" && text[previous + 1] !== "\n") line++;
      if (previous % 4096 === 0) yield;
    }
    const open = start + emitter.length - 1;
    let end = open + 1, depth = 1, argument = 0;
    const argumentRanges: Array<{ start: number; end: number }> = [];
    let argumentStart = end;
    for (; end < mask.length && end - start < MAX_SOURCE_STATEMENT_LENGTH && depth; end++) {
      if (mask[end] === "(") depth++;
      if (mask[end] === ")") depth--;
      if (mask[end] === "," && depth === 1 || depth === 0) {
        argumentRanges.push({ start: argumentStart, end }); argumentStart = end + 1;
      }
    }
    if (depth) continue;
    const stream = /^LOG\s*\(/.test(emitter) && /^\s*<</.test(mask.slice(end, end + 20));
    if (stream) {
      const streamStart = end;
      while (end < mask.length && end - start < MAX_SOURCE_STATEMENT_LENGTH && ![";", "\n"].includes(mask[end])) end++;
      argumentRanges.splice(0, argumentRanges.length, { start: streamStart, end });
    } else if (/^(?:dev_|Log\.|ALOG[A-Za-z0-9_]*_IF|ALOG_ASSERT|logging\.log\s*\(|slog\.[A-Za-z]+Context\s*\(|log\.Output\s*\()/.test(emitter)) argument = 1;
    if (/^(?:slog\.Log(?:Attrs)?|Log\.println|dev_printk)\s*\(/.test(emitter)) argument = 2;
    if (!stream && /^LOG\s*\(/.test(emitter)) {
      while (literalAt < literals.length && literals[literalAt].start < open) { literalAt++; if (literalAt % 4096 === 0) yield; }
      const first = literals[literalAt];
      argument = first ? argumentRanges.findIndex((range) => first.start >= range.start && first.start < range.end) : -1;
    }
    const range = argumentRanges[argument];
    if (!range) continue;
    while (literalAt < literals.length && literals[literalAt].end <= range.start) { literalAt++; if (literalAt % 4096 === 0) yield; }
    const selected: Literal[] = [];
    for (let at = literalAt; at < literals.length && literals[at].start < range.end; at++) selected.push(literals[at]);
    if (!selected.length) continue;
    if (selected.some((literal) => literal.value === null || literal.end > range.end)) { result.truncated = true; continue; }
    let format = selected[0].value!;
    for (let at = 1; at < selected.length; at++) {
      const gap = text.slice(selected[at - 1].end, selected[at].start).trim();
      format += gap && gap !== "+" ? wildcard : "";
      format += selected[at].value!;
      if (format.length > MAX_SOURCE_STATEMENT_LENGTH) break;
    }
    // Concatenated/streamed values after the final literal are emitted too.
    if (/\+|<</.test(mask.slice(selected.at(-1)!.end, range.end))) format += wildcard;
    const normalized = normalizeStatementFormat(format, { braces: /\.py$/i.test(path) && selected.some((literal) => literal.interpolated), dollar: /\.kts?$/i.test(path) });
    if (!normalized) continue;
    if (statements.length >= maxStatements) { result.truncated = true; return; }
    statements.push({ path, line, functionName: null, rawCall: text.slice(start, end), ...normalized });
  }
}

function extractionRun(input: ExtractionInput, options: ExtractionOptions) {
  const now = options.now ?? (() => performance.now());
  const budget = options.budget ?? createSourceStatementBudget({ now });
  const deadline = Math.min(budget.deadline, now() + Math.max(0, Math.min(options.maxMs ?? 1000, 1000)));
  const result: ExtractionResult = { statements: [], truncated: false };
  return { now, deadline, result, steps: extractSourceStatementSteps(input, result, budget) };
}

/** Direct callers retain the same work/time bounds as the worker. */
export function extractSourceStatements(input: ExtractionInput, options: ExtractionOptions = {}): ExtractionResult {
  const run = extractionRun(input, options);
  while (run.now() < run.deadline) if (run.steps.next().done) return run.result;
  run.steps.return(undefined); run.result.truncated = true;
  return run.result;
}

/** Small resumable batches let archive/lease changes take effect before more source work. */
export async function extractSourceStatementsCooperatively(input: ExtractionInput, options: ExtractionOptions = {}): Promise<ExtractionResult> {
  const run = extractionRun(input, options);
  while (run.now() < run.deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await options.onCheckpoint?.();
    const batchStart = run.now();
    for (let work = 0; work < 32 && run.now() < run.deadline; work++) {
      if (run.steps.next().done) return run.result;
      if (run.now() - batchStart >= 8) break;
    }
  }
  run.steps.return(undefined); run.result.truncated = true;
  return run.result;
}

export function matchesStatementSkeleton(skeleton: string, line: string): boolean {
  return line.length <= MAX_SOURCE_LOCATE_LINE_LENGTH && compileLogPattern(skeleton, "", MAX_SOURCE_LOCATE_LINE_LENGTH).test(line);
}
