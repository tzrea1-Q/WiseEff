import { RE2JS } from "re2js";

export const MAX_LOG_PATTERN_LENGTH = 4_096;
export const MAX_LOG_PATTERN_INPUT_LENGTH = 65_536;
export const MAX_LOG_PATTERN_REPEAT_BOUND = 100;
// Budget units cover conservative instruction expansion and source parsing work.
export const MAX_LOG_PATTERN_PROGRAM_SIZE = 16_384;
export const MAX_LOG_PATTERN_TOTAL_SIZE = 65_536;

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

export type LogPatternCache = {
  compile(pattern: string, flags?: string, maxInputLength?: number): LogPattern;
};

/** Bound both instruction expansion and compilation work before entering RE2. */
export function logPatternProgramCost(pattern: string): number {
  if (pattern.length > MAX_LOG_PATTERN_LENGTH) {
    throw new LogPatternError(`匹配表达式超过 ${MAX_LOG_PATTERN_LENGTH} 个 UTF-16 代码单元上限。`);
  }
  const frames = [{ size: 0, atom: 0 }];
  const add = (size: number) => {
    const frame = frames[frames.length - 1];
    frame.size += size;
    frame.atom = size;
    if (frame.size + 3 > MAX_LOG_PATTERN_PROGRAM_SIZE) {
      throw new LogPatternError(`匹配表达式的复杂度超过 ${MAX_LOG_PATTERN_PROGRAM_SIZE} 条指令上限。`);
    }
  };
  for (let i = 0; i < pattern.length; i++) {
    const character = pattern[i];
    if (character === "\\") {
      const start = i;
      const escaped = pattern[++i];
      if (escaped === "Q") {
        while (++i < pattern.length) {
          if (pattern[i] === "\\" && pattern[i + 1] === "E") { i++; break; }
          add(1);
        }
      } else {
        // Properties can require substantial table work despite emitting one instruction.
        if (/[pPx]/.test(escaped ?? "") && pattern[i + 1] === "{") {
          const end = pattern.indexOf("}", i + 2);
          if (end !== -1) i = end;
        }
        add(i - start + 1);
      }
    } else if (character === "[") {
      const start = i;
      i++;
      if (pattern[i] === "^") i++;
      if (pattern[i] === "]") i++;
      for (; i < pattern.length && pattern[i] !== "]"; i++) {
        if (pattern[i] === "\\") i++;
        else if (pattern[i] === "[" && pattern[i + 1] === ":") {
          const end = pattern.indexOf(":]", i + 2);
          if (end !== -1) i = end + 1;
        }
      }
      // A long union of Unicode properties still compiles to one instruction.
      add(i - start + 1);
    } else if (character === "(") {
      let capture = true;
      if (pattern[i + 1] === "?") {
        const prefix = /^\(\?(?:P?<[^>]*>|[imsU-]*[:)])/.exec(pattern.slice(i));
        if (prefix) {
          i += prefix[0].length - 1;
          capture = prefix[0].includes("<");
          if (prefix[0].endsWith(")")) continue;
        }
      }
      // Reserve a no-op for an empty group/branch as well as capture markers.
      frames.push({ size: capture ? 3 : 1, atom: 0 });
    } else if (character === ")" && frames.length > 1) {
      add(frames.pop()!.size);
    } else if (character === "|") {
      add(2);
      frames[frames.length - 1].atom = 0;
    } else if (character === "*" || character === "+" || character === "?") {
      // A nullable star needs both a loop and an optional branch in RE2.
      const frame = frames[frames.length - 1];
      const atom = frame.atom;
      add(character === "*" ? 2 : 1);
      frame.atom += atom;
    } else if (character === "{") {
      const repetition = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i));
      // RE2 treats counts with leading zeroes as literal text.
      if (!repetition || repetition.slice(1).some((bound) => bound?.length > 1 && bound[0] === "0")) { add(1); continue; }
      const minimum = Number(repetition[1]);
      const maximum = repetition[2] === undefined ? minimum : repetition[2] === "" ? minimum + 1 : Number(repetition[2]);
      if (minimum > MAX_LOG_PATTERN_REPEAT_BOUND || (repetition[2] !== "" && maximum > MAX_LOG_PATTERN_REPEAT_BOUND)) {
        throw new LogPatternError(`匹配表达式的重复次数不能超过 ${MAX_LOG_PATTERN_REPEAT_BOUND}。`);
      }
      const frame = frames[frames.length - 1];
      const repeated = frame.atom * maximum + (repetition[2] === "" ? 2 : Math.max(0, maximum - minimum));
      frame.size -= frame.atom;
      add(repeated);
      i += repetition[0].length - 1;
    } else add(1);
  }
  // Invalid/unclosed groups remain RE2's responsibility, but still have a bound.
  // Even `{0}` must pay for parsing its atom before RE2 simplifies it away.
  const size = Math.max(pattern.length + 3, frames.reduce((total, frame) => total + frame.size, 3));
  if (size > MAX_LOG_PATTERN_PROGRAM_SIZE) throw new LogPatternError(`匹配表达式的复杂度超过 ${MAX_LOG_PATTERN_PROGRAM_SIZE} 条指令上限。`);
  return size;
}

