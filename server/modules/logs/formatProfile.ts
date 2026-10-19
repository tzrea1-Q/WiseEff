import { z } from "zod";

import { compileLogPattern, createLogPatternCache, type LogPatternCache } from "./adminPattern";
import { logPatternBudgetIssues } from "./patternBudget";

/**
 * Declarative format profile for a log domain (glossary: Format profile).
 * Parsing stays UTF-8 text indexed by stable raw line numbers; a profile only
 * changes how lines are read, never how they are numbered.
 */
export type LogFormatProfile = {
  /** Regex matched against the start of a line; capture group 1 (or the whole match) becomes the timestamp. */
  timestampPattern?: string;
  /** Multi-line merge rule. Continuation lines join the previous entry; evidence keeps citing raw line numbers. */
  multiline?: {
    mode: "start-pattern" | "indent";
    /** Required for mode "start-pattern": a line matching it starts a new entry. */
    startPattern?: string;
  };
  /** Regex lists mapping raw lines onto the parsed severity vocabulary. First match wins (error, then warn, then info). */
  severityMap?: {
    error?: string[];
    warn?: string[];
    info?: string[];
  };
};

const severityPatternList = z.array(z.string().min(1)).max(32).optional();

export const logFormatProfileSchema = z
  .object({
    timestampPattern: z.string().min(1).optional(),
    multiline: z
      .object({
        mode: z.enum(["start-pattern", "indent"]),
        startPattern: z.string().min(1).optional()
      })
      .strict()
      .refine((value) => value.mode !== "start-pattern" || Boolean(value.startPattern), {
        message: "multiline.startPattern is required when multiline.mode is 'start-pattern'."
      })
      .optional(),
    severityMap: z
      .object({
        error: severityPatternList,
        warn: severityPatternList,
        info: severityPatternList
      })
      .strict()
      .optional()
  })
  .strict();

export const formatPreviewRequestSchema = z.object({
  sampleText: z.string().max(1024 * 1024),
  formatProfile: z.unknown().refine((value) => value !== undefined, "Format profile is required")
}).strict();
const previewLineSchema = z.object({ line: z.number().int().positive(), text: z.string(), timestamp: z.string().optional(), severity: z.enum(["error", "warn", "info"]) });
export const formatPreviewResponseSchema = z.object({
  lines: z.array(previewLineSchema),
  entries: z.array(previewLineSchema.omit({ line: true }).extend({ lineNumbers: z.array(z.number().int().positive()) }))
});

export type ValidateLogFormatProfileResult =
  | { ok: true; profile: LogFormatProfile }
  | { ok: false; issues: string[]; details?: { path: (string | number)[]; message: string }[] };

const issuePath = (path: (string | number)[]) => path.map((part, index) => typeof part === "number" ? `[${part}]` : `${index ? "." : ""}${part}`).join("");

function collectRegexIssues(profile: LogFormatProfile, cache: LogPatternCache) {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const check = (pattern: string | undefined, path: (string | number)[]) => {
    if (pattern === undefined) {
      return;
    }
    try {
      compileLogPattern(pattern, "", undefined, cache);
    } catch (error) {
      issues.push({ path, message: `is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  check(profile.timestampPattern, ["timestampPattern"]);
  check(profile.multiline?.startPattern, ["multiline", "startPattern"]);
  for (const severity of ["error", "warn", "info"] as const) {
    for (const [index, pattern] of (profile.severityMap?.[severity] ?? []).entries()) {
      check(pattern, ["severityMap", severity, index]);
    }
  }

  return issues;
}

/** Validates a format profile JSON value: schema shape first, then regex compilability. */
export function validateLogFormatProfile(value: unknown, cache = createLogPatternCache()): ValidateLogFormatProfileResult {
  const budgetIssues = logPatternBudgetIssues(value, "format");
  if (budgetIssues.some((issue) => issue.message.startsWith("Total pattern"))) return {
    ok: false, details: budgetIssues, issues: budgetIssues.map(({ path, message }) => `${issuePath(path)} is not a valid regular expression: ${message}`)
  };
  const parsed = logFormatProfileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
    };
  }

  const regexIssues = collectRegexIssues(parsed.data, cache);
  if (regexIssues.length > 0) {
    return { ok: false, details: regexIssues, issues: regexIssues.map(({ path, message }) => `${issuePath(path)} ${message}`) };
  }

  return { ok: true, profile: parsed.data };
}

/** The form and save path report regex failures at the same precise property. */
export const validatedLogFormatProfileSchema = logFormatProfileSchema.superRefine((profile, ctx) => {
  const result = validateLogFormatProfile(profile);
  if (!result.ok) for (const issue of result.details ?? result.issues.map((message) => ({ path: [], message }))) {
    ctx.addIssue({ code: "custom", ...issue });
  }
});

/** Reads a stored profile defensively: rows are validated on save, so invalid content degrades to generic parsing. */
export function readStoredLogFormatProfile(value: unknown): LogFormatProfile | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const result = validateLogFormatProfile(value);
  return result.ok ? result.profile : undefined;
}
