import { describe, expect, it } from "vitest";

import { dtsExampleIssue, dtsExampleToJson, parseDtsExample } from "./dtsExamples";

describe("DTS example conversion", () => {
  it("uses the same decoded strings, numeric cells and presence flags as JSON examples", () => {
    const convert = (source: string, type: string, grouped = false) => {
      const parsed = parseDtsExample(source, "sample");
      if (typeof parsed === "string") throw new Error(parsed);
      return dtsExampleToJson(parsed, type, grouped);
    };
    expect(convert('sample = "a\\n//b"; /* end */', "string")).toBe("a\n//b");
    expect(convert("<0xff>", "integer")).toBe(255);
    expect(convert("<0x1 2>, /* group */ <3 4>", "u32-array")).toEqual([1, 2, 3, 4]);
    expect(convert("<0x1 2>, /* group */ <3 4>", "array", true)).toEqual([[1, 2], [3, 4]]);
    expect(convert("<&foo 0>", "phandle-list")).toEqual(["&foo", 0]);
    expect(convert("[00 ff]", "bytes")).toBe("[00 ff]");
    expect(convert("sample;", "boolean")).toBe(true);
    expect(convert("sample;", "empty")).toBeNull();
  });

  it("requires full statements, validates typed values and admits mixed or byte-like source syntax", () => {
    expect(dtsExampleIssue("sample = <1>", "sample")).toBe("invalid-dts-example");
    expect(dtsExampleIssue("<1> /*/", "sample")).toBe("invalid-dts-example");
    expect(dtsExampleIssue("sample; sample;", "sample")).toBe("invalid-dts-example");
    expect(dtsExampleIssue("other;", "sample")).toBe("dts-example-property-mismatch");
    expect(dtsExampleIssue("<0x8>", "sample", { type: "integer", maximum: 7 })).toBe("dts-example-does-not-match-schema");
    expect(dtsExampleIssue('"label", <1>', "sample", { type: "string" })).toBe("dts-example-does-not-match-schema");
    expect(dtsExampleIssue('/bits/ 64 <0xffffffffffffffff>, "label"', "sample", { description: "mixed example" })).toBeUndefined();
    expect(dtsExampleIssue("[00 ff]", "sample", { type: "string" })).toBeUndefined();
  });
});
