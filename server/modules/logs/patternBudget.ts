import { z } from "zod";
import { fileGlobPattern, logPatternProgramCost, MAX_LOG_PATTERN_TOTAL_SIZE } from "./adminPattern";

type PatternSource = { source: string; path: (string | number)[] };
type BudgetKind = "skill" | "parsing" | "signals" | "format";
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Walk only pattern-bearing fields in the closed spec, before nested schemas compile them. */
function* patterns(value: unknown, kind: BudgetKind): Generator<PatternSource> {
  const root = object(value);
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
  let total = 0;
  for (const { source, path } of patterns(value, kind)) {
    try {
      total += logPatternProgramCost(source);
      if (total > MAX_LOG_PATTERN_TOTAL_SIZE) throw new Error(`Total pattern program budget exceeds ${MAX_LOG_PATTERN_TOTAL_SIZE} instructions`);
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
