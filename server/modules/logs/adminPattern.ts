import { RE2JS } from "re2js";

export const MAX_LOG_PATTERN_LENGTH = 4_096;
export const MAX_LOG_PATTERN_INPUT_LENGTH = 65_536;

export class LogPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LogPatternError";
  }
}

export type LogPattern = {
  test(input: string): boolean;
  exec(input: string): RegExpExecArray | null;
};

/**
 * Untrusted patterns use RE2 only, with no native RegExp fallback. Supports i/m/s;
 * lookaround and backreferences are rejected by the engine (LOOKBEHINDS stays off).
 * Limits count UTF-16 code units. Over-long inputs yield no match, rather than
 * truncating and inventing end-of-line matches; callers retain the original text.
 */
export function compileLogPattern(pattern: string, flags = ""): LogPattern {
  if (pattern.length > MAX_LOG_PATTERN_LENGTH) {
    throw new LogPatternError(`Pattern exceeds ${MAX_LOG_PATTERN_LENGTH} UTF-16 code units.`);
  }
  let engineFlags = 0;
  const supportedFlags: Record<string, number> = {
    i: RE2JS.CASE_INSENSITIVE,
    m: RE2JS.MULTILINE,
    s: RE2JS.DOTALL
  };
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!Object.hasOwn(supportedFlags, flag) || seen.has(flag)) {
      throw new LogPatternError(`Unsupported or duplicate regular expression flag: ${flag}`);
    }
    seen.add(flag);
    engineFlags |= supportedFlags[flag];
  }
  let compiled: RE2JS;
  try {
    compiled = RE2JS.compile(pattern, engineFlags);
  } catch (error) {
    throw new LogPatternError(error instanceof Error ? error.message : String(error));
  }
  return {
    test: (input) => input.length <= MAX_LOG_PATTERN_INPUT_LENGTH && compiled.test(input),
    // RE2JS returns index/input/groups at runtime but declares only any[].
    exec: (input) => input.length <= MAX_LOG_PATTERN_INPUT_LENGTH ? compiled.exec(input) as RegExpExecArray | null : null
  };
}
