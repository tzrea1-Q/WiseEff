import { describe, expect, it } from "vitest";
import { classifyDtsValue, validateDtsValue } from "./dtsValueClient";

describe("classifyDtsValue", () => {
  it("normalizes hex case and whitespace for u32-array", () => {
    const a = classifyDtsValue("<0xB 0x4b>", "reg");
    const b = classifyDtsValue("<0xb 0x4B>", "reg");
    expect(a.valueType).toBe("u32-array");
    expect(b.valueType).toBe("u32-array");
    expect(a.normalizedValue).toBe(b.normalizedValue);
    expect(a.normalizedValue).toBe("<0xb 0x4b>");
  });

  it("flattens multi-group cells to the same normalizedValue as mixed", () => {
    const grouped = classifyDtsValue("<1 2>,<3 4>", "combined");
    const flat = classifyDtsValue("<1 2 3 4>", "combined");
    expect(grouped.valueType).toBe("mixed");
    expect(flat.valueType).toBe("u32-array");
    expect(grouped.normalizedValue).toBe("<1 2 3 4>");
    expect(flat.normalizedValue).toBe("<1 2 3 4>");
  });

  it("classifies string-list, phandle-list, bytes, bool, and empty", () => {
    expect(classifyDtsValue('"a", "b"', "string_array")).toEqual({
      valueType: "string-list",
      normalizedValue: '"a", "b"',
    });
    expect(classifyDtsValue("<&a &b>", "matchable")).toEqual({
      valueType: "phandle-list",
      normalizedValue: "<&a &b>",
    });
    expect(classifyDtsValue("/bits/ 8 <0x19 0x01>", "reg_config")).toMatchObject({
      valueType: "bytes",
      normalizedValue: "/bits/ 8 <0x19 0x01>",
    });
    expect(classifyDtsValue("/bits/ 8 <0xAB 0xcd>", "x")).toMatchObject({
      valueType: "bytes",
      normalizedValue: "/bits/ 8 <0xab 0xcd>",
    });
    expect(classifyDtsValue("", "weak_source_sleep_enabled")).toEqual({
      valueType: "bool",
      normalizedValue: "true",
    });
    expect(classifyDtsValue("", "ranges")).toEqual({
      valueType: "empty",
      normalizedValue: "empty",
    });
  });

  it("classifies cell+ref and multi-group as mixed", () => {
    expect(classifyDtsValue("<&gpio 29 0>", "gpio_int").valueType).toBe("mixed");
    expect(classifyDtsValue("<1 2>,<3 4>", "combined_para").valueType).toBe("mixed");
  });

  it("does not normalize ok vs okay in string-list", () => {
    const ok = classifyDtsValue('"ok"', "status");
    const okay = classifyDtsValue('"okay"', "status");
    expect(ok.normalizedValue).not.toBe(okay.normalizedValue);
  });
});

describe("validateDtsValue", () => {
  it("accepts well-formed values for the declared type", () => {
    expect(validateDtsValue("<0xb 0x4b>", "reg", "u32-array")).toMatchObject({
      valid: true,
      valueType: "u32-array",
      normalizedValue: "<0xb 0x4b>",
    });
    expect(validateDtsValue("/bits/ 8 <0xab 0xcd>", "x", "bytes")).toMatchObject({
      valid: true,
      valueType: "bytes",
      normalizedValue: "/bits/ 8 <0xab 0xcd>",
    });
    expect(validateDtsValue('"a", "b"', "string_array", "string-list")).toMatchObject({
      valid: true,
      valueType: "string-list",
    });
    expect(validateDtsValue("<&a &b>", "matchable", "phandle-list")).toMatchObject({
      valid: true,
      valueType: "phandle-list",
    });
    expect(validateDtsValue("", "flag", "bool")).toMatchObject({
      valid: true,
      valueType: "bool",
      normalizedValue: "true",
    });
    expect(validateDtsValue("", "ranges", "empty")).toMatchObject({
      valid: true,
      valueType: "empty",
      normalizedValue: "empty",
    });
    expect(validateDtsValue("<&gpio 29 0>", "gpio_int", "mixed")).toMatchObject({
      valid: true,
      valueType: "mixed",
    });
  });

  it("rejects illegal cell tokens and malformed bytes syntax", () => {
    const badHex = validateDtsValue("<0xGG>", "reg", "u32-array");
    expect(badHex.valid).toBe(false);
    expect(badHex.error).toBeTruthy();

    const badBits = validateDtsValue("/bits/ 8 <0xZZ>", "x", "bytes");
    expect(badBits.valid).toBe(false);
    expect(badBits.error).toBeTruthy();

    const emptyU32 = validateDtsValue("<>", "reg", "u32-array");
    expect(emptyU32.valid).toBe(false);
  });

  it("rejects type mismatches against the declared valueType", () => {
    const mismatch = validateDtsValue('"okay"', "status", "u32-array");
    expect(mismatch.valid).toBe(false);
    expect(mismatch.error).toBeTruthy();
  });
});
