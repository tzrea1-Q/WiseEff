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
  groupNames: string[];
  groupCount: number;
  test(input: string): boolean;
  exec(input: string): RegExpExecArray | null;
  matchAll(input: string, includeCaptures?: boolean): Iterable<RegExpExecArray>;
};

/**
 * Untrusted patterns use RE2 only, with no native RegExp fallback. Supports i/m/s;
 * lookaround and backreferences are rejected by the engine (LOOKBEHINDS stays off).
 * Limits count UTF-16 code units. Over-long inputs yield no match, rather than
 * truncating and inventing end-of-line matches; callers retain the original text.
 */
export function compileLogPattern(pattern: string, flags = "", maxInputLength = MAX_LOG_PATTERN_INPUT_LENGTH): LogPattern {
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
    groupNames: Object.keys(compiled.namedGroups()),
    groupCount: compiled.groupCount(),
    test: (input) => input.length <= maxInputLength && compiled.test(input),
    // RE2JS returns index/input/groups at runtime but declares only any[].
    exec: (input) => input.length <= maxInputLength ? compiled.exec(input) as RegExpExecArray | null : null,
    *matchAll(input, includeCaptures = true) {
      if (input.length > maxInputLength) return;
      const matcher = compiled.matcher(input);
      while (matcher.find()) {
        const match = Array.from({ length: includeCaptures ? compiled.groupCount() + 1 : 1 }, (_, index) => matcher.group(index) ?? undefined) as RegExpExecArray;
        match.index = matcher.start();
        match.input = input;
        if (includeCaptures && Object.keys(compiled.namedGroups()).length) match.groups = Object.fromEntries(
          Object.keys(compiled.namedGroups()).map((name) => [name, matcher.group(name) ?? undefined])
        ) as Record<string, string>;
        yield match;
      }
    }
  };
}

/** Case-sensitive path globs; all other characters remain literal. */
export function compileFileGlob(glob: string): LogPattern {
  const source = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\*\*|\*|\?/g,
    (token) => token === "**/" ? "(?:.*/)?" : token === "**" ? ".*" : token === "*" ? "[^/]*" : "[^/]");
  return compileLogPattern(`^${source}$`);
}
