import { describe, expect, it } from "vitest";

import {
  compileLogPattern,
  LogPatternError,
  MAX_LOG_PATTERN_INPUT_LENGTH,
  MAX_LOG_PATTERN_LENGTH
} from "./adminPattern";

describe("compileLogPattern", () => {
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
