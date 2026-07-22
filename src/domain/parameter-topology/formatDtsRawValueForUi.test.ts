import { describe, expect, it } from "vitest";

import { formatDtsRawValueForUi } from "./formatDtsRawValueForUi";

describe("formatDtsRawValueForUi", () => {
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
