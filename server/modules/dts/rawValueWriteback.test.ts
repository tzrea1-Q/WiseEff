import { describe, expect, it } from "vitest";

import { indentDtsRawValueForWriteback } from "./rawValueWriteback";

describe("indentDtsRawValueForWriteback", () => {
  it("restores continuation indent from the original CST span", () => {
    const source = [
      "&battery_ocv {",
      "\tocv_table =",
      '\t\t"16", "3100",',
      '\t\t"0", "3200",',
      '\t\t"1", "3250";',
      "};"
    ].join("\n");
    const originalSpan = '"16", "3100",\n\t\t"0", "3200",\n\t\t"1", "3250"';
    const spanStart = source.indexOf('"16"');
    const uiValue = '"16", "3100",\n"0", "3200",\n"1", "3250"';

    expect(indentDtsRawValueForWriteback(uiValue, source, spanStart, originalSpan)).toBe(
      '"16", "3100",\n\t\t"0", "3200",\n\t\t"1", "3250"'
    );
  });

  it("leaves single-line values unchanged aside from trailing trim", () => {
    expect(indentDtsRawValueForWriteback("<5000>  ", "x = <5000>;", 4, "<5000>")).toBe("<5000>");
  });

  it("falls back to first-line prefix indent when original span had no continuations", () => {
    const source = "\tdemo {\n\t\tmatrix = <1 2\n3 4>;\n\t};";
    // Simulate a span that was originally single-line-ish without inner indent cues:
    // value starts after "matrix = " with tabs on the property line context.
    const source2 = "\tmatrix = <1 2 3 4>;";
    const spanStart = source2.indexOf("<");
    const next = indentDtsRawValueForWriteback("<1 2\n3 4>", source2, spanStart, "<1 2 3 4>");
    expect(next).toBe("<1 2\n\t3 4>");
  });
});
