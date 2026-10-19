import { z } from "zod";
import { compileFileGlob, compileLogPattern, createLogPatternCache, type LogPatternCache } from "../adminPattern";
import { withLogPatternBudget } from "../patternBudget";

export const MAX_PARSING_PATTERN_CHARS = 512;
export const MAX_PARSING_LINE_CHARS = 6144;
export const MAX_PARSING_MATCH_CHARS = 16_384;
export const MAX_REGISTERS = 32;
export const MAX_REGISTER_FIELDS = 64;
export const MAX_REGISTER_ENUM_VALUES = 64;
export const MAX_REGISTER_ENUM_LABEL_CHARS = 128;
export const MAX_REGISTER_DECODE_CAPTURES = 8;

/** Bound RE2 program size before compiling, including multiline controls. */
export function compileParsingPattern(source: string, flags = "", maxInputLength = MAX_PARSING_LINE_CHARS, cache?: LogPatternCache) {
  if (source.length > MAX_PARSING_PATTERN_CHARS) throw new Error(`Parsing pattern exceeds ${MAX_PARSING_PATTERN_CHARS} UTF-16 code units`);
  return compileLogPattern(source, flags, maxInputLength, cache);
}

const identifier = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/);
const fieldName = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).max(100);
const decodeReference = z.union([z.object({ register: identifier }).strict(), z.object({ registerMap: identifier }).strict()]);
const simple = ["float", "bool", "string", "hexbytes", "base64bytes"] as const;
const enumValues = z.record(z.string().max(100), z.string().max(MAX_REGISTER_ENUM_LABEL_CHARS))
  .refine((values) => Object.keys(values).length <= MAX_REGISTER_ENUM_VALUES, `At most ${MAX_REGISTER_ENUM_VALUES} enum values`);
export const fieldSpecSchema = z.union([
  z.object({ type: z.enum(["int", "uint", "hex"]), decode: decodeReference.optional() }).strict(),
  z.object({ type: z.enum(simple) }).strict(),
  z.object({ type: z.literal("enum"), values: enumValues }).strict(),
  z.object({ type: z.literal("timestamp"), format: z.string().min(1).max(200) }).strict()
]);
export const registerFieldSchema = z.object({
  bits: z.tuple([z.number().int().min(0).max(63), z.number().int().min(0).max(63)]), name: fieldName,
  enum: enumValues.optional(),
  scale: z.number().finite().optional(), offset: z.number().finite().optional(), unit: z.string().max(100).optional(),
  signed: z.boolean().optional(), description: z.string().max(4096).optional()
}).strict();
const registerSchema = z.object({ width: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]),
  fields: z.array(registerFieldSchema).max(MAX_REGISTER_FIELDS) }).strict();
const registerMapSchema = z.object({ selectBy: fieldName,
  cases: z.record(z.string().min(1).max(100), identifier).refine((cases) => Object.keys(cases).length <= 4096, "At most 4096 map cases"),
  default: identifier.optional() }).strict();
