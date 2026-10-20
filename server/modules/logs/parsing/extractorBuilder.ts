import { z } from "zod";
import { compileLogPattern, createLogPatternCache, MAX_LOG_PATTERN_LENGTH } from "../adminPattern";
import { compileParsingPattern, fieldSpecSchema, MAX_PARSING_LINE_CHARS, MAX_PARSING_PATTERN_CHARS } from "./spec";

export const MAX_EXTRACTOR_PREVIEW_LINES = 500;
export const MAX_EXTRACTOR_PREVIEW_BYTES = 1024 * 1024;
const line = z.string().max(MAX_PARSING_LINE_CHARS).refine((value) => !/[\r\n]/.test(value), "请提供单行样例");
export const extractorSegmentSchema = z.object({
  start: z.number().int().nonnegative(), end: z.number().int().positive(),
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(100),
  type: z.enum(["int", "uint", "hex", "float", "string", "quoted"])
}).strict();
export const extractorPreviewRequestSchema = z.object({
  line, segments: z.array(extractorSegmentSchema).max(32),
  sampleLines: z.array(line).max(MAX_EXTRACTOR_PREVIEW_LINES),
  generalizeNumbers: z.boolean().optional(), timestampPattern: z.string().min(1).max(MAX_LOG_PATTERN_LENGTH).optional(),
  pattern: z.string().min(1).max(MAX_PARSING_PATTERN_CHARS).optional()
}).strict();
export const extractorPreviewResponseSchema = z.object({
  pattern: z.string(), fields: z.record(fieldSpecSchema),
  matchedLines: z.array(z.object({ line: z.number().int().positive(), text: z.string() })),
  matchCount: z.number().int().nonnegative(), totalLines: z.number().int().nonnegative(), coverage: z.number().min(0).max(1)
});
export type ExtractorPatternInput = z.infer<typeof extractorPreviewRequestSchema>;

const escapeLiteral = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function literalPattern(text: string, generalizeNumbers: boolean, timestamp = false) {
  let result = "", cursor = 0;
  for (const match of text.matchAll(/\s+|\d+/g)) {
    result += escapeLiteral(text.slice(cursor, match.index));
    const number = /^\d/.test(match[0]);
    // Keep digits inside identifiers literal; timestamp punctuation remains fixed.
    result += !number ? "\\s+" : generalizeNumbers && (timestamp || !/[A-Za-z_]/.test(text[match.index - 1] ?? "") && !/[A-Za-z_]/.test(text[match.index + match[0].length] ?? "")) ? "\\d+" : match[0];
    cursor = match.index + match[0].length;
  }
  return result + escapeLiteral(text.slice(cursor));
}

/** Pure, bounded engine interface. Offsets are UTF-16 code units, like browser selections. */
export function generateExtractorPattern(value: ExtractorPatternInput) {
  const input = extractorPreviewRequestSchema.parse(value);
  if (Buffer.byteLength(input.line, "utf8") + input.sampleLines.reduce((bytes, text) => bytes + Buffer.byteLength(text, "utf8"), 0) > MAX_EXTRACTOR_PREVIEW_BYTES) {
    throw new Error("字段解析样例的 UTF-8 编码不能超过 1 MiB");
  }
  const segments = [...input.segments].sort((a, b) => a.start - b.start);
  const cache = createLogPatternCache();
  const generalizeNumbers = input.generalizeNumbers ?? true;
  // Recognized leading timestamps are metadata; keep the message itself anchored.
  const timestamp = generalizeNumbers && !input.pattern ? (input.timestampPattern
    ? compileLogPattern(input.timestampPattern, "", MAX_PARSING_LINE_CHARS, cache).exec(input.line)
    : /^\[\s*\d+(?:\.\d+)?\]\s*/.exec(input.line)) : null;
  const prefixEnd = timestamp?.index === 0 && timestamp[0].length > 0
    ? timestamp[0].length + (/^\s*/.exec(input.line.slice(timestamp[0].length))?.[0].length ?? 0) : 0;
  const timestampEnd = prefixEnd <= (segments[0]?.start ?? 0) ? prefixEnd : 0;
  const names = new Set<string>();
  let cursor = timestampEnd, generated = "^";
  if (timestampEnd) generated += `(?:${literalPattern(input.line.slice(0, timestampEnd), true, true)})?`;
  for (const segment of segments) {
    if (segment.start < cursor || segment.end <= segment.start || segment.end > input.line.length) throw new Error("所选字段须位于样例行内，不能为空或相互重叠");
    if (names.has(segment.name)) throw new Error(`字段名称重复: ${segment.name}`);
    names.add(segment.name);
    generated += literalPattern(input.line.slice(cursor, segment.start), generalizeNumbers);
    const selected = input.line.slice(segment.start, segment.end);
    const patterns = { int: "[+-]?\\d+", uint: "\\d+", hex: "(?:0x)?[0-9A-Fa-f]+", float: "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?", string: /\s/.test(selected) ? "[^\\r\\n]+?" : "\\S+", quoted: '[^"]*' };
    const quoted = segment.type === "quoted";
    const includesQuotes = quoted && selected.startsWith('"') && selected.endsWith('"') && selected.length >= 2;
    if (quoted && !includesQuotes && !(input.line[segment.start - 1] === '"' && input.line[segment.end] === '"')) throw new Error("引号字段须选中完整双引号或其中的内容");
    generated += `${includesQuotes ? '"' : ""}(?P<${segment.name}>${patterns[segment.type]})${includesQuotes ? '"' : ""}`;
    cursor = segment.end;
  }
  generated += literalPattern(input.line.slice(cursor), generalizeNumbers) + "$";
  if (!input.pattern && !segments.length) throw new Error("请至少选择一个字段");
  const pattern = input.pattern ?? generated;
  const compiled = compileParsingPattern(pattern, "", MAX_PARSING_LINE_CHARS, cache);
  if (compiled.groupCount !== compiled.groupNames.length) throw new Error("每个捕获组都须命名");
  if (compiled.groupNames.length > 32) throw new Error("最多允许 32 个捕获字段");
  if (compiled.groupNames.some((name) => !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(name))) throw new Error("捕获组名称须为有效字段标识，且不能超过 100 个字符");
  if (!input.pattern && !compiled.test(input.line)) throw new Error("所选内容与字段类型不符");
  const fields = Object.fromEntries(compiled.groupNames.map((name) => {
    const type = segments.find((segment) => segment.name === name)?.type ?? "string";
    return [name, { type: type === "quoted" ? "string" as const : type }];
  }));
  let totalLines = input.sampleLines.length;
  while (totalLines && input.sampleLines[totalLines - 1] === "") totalLines--;
  const matchedLines = input.sampleLines.slice(0, totalLines).flatMap((text, index) => compiled.test(text) ? [{ line: index + 1, text }] : []);
  return { pattern, fields, matchedLines: matchedLines.slice(0, 5), matchCount: matchedLines.length, totalLines,
    coverage: totalLines ? matchedLines.length / totalLines : 0 };
}
