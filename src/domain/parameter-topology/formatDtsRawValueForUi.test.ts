import { describe, expect, it } from "vitest";

import { formatDtsRawValueForUi, formatDtsValueForUi, isDtsEmptyValueAllowed } from "./formatDtsRawValueForUi";

describe("formatDtsRawValueForUi", () => {
  it("distinguishes present boolean, explicit empty, deleted and unknown values without inventing raw text", () => {
    expect(formatDtsValueForUi("", { kind: "boolean", present: true })).toBe("属性存在");
    expect(formatDtsValueForUi("", { kind: "empty" })).toBe("空属性");
    expect(formatDtsValueForUi("", { kind: "boolean", present: true }, "deleted")).toBe("已删除");
    expect(formatDtsValueForUi(null)).toBe("未知");
    expect(formatDtsValueForUi("\"\"", { kind: "strings", values: [""] })).toBe("\"\"");
    expect(isDtsEmptyValueAllowed({ kind: "boolean", present: true })).toBe(true);
    expect(isDtsEmptyValueAllowed({ kind: "empty" })).toBe(true);
    expect(isDtsEmptyValueAllowed({ kind: "strings", values: [""] })).toBe(false);
    expect(isDtsEmptyValueAllowed(undefined)).toBe(false);
  });
  it("strips board-file continuation indent from multi-line string-list raw values", () => {
    expect(
      formatDtsRawValueForUi("\"16\", \"3100\",\n\t\t\"0\", \"3200\",\n\t\t\"1\", \"3250\"")
    ).toBe("\"16\", \"3100\",\n\"0\", \"3200\",\n\"1\", \"3250\"");
  });

  it("preserves single-line scalars", () => {
    expect(formatDtsRawValueForUi("<5000>")).toBe("<5000>");
  });

  it("dedents angled multi-line cell arrays without dropping tokens", () => {
    expect(formatDtsRawValueForUi("<\n\t\t1800 1250\n\t\t0 2500\n\t\t>")).toBe(
      "<\n1800 1250\n0 2500\n>"
    );
  });

  it("returns empty string for nullish input", () => {
    expect(formatDtsRawValueForUi(null)).toBe("");
    expect(formatDtsRawValueForUi(undefined)).toBe("");
  });
});
