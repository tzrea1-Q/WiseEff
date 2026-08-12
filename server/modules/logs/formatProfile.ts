import { z } from "zod";

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

export type ValidateLogFormatProfileResult =
  | { ok: true; profile: LogFormatProfile }
  | { ok: false; issues: string[] };

function collectRegexIssues(profile: LogFormatProfile): string[] {
  const issues: string[] = [];
  const check = (pattern: string | undefined, field: string) => {
    if (pattern === undefined) {
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (error) {
      issues.push(`${field} is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  check(profile.timestampPattern, "timestampPattern");
  check(profile.multiline?.startPattern, "multiline.startPattern");
  for (const severity of ["error", "warn", "info"] as const) {
    for (const [index, pattern] of (profile.severityMap?.[severity] ?? []).entries()) {
      check(pattern, `severityMap.${severity}[${index}]`);
    }
  }

  return issues;
}

/** Validates a format profile JSON value: schema shape first, then regex compilability. */
export function validateLogFormatProfile(value: unknown): ValidateLogFormatProfileResult {
  const parsed = logFormatProfileSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "profile"}: ${issue.message}`)
    };
  }

  const regexIssues = collectRegexIssues(parsed.data);
  if (regexIssues.length > 0) {
    return { ok: false, issues: regexIssues };
  }

  return { ok: true, profile: parsed.data };
}

/** Reads a stored profile defensively: rows are validated on save, so invalid content degrades to generic parsing. */
export function readStoredLogFormatProfile(value: unknown): LogFormatProfile | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const result = validateLogFormatProfile(value);
  return result.ok ? result.profile : undefined;
}