/** Numeric address keys compare by value, so 0x0C, 12 and 0b1100 select the same case. */
export function registerCaseKey(value: string): string {
  if (!/^[+-]?(?:\d+|0x[\da-f]+|0b[01]+)$/i.test(value)) return value;
  return ((value[0] === "-" ? -1n : 1n) * BigInt(value.replace(/^[+-]/, ""))).toString();
}
const pattern = z.string().min(1).max(MAX_PARSING_PATTERN_CHARS, `Parsing pattern exceeds ${MAX_PARSING_PATTERN_CHARS} UTF-16 code units`);
export function timestampFormat(format: string, cache?: LogPatternCache) {
  const names: string[] = [];
  const tokens: Record<string, string> = { Y: "\\d{4}", m: "\\d{2}", d: "\\d{2}", H: "\\d{2}", M: "\\d{2}", S: "\\d{2}", f: "\\d{1,6}", z: "Z|[+-]\\d{2}:?\\d{2}" };
  let source = "";
  for (let i = 0; i < format.length; i++) {
    if (format[i] === "%") {
      const token = format[++i];
      if (token === "%") source += "%";
      else { if (!Object.hasOwn(tokens, token) || names.includes(token)) throw new Error("Unsupported or duplicate timestamp directive"); names.push(token); source += `(${tokens[token]})`; }
    } else source += format[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return { names, pattern: compileLogPattern(`^${source}$`, "", undefined, cache) };
}
export const parsingSpecSchema = withLogPatternBudget(z.object({
  schemaVersion: z.literal("parsing/v1"),
  registers: z.record(identifier, registerSchema).refine((v) => Object.keys(v).length <= MAX_REGISTERS, `At most ${MAX_REGISTERS} registers`).optional(),
  registerMaps: z.record(identifier, registerMapSchema).refine((v) => Object.keys(v).length <= 200, "At most 200 register maps").optional(),
  extractors: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/),
    files: z.array(z.string().min(1).max(1024)).max(200).optional(),
    pattern,
    fields: z.record(fieldName, fieldSpecSchema),
    multiline: z.object({ start: pattern, continue: pattern.optional(), end: pattern.optional(),
      keyField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(), maxLines: z.number().int().min(1).max(200) }).strict().optional()
  }).strict()).max(200)
}).strict().superRefine((spec, ctx) => {
  const cache = createLogPatternCache();
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  for (const [id, register] of Object.entries(spec.registers ?? {})) {
    const names = new Set<string>(), occupied = new Set<number>();
    register.fields.forEach((field, index) => {
      const path = ["registers", id, "fields", index], [hi, lo] = field.bits;
      if (names.has(field.name)) add([...path, "name"], "Duplicate field name");
      names.add(field.name);
      if (hi < lo) add([...path, "bits"], "Bits must be ordered [hi, lo]");
      if (hi >= register.width) add([...path, "bits", 0], "Bit is outside register width");
      if (lo >= register.width) add([...path, "bits", 1], "Bit is outside register width");
      let overlap = false;
      for (let bit = lo; bit <= hi; bit++) { if (occupied.has(bit)) overlap = true; occupied.add(bit); }
      if (overlap) add([...path, "bits"], "Overlapping register bits");
    });
  }
  for (const [id, map] of Object.entries(spec.registerMaps ?? {})) {
    const keys = new Set<string>();
    for (const [key, register] of Object.entries(map.cases)) {
      if (!Object.hasOwn(spec.registers ?? {}, register)) add(["registerMaps", id, "cases", key], "Unknown register");
      const normalized = registerCaseKey(key);
      if (keys.has(normalized)) add(["registerMaps", id, "cases", key], "Duplicate normalized map case");
      keys.add(normalized);
    }
    if (map.default && !Object.hasOwn(spec.registers ?? {}, map.default)) add(["registerMaps", id, "default"], "Unknown register");
  }
  const ids = new Set<string>();
  spec.extractors.forEach((extractor, index) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom",
      path: ["extractors", index, ...path], message: `Extractor ${extractor.id}: ${message}` });
    if (ids.has(extractor.id)) issue(["id"], "duplicate id");
    ids.add(extractor.id);
    extractor.files?.forEach((glob, fileIndex) => {
      try { compileFileGlob(glob, cache); } catch (error) { issue(["files", fileIndex], String(error)); }
    });
    try {
      const compiled = compileParsingPattern(extractor.pattern, "s", undefined, cache), groups = compiled.groupNames;
      if (compiled.groupCount !== groups.length) issue(["pattern"], "every capture group must be named and mapped to a field");
      for (const name of groups) if (!Object.hasOwn(extractor.fields, name)) issue(["fields", name], `group ${name} has no declared field`);
      for (const name of Object.keys(extractor.fields)) if (!groups.includes(name)) issue(["fields", name], `field ${name} has no pattern group`);
    } catch (error) { issue(["pattern"], String(error)); }
    if (extractor.multiline) {
      const { keyField, ...controls } = extractor.multiline;
      if (keyField && !Object.hasOwn(extractor.fields, keyField)) issue(["multiline", "keyField"], `field ${keyField} is not declared`);
      for (const name of ["start", "continue", "end"] as const) {
        if (!controls[name]) continue;
        try {
          const compiled = compileParsingPattern(controls[name], "", undefined, cache), groups = compiled.groupNames;
          if (compiled.groupCount !== groups.length) issue(["multiline", name], "every capture group must be named and mapped to a field");
          for (const group of groups) if (!Object.hasOwn(extractor.fields, group)) issue(["multiline", name], `group ${group} has no declared field`);
          if (keyField && !groups.includes(keyField)) issue(["multiline", name], `pattern must capture key field ${keyField}`);
        } catch (error) { issue(["multiline", name], String(error)); }
      }
    }
    let registerCaptures = 0;
    for (const [name, field] of Object.entries(extractor.fields)) {
      if ("decode" in field && field.decode) {
        if (++registerCaptures > MAX_REGISTER_DECODE_CAPTURES) issue(["fields", name, "decode"], `at most ${MAX_REGISTER_DECODE_CAPTURES} register-decoded captures`);
        if ("register" in field.decode) {
          if (!Object.hasOwn(spec.registers ?? {}, field.decode.register)) issue(["fields", name, "decode", "register"], "unknown register");
        } else {
          const map = spec.registerMaps?.[field.decode.registerMap];
          if (!map) issue(["fields", name, "decode", "registerMap"], "unknown register map");
          else if (!Object.hasOwn(extractor.fields, map.selectBy)) add(["registerMaps", field.decode.registerMap, "selectBy"], `Field ${map.selectBy} is not declared in extractor ${extractor.id}`);
        }
      }
      if (field.type === "timestamp") try { timestampFormat(field.format, cache); }
      catch (error) { issue(["fields", name, "format"], `field ${name}: ${String(error)}`); }
    }
  });
}), "parsing");