/** One request/spec shares compiled programs and their aggregate memory budget. */
export function createLogPatternCache(): LogPatternCache {
  const programs = new Map<string, RE2JS>();
  let totalSize = 0;
  return {
    compile(pattern, flags = "", maxInputLength = MAX_LOG_PATTERN_INPUT_LENGTH) {
      const engineFlags = logPatternFlags(flags);
      const key = `${engineFlags}:${pattern}`;
      let compiled = programs.get(key);
      if (!compiled) {
        const estimatedSize = logPatternProgramCost(pattern);
        if (totalSize + estimatedSize > MAX_LOG_PATTERN_TOTAL_SIZE) {
          throw new LogPatternError(`所有匹配规则的复杂度合计超过 ${MAX_LOG_PATTERN_TOTAL_SIZE} 条指令上限。`);
        }
        try { compiled = RE2JS.compile(pattern, engineFlags); }
        catch (error) { throw new LogPatternError(`正则表达式语法无效：${error instanceof Error ? error.message : String(error)}`); }
        const size = Math.max(estimatedSize, compiled.programSize());
        if (size > MAX_LOG_PATTERN_PROGRAM_SIZE) throw new LogPatternError(`匹配表达式的复杂度超过 ${MAX_LOG_PATTERN_PROGRAM_SIZE} 条指令上限。`);
        if (totalSize + size > MAX_LOG_PATTERN_TOTAL_SIZE) throw new LogPatternError(`所有匹配规则的复杂度合计超过 ${MAX_LOG_PATTERN_TOTAL_SIZE} 条指令上限。`);
        totalSize += size;
        programs.set(key, compiled);
      }
      return wrapLogPattern(compiled, maxInputLength);
    }
  };
}

/**
 * Untrusted patterns use RE2 only, with no native RegExp fallback. Supports i/m/s;
 * lookaround and backreferences are rejected by the engine (LOOKBEHINDS stays off).
 * Limits count UTF-16 code units. Over-long inputs yield no match, rather than
 * truncating and inventing end-of-line matches; callers retain the original text.
 */
export function compileLogPattern(pattern: string, flags = "", maxInputLength = MAX_LOG_PATTERN_INPUT_LENGTH, cache?: LogPatternCache): LogPattern {
  return (cache ?? createLogPatternCache()).compile(pattern, flags, maxInputLength);
}

function logPatternFlags(flags: string): number {
  let engineFlags = 0;
  const supportedFlags: Record<string, number> = {
    i: RE2JS.CASE_INSENSITIVE,
    m: RE2JS.MULTILINE,
    s: RE2JS.DOTALL
  };
  const seen = new Set<string>();
  for (const flag of flags) {
    if (!Object.hasOwn(supportedFlags, flag) || seen.has(flag)) {
      throw new LogPatternError(`正则表达式标记不受支持或重复：${flag}`);
    }
    seen.add(flag);
    engineFlags |= supportedFlags[flag];
  }
  return engineFlags;
}

function wrapLogPattern(compiled: RE2JS, maxInputLength: number): LogPattern {
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
export function fileGlobPattern(glob: string): string {
  const source = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\*\*|\*|\?/g,
    (token) => token === "**/" ? "(?:.*/)?" : token === "**" ? ".*" : token === "*" ? "[^/]*" : "[^/]");
  return `^${source}$`;
}

export function compileFileGlob(glob: string, cache?: LogPatternCache): LogPattern {
  return compileLogPattern(fileGlobPattern(glob), "", MAX_LOG_PATTERN_INPUT_LENGTH, cache);
}
