import { execFileSync } from "node:child_process";
import { RE2JS } from "re2js";
import { describe, expect, it, vi } from "vitest";

import {
  compileLogPattern,
  createLogPatternCache,
  logPatternProgramCost,
  LogPatternError,
  MAX_LOG_PATTERN_TOTAL_SIZE,
  MAX_LOG_PATTERN_PROGRAM_SIZE,
  MAX_LOG_PATTERN_INPUT_LENGTH,
  MAX_LOG_PATTERN_LENGTH
} from "./adminPattern";

describe("compileLogPattern", () => {
  it("rejects counted expansion before compilation, including nested programs", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      for (const pattern of [`(?:${"a".repeat(1000)}){1000}`, `(?:${"a".repeat(1000)}){100}`, `(?:(?:${"a".repeat(10)}){100}){100}`, `(?:a{${"0".repeat(1000)}}){100}`, `(?:${"a".repeat(1000)})+(?i){100}`]) {
        expect(() => compileLogPattern(pattern)).toThrow(LogPatternError);
      }
      expect(compile).not.toHaveBeenCalled();
    } finally { compile.mockRestore(); }
  });

  it("rejects the reported pattern in a bounded-memory process", () => {
    const script = `
      import assert from "node:assert/strict";
      import { compileLogPattern, LogPatternError } from "./server/modules/logs/adminPattern.ts";
      const started = performance.now();
      for (let i = 0; i < 96; i++) assert.throws(() => compileLogPattern("(?:" + "a".repeat(1000) + "){1000}"), LogPatternError);
      assert.ok(performance.now() - started < 1000);
      console.log("rejected");
    `;
    expect(execFileSync(process.execPath, ["--max-old-space-size=256", "--import", "tsx", "--input-type=module", "--eval", script], {
      encoding: "utf8", timeout: 10_000
    }).trim()).toBe("rejected");
  });

  it("also enforces the engine's actual program size", () => {
    const size = vi.spyOn(RE2JS.prototype, "programSize").mockReturnValue(MAX_LOG_PATTERN_PROGRAM_SIZE + 1);
    try { expect(() => compileLogPattern("a")).toThrow(`Pattern program exceeds ${MAX_LOG_PATTERN_PROGRAM_SIZE}`); }
    finally { size.mockRestore(); }
  });

  it("charges Unicode property source work even when the resulting program is small", () => {
    const characterClass = `[${String.raw`\p{L}`.repeat(800)}]`;
    const patterns = Array.from({ length: 96 }, (_, index) => `${index}${characterClass}`);
    expect(logPatternProgramCost(characterClass)).toBeGreaterThanOrEqual(characterClass.length);
    expect(logPatternProgramCost(`${characterClass}{0}`)).toBeGreaterThanOrEqual(characterClass.length + 3);
    expect(logPatternProgramCost(String.raw`\p{L}`)).toBeGreaterThanOrEqual(5);
    expect(patterns.reduce((total, pattern) => total + logPatternProgramCost(pattern), 0)).toBeGreaterThan(MAX_LOG_PATTERN_TOTAL_SIZE);
    const program = RE2JS.compile("a");
    const compile = vi.spyOn(RE2JS, "compile").mockReturnValue(program);
    try {
      const cache = createLogPatternCache();
      for (const pattern of patterns.slice(0, 16)) cache.compile(pattern);
      expect(() => cache.compile(patterns[16])).toThrow(`Total pattern program exceeds ${MAX_LOG_PATTERN_TOTAL_SIZE}`);
      expect(compile).toHaveBeenCalledTimes(16);
    } finally { compile.mockRestore(); }
  });

  it.each([
    "",
    String.raw`^(?:(?:a|)){2}$`,
    String.raw`^(?:a?)*$`,
    String.raw`^(?:a?){0,}$`,
    String.raw`^\Q{1000}(literal)[a]\E$`,
    String.raw`^[{}0-9]{1,100}$`,
    String.raw`^[[:alpha:]{}]{1,100}$`,
    String.raw`^\p{L}{1,100}$`,
    String.raw`^[\p{L}\p{N}]+$`,
    String.raw`^\x{61}{1,100}$`,
    String.raw`^(?i:abc){1,100}$`,
    String.raw`^(?P<value>a+)+$`,
    String.raw`^(?:a|b){1,100}$`,
    String.raw`^(?:abcdefghij)+?(?i){10}$`,
    String.raw`^(?:a{00}|b{1,00}){100}$`
  ])("bounds valid escapes, classes and groups without interpreting literals as repeats: %s", (pattern) => {
    expect(logPatternProgramCost(pattern)).toBeGreaterThanOrEqual(RE2JS.compile(pattern).programSize());
    expect(() => compileLogPattern(pattern)).not.toThrow();
  });

  it("reuses the underlying program across input bounds and equivalent flags, enforcing one total budget", () => {
    const compile = vi.spyOn(RE2JS, "compile");
    try {
      const cache = createLogPatternCache();
      expect(cache.compile("a", "im", 1).test("aa")).toBe(false);
      expect(cache.compile("a", "mi", 2).test("aa")).toBe(true);
      expect(compile).toHaveBeenCalledTimes(1);
      const source = `(?:${"a".repeat(100)}){100}`;
      let accepted = 0;
      for (; accepted < 100; accepted++) {
        try { cache.compile(`${source}${accepted}`); }
        catch (error) {
          expect(error).toBeInstanceOf(LogPatternError);
          expect(String(error)).toContain(`Total pattern program exceeds ${MAX_LOG_PATTERN_TOTAL_SIZE}`);
          break;
        }
      }
      expect(accepted).toBe(6);
      expect(compile).toHaveBeenCalledTimes(7);
    } finally { compile.mockRestore(); }
  });
  it("iterates a bounded input with stable offsets and capture groups", () => {
    const pattern = compileLogPattern("(?<id>[0-9]+)", "", 20);
    const matches = [...pattern.matchAll("😀 12 and 34")];
    expect(matches.map((match) => [match.index, match[0], match.groups])).toEqual([[3, "12", { id: "12" }], [10, "34", { id: "34" }]]);
    const spans = [...pattern.matchAll("😀 12 and 34", false)];
    expect(spans.map((match) => [match.index, [...match], match.groups])).toEqual([[3, ["12"], undefined], [10, ["34"], undefined]]);
    expect([...pattern.matchAll("1".repeat(21))]).toEqual([]);
    expect([...compileLogPattern("").matchAll("a")]).toHaveLength(2);
  });
  it("exposes capture metadata and supports the explicit bounded assembly input size", () => {
    const pattern = compileLogPattern("(?P<field>a)(b)?", "", 100_000);
    expect(pattern.groupNames).toEqual(["field"]);
    expect(pattern.groupCount).toBe(2);
    expect(pattern.test("a".repeat(70_000))).toBe(true);
    expect(pattern.test("a".repeat(100_001))).toBe(false);
  });
  it("executes pathological nested repetition on a 50k line well under one second", () => {
    const input = `${"a".repeat(50_000)}b`;
    const started = performance.now();
    const pattern = compileLogPattern("(a+)+$");
    expect(pattern.test(input)).toBe(false);
    expect(pattern.exec(input)).toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("preserves unanchored search, named/optional groups and UTF-16 match offsets", () => {
    const pattern = compileLogPattern("(?<level>error)(: (?<detail>\\w+))?", "i");
    expect(pattern.test("prefix ERROR suffix")).toBe(true);
    const match = pattern.exec("😀 ERROR: failed");
    expect(match?.index).toBe(3);
    expect(match?.[0]).toBe("ERROR: failed");
    expect(match?.[1]).toBe("ERROR");
    expect(match?.groups).toEqual({ level: "ERROR", detail: "failed" });
    expect(pattern.exec("error")?.groups?.detail).toBeUndefined();
    expect(pattern.exec("error")?.input).toBe("error");
    expect(pattern.test("unrelated")).toBe(false);
  });

  it.each(["(?=a)a", "(?!a)b", "(?<=a)b", "(?<!a)b", "(a)\\1", "(?<a>x)\\k<a>", "["])(
    "rejects unsupported/invalid syntax with a typed error: %s",
    (pattern) => expect(() => compileLogPattern(pattern)).toThrow(LogPatternError)
  );

  it("supports multiline/dotall and rejects unsupported or duplicate flags", () => {
    expect(compileLogPattern("^a.b$", "ims").test("prefix\nA\nB\nsuffix")).toBe(true);
    for (const flags of ["g", "y", "u", "ii"]) {
      expect(() => compileLogPattern("a", flags)).toThrow(LogPatternError);
    }
  });

  it("caps pattern length before compilation", () => {
    expect(() => compileLogPattern("a".repeat(MAX_LOG_PATTERN_LENGTH))).not.toThrow();
    expect(() => compileLogPattern("a".repeat(MAX_LOG_PATTERN_LENGTH + 1))).toThrow(
      `Pattern exceeds ${MAX_LOG_PATTERN_LENGTH}`
    );
  });

  it("skips over-long inputs without truncating or making artificial end matches", () => {
    const pattern = compileLogPattern("a$");
    const atLimit = "a".repeat(MAX_LOG_PATTERN_INPUT_LENGTH);
    expect(pattern.test(atLimit)).toBe(true);
    expect(pattern.exec(atLimit)?.index).toBe(atLimit.length - 1);
    for (const input of [`${atLimit}a`, `${atLimit}b`]) {
      expect(pattern.test(input)).toBe(false);
      expect(pattern.exec(input)).toBeNull();
    }
  });
});
