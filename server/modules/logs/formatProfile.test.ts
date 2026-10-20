import { describe, expect, it } from "vitest";

import { MAX_LOG_PATTERN_LENGTH } from "./adminPattern";
import { readStoredLogFormatProfile, validateLogFormatProfile } from "./formatProfile";

describe("validateLogFormatProfile", () => {
  it("accepts a full valid profile", () => {
    const result = validateLogFormatProfile({
      timestampPattern: "^\\[(\\d+\\.\\d+)\\]",
      multiline: { mode: "start-pattern", startPattern: "^\\[" },
      severityMap: { error: ["<3>"], warn: ["<4>"], info: ["<6>"] }
    });

    expect(result.ok).toBe(true);
  });

  it("accepts an empty profile object", () => {
    expect(validateLogFormatProfile({}).ok).toBe(true);
  });

  it("rejects unknown keys with readable issues", () => {
    const result = validateLogFormatProfile({ timestampRegex: "^x" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/不支持的字段/);
  });

  it("requires startPattern for start-pattern multiline mode", () => {
    const result = validateLogFormatProfile({ multiline: { mode: "start-pattern" } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/起始行匹配规则/);
  });

  it("rejects uncompilable regular expressions", () => {
    const result = validateLogFormatProfile({ timestampPattern: "([" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/timestampPattern/);
  });

  it("rejects non-object payloads", () => {
    expect(validateLogFormatProfile("not an object").ok).toBe(false);
    expect(validateLogFormatProfile(42).ok).toBe(false);
  });

  it("rejects unsupported syntax and oversized patterns with exact field paths", () => {
    const result = validateLogFormatProfile({
      timestampPattern: "(?<=prefix)time",
      multiline: { mode: "start-pattern", startPattern: "(a)\\1" },
      severityMap: { error: ["valid", "(?=ERROR)", "a".repeat(MAX_LOG_PATTERN_LENGTH + 1)] }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.split(" 正则表达式无效：")[0])).toEqual([
      "timestampPattern", "multiline.startPattern", "severityMap.error[1]", "severityMap.error[2]"
    ]);
    expect(readStoredLogFormatProfile({ timestampPattern: "(?=time)" })).toBeUndefined();
  });
});

describe("readStoredLogFormatProfile", () => {
  it("returns undefined for null and invalid stored values", () => {
    expect(readStoredLogFormatProfile(null)).toBeUndefined();
    expect(readStoredLogFormatProfile({ timestampPattern: "([" })).toBeUndefined();
  });

  it("returns the profile for valid stored values", () => {
    expect(readStoredLogFormatProfile({ timestampPattern: "^\\d+" })).toEqual({ timestampPattern: "^\\d+" });
  });
});