export type ParsingSpec = z.infer<typeof parsingSpecSchema>;
export type FieldSpec = z.infer<typeof fieldSpecSchema>;
export type RegisterSpec = z.infer<typeof registerSchema>;
export type RegisterField = z.infer<typeof registerFieldSchema>;

export const decodedScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null(),
  z.object({ hex: z.string(), length: z.number().int().nonnegative() }).strict()]);
export const MAX_DECODE_DEPTH = 8;
type DecodedScalar = z.infer<typeof decodedScalarSchema>;
export type DecodedValue = DecodedScalar | { raw: string; value: DecodedScalar; meaning?: string; unit?: string; fields?: Record<string, DecodedValue> };
function decodedAtDepth(depth: number): z.ZodType<DecodedValue> {
  return z.union([decodedScalarSchema, z.object({ raw: z.string(), value: decodedScalarSchema,
    meaning: z.string().optional(), unit: z.string().optional(),
    fields: depth < MAX_DECODE_DEPTH ? z.record(z.lazy(() => decodedAtDepth(depth + 1))).optional() : z.never().optional()
  }).strict()]);
}
export const decodedValueSchema = decodedAtDepth(1);
export const decodedFieldsSchema = z.record(decodedValueSchema);
export const decodedEventSchema = z.object({
  v: z.literal(1), source: z.literal("declarative"), extractor: z.string(), file: z.string(), line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(), fields: decodedFieldsSchema,
  errors: z.array(z.object({ field: z.string().optional(), code: z.string(), message: z.string() }).strict()).optional()
}).strict();
export type DecodedEvent = z.infer<typeof decodedEventSchema>;
const decodeTruncationReasonSchema = z.enum(["time_cap", "line_cap", "event_cap", "output_field_cap", "output_byte_cap"]);
export type DecodeTruncationReason = z.infer<typeof decodeTruncationReasonSchema>;
export const decodeCountsSchema = z.object({ total: z.number(), byExtractor: z.record(z.number()), errors: z.record(z.number()),
  truncated: z.boolean().optional(), reason: decodeTruncationReasonSchema.optional() });
export type DecodeCounts = z.infer<typeof decodeCountsSchema>;
export const parsePreviewRequestSchema = z.object({ parsing: z.unknown().refine((value) => value !== undefined, "Parsing spec is required"), sampleText: z.string().max(1024 * 1024), fileName: z.string().min(1).max(1024).optional() }).strict();
export const parsePreviewResponseSchema = z.object({ valid: z.boolean(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  events: z.array(decodedEventSchema), counts: decodeCountsSchema, unmatchedLineCount: z.number(),
  truncated: z.boolean().default(false), reason: decodeTruncationReasonSchema.optional() });
