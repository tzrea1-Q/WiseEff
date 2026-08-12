import { describe, expect, it } from "vitest";

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
    expect(result.issues.join(" ")).toMatch(/unrecognized/i);
  });

  it("requires startPattern for start-pattern multiline mode", () => {
    const result = validateLogFormatProfile({ multiline: { mode: "start-pattern" } });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.join(" ")).toMatch(/startPattern/);
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
