import { z } from "zod";
import { fileGlobPattern, logPatternProgramCost, MAX_LOG_PATTERN_TOTAL_SIZE } from "./adminPattern";
import { MAX_FILE_GLOB_LENGTH, MAX_FILE_ROLE_LENGTH, MAX_SKILL_FILE_GLOBS, skillFileGlobPattern } from "../../../src/domain/logs/fileApplicability";

type PatternSource = { source: string; path: (string | number)[]; skillFileGlob?: boolean };
type BudgetKind = "skill" | "parsing" | "signals" | "format";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Walk only pattern-bearing fields in the closed spec, before nested schemas compile them. */
function* patterns(value: unknown, kind: BudgetKind): Generator<PatternSource> {
  const root = object(value);
  if (kind === "skill" && Array.isArray(root.files)) for (const [index, file] of root.files.entries()) {
    if (typeof object(file).glob === "string") yield { source: object(file).glob as string, path: ["files", index, "glob"], skillFileGlob: true };
  }
  if (kind === "skill" || kind === "format") {
    const profile = kind === "format" ? root : object(root.formatProfile), severity = object(profile.severityMap);
    const prefix = kind === "format" ? [] : ["formatProfile"];
    for (const [key, source] of [["timestampPattern", profile.timestampPattern], ["multiline", object(profile.multiline).startPattern]] as const) {
      if (typeof source === "string") yield { source, path: [...prefix, key, ...(key === "multiline" ? ["startPattern"] : [])] };
    }
    for (const level of ["error", "warn", "info"]) {
      if (Array.isArray(severity[level])) for (const [index, source] of severity[level].entries()) {
        if (typeof source === "string") yield { source, path: [...prefix, "severityMap", level, index] };
      }
    }
    const statementPatterns = kind === "skill" ? object(root.source).statementPatterns : undefined;
    if (Array.isArray(statementPatterns)) for (const [index, source] of statementPatterns.entries()) {
      if (typeof source === "string") yield { source, path: ["source", "statementPatterns", index] };
    }
  }
  const parsing = kind === "parsing" ? root : object(root.parsing), prefix = kind === "parsing" ? [] : ["parsing"];
  if (kind !== "signals" && Array.isArray(parsing.extractors)) for (const [index, value] of parsing.extractors.entries()) {
    const extractor = object(value), path = [...prefix, "extractors", index];
    if (typeof extractor.pattern === "string") yield { source: extractor.pattern, path: [...path, "pattern"] };
    for (const name of ["start", "continue", "end"]) {
      const source = object(extractor.multiline)[name];
      if (typeof source === "string") yield { source, path: [...path, "multiline", name] };
    }
    if (Array.isArray(extractor.files)) for (const [fileIndex, glob] of extractor.files.entries()) {
      if (typeof glob === "string") yield { source: fileGlobPattern(glob), path: [...path, "files", fileIndex] };
    }
    for (const [name, field] of Object.entries(object(extractor.fields))) {
      const format = object(field).format;
      // Timestamp directives expand to fixed small patterns; charge a conservative upper bound.
      if (object(field).type === "timestamp" && typeof format === "string") yield {
        source: "x".repeat(Math.min(format.length, 200) * 4 + 100), path: [...path, "fields", name, "format"]
      };
    }
  }
  const signals = kind === "signals" ? root : object(root.signalRules), signalPrefix = kind === "signals" ? [] : ["signalRules"];
  if (kind !== "parsing" && Array.isArray(signals.rules)) for (const [index, value] of signals.rules.entries()) {
    const rule = object(value);
    if (Array.isArray(rule.anyOf)) for (const [conditionIndex, value] of rule.anyOf.entries()) {
      const input = object(value), condition = input.type === "window" ? object(input.condition) : input;
      if (condition.type === "text" && typeof condition.pattern === "string") yield {
        source: condition.pattern, path: [...signalPrefix, "rules", index, "anyOf", conditionIndex, ...(input.type === "window" ? ["condition"] : []), "pattern"]
      };
    }
  }
}

/** Declaration totals are conservative: even duplicate patterns consume the spec budget. */
export function logPatternBudgetIssues(value: unknown, kind: BudgetKind) {
  // Reject the whole applicability batch before translating or compiling any pattern.
  const files = kind === "skill" ? object(value).files : undefined;
  if (Array.isArray(files)) {
    if (files.length > MAX_SKILL_FILE_GLOBS) return [{ path: ["files"], message: `最多允许 ${MAX_SKILL_FILE_GLOBS} 条文件匹配规则` }];
    for (const [index, file] of files.entries()) {
      for (const [key, limit] of [["glob", MAX_FILE_GLOB_LENGTH], ["role", MAX_FILE_ROLE_LENGTH]] as const) {
        const field = object(file)[key];
        if (typeof field === "string" && field.length > limit) return [{ path: ["files", index, key], message: `最多允许 ${limit} 个字符` }];
      }
    }
  }
  let total = 0;
  for (const { source, path, skillFileGlob } of patterns(value, kind)) {
    try {
      total += logPatternProgramCost(skillFileGlob ? skillFileGlobPattern(source) : source);
      if (total > MAX_LOG_PATTERN_TOTAL_SIZE) throw new Error(`所有匹配规则的复杂度合计超过 ${MAX_LOG_PATTERN_TOTAL_SIZE} 条指令上限`);
    } catch (error) {
      return [{ path, message: error instanceof Error ? error.message : String(error) }];
    }
  }
  return [];
}

export function withLogPatternBudget<T extends z.ZodTypeAny>(schema: T, kind: BudgetKind) {
  return z.preprocess((value, ctx) => {
    const issues = logPatternBudgetIssues(value, kind);
    if (issues.length) {
      for (const issue of issues) ctx.addIssue({ code: "custom", ...issue, fatal: true });
      return z.NEVER;
    }
    return value;
  }, schema);
}
