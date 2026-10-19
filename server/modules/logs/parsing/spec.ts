import { z } from "zod";
import { compileFileGlob, compileLogPattern } from "../adminPattern";

export const MAX_PARSING_PATTERN_CHARS = 512;
export const MAX_PARSING_LINE_CHARS = 6144;
export const MAX_PARSING_MATCH_CHARS = 16_384;

/** Bound RE2 program size before compiling, including multiline controls. */
export function compileParsingPattern(source: string, flags = "", maxInputLength = MAX_PARSING_LINE_CHARS) {
  if (source.length > MAX_PARSING_PATTERN_CHARS) throw new Error(`Parsing pattern exceeds ${MAX_PARSING_PATTERN_CHARS} UTF-16 code units`);
  let characterClass = false, quoted = false;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\") {
      if (source[i + 1] === "Q" && !quoted) quoted = true;
      else if (source[i + 1] === "E" && quoted) quoted = false;
      i++; continue;
    }
    if (quoted) continue;
    if (source[i] === "[") characterClass = true;
    if (source[i] === "]") characterClass = false;
    if (characterClass || source[i] !== "{") continue;
    const repetition = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(i));
    if (repetition && (Number(repetition[1]) > 100 || Number(repetition[2] ?? 0) > 100)) {
      throw new Error("Parsing counted repetition must not exceed 100");
    }
  }
  return compileLogPattern(source, flags, maxInputLength);
}

const simple = ["int", "uint", "float", "bool", "string", "hexbytes", "base64bytes"] as const;
export const fieldSpecSchema = z.union([
  z.object({ type: z.enum(simple) }).strict(),
  z.object({ type: z.literal("enum"), values: z.record(z.string()) }).strict(),
  z.object({ type: z.literal("timestamp"), format: z.string().min(1).max(200) }).strict()
]);
const pattern = z.string().min(1).max(MAX_PARSING_PATTERN_CHARS, `Parsing pattern exceeds ${MAX_PARSING_PATTERN_CHARS} UTF-16 code units`);
export function timestampFormat(format: string) {
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
  return { names, pattern: compileLogPattern(`^${source}$`) };
}
export const parsingSpecSchema = z.object({
  schemaVersion: z.literal("parsing/v1"),
  extractors: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,99}$/),
    files: z.array(z.string().min(1).max(1024)).max(200).optional(),
    pattern,
    fields: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), fieldSpecSchema),
    multiline: z.object({ start: pattern, continue: pattern.optional(), end: pattern.optional(),
      keyField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).optional(), maxLines: z.number().int().min(1).max(200) }).strict().optional()
  }).strict()).max(200)
}).strict().superRefine((spec, ctx) => {
  const ids = new Set<string>();
  spec.extractors.forEach((extractor, index) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom",
      path: ["extractors", index, ...path], message: `Extractor ${extractor.id}: ${message}` });
    if (ids.has(extractor.id)) issue(["id"], "duplicate id");
    ids.add(extractor.id);
    extractor.files?.forEach((glob, fileIndex) => {
      try { compileFileGlob(glob); } catch (error) { issue(["files", fileIndex], String(error)); }
    });
    try {
      const compiled = compileParsingPattern(extractor.pattern, "s"), groups = compiled.groupNames;
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
          const compiled = compileParsingPattern(controls[name]), groups = compiled.groupNames;
          if (compiled.groupCount !== groups.length) issue(["multiline", name], "every capture group must be named and mapped to a field");
          for (const group of groups) if (!Object.hasOwn(extractor.fields, group)) issue(["multiline", name], `group ${group} has no declared field`);
          if (keyField && !groups.includes(keyField)) issue(["multiline", name], `pattern must capture key field ${keyField}`);
        } catch (error) { issue(["multiline", name], String(error)); }
      }
    }
    for (const [name, field] of Object.entries(extractor.fields)) {
      if (field.type === "timestamp") try { timestampFormat(field.format); }
      catch (error) { issue(["fields", name, "format"], `field ${name}: ${String(error)}`); }
    }
  });
});

export type ParsingSpec = z.infer<typeof parsingSpecSchema>;
export type FieldSpec = z.infer<typeof fieldSpecSchema>;

export const decodedScalarSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null(),
  z.object({ hex: z.string(), length: z.number().int().nonnegative() }).strict()]);
export const decodedValueSchema = z.union([decodedScalarSchema, z.object({ raw: z.string(), value: decodedScalarSchema }).strict()]);
export const decodedFieldsSchema = z.record(decodedValueSchema);
export const decodedEventSchema = z.object({
  v: z.literal(1), source: z.literal("declarative"), extractor: z.string(), file: z.string(), line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(), fields: decodedFieldsSchema,
  errors: z.array(z.object({ field: z.string().optional(), code: z.string(), message: z.string() }).strict()).optional()
}).strict();
export type DecodedValue = z.infer<typeof decodedValueSchema>;
export type DecodedEvent = z.infer<typeof decodedEventSchema>;
export type DecodeCounts = { total: number; byExtractor: Record<string, number>; errors: Record<string, number> };
export const decodeCountsSchema = z.object({ total: z.number(), byExtractor: z.record(z.number()), errors: z.record(z.number()) });
export const parsePreviewRequestSchema = z.object({ parsing: z.unknown().refine((value) => value !== undefined, "Parsing spec is required"), sampleText: z.string().max(1024 * 1024), fileName: z.string().min(1).max(1024).optional() }).strict();
export const parsePreviewResponseSchema = z.object({ valid: z.boolean(), issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])), message: z.string() })),
  events: z.array(decodedEventSchema), counts: decodeCountsSchema, unmatchedLineCount: z.number(),
  truncated: z.boolean().default(false), reason: z.enum(["time_cap", "line_cap", "event_cap"]).optional() });
