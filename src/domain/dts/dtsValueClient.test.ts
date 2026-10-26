import { describe, expect, it } from "vitest";
import { classifyDtsValue, decodeDtsString, encodeDtsString, formatByteLiteral, formatStringList, parseBytesValue, parseStringListValues, validateDtsValue } from "./dtsValueClient";

describe("classifyDtsValue", () => {
  it("accepts expanded integer expressions at the structured value validation boundary", () => {
    expect(validateDtsValue("<(1U << (3))>","flags","u32-array")).toEqual({valid:true,valueType:"u32-array",normalizedValue:"<8>"});
    expect(validateDtsValue("/bits/ 64 <(1ULL << 63)>","flags","bytes")).toMatchObject({valid:true,normalizedValue:"/bits/ 64 <9223372036854775808>"});
    for(const raw of ["<(1 << 64)>","<(1 / 0)>","<(1 + unknown)>",`<${"(".repeat(65)}1${")".repeat(65)}>`])expect(validateDtsValue(raw,"flags").valid).toBe(false);
  });
  it("accepts native node-path cells while refusing relative or escaping paths",()=>{
    expect(validateDtsValue("<&{/soc/clock}>","clocks","phandle-list")).toMatchObject({valid:true,normalizedValue:"<&{/soc/clock}>"});
    for(const path of ["relative","/soc/../clock","/soc//clock"])expect(validateDtsValue(`<&{${path}}>`,"clocks","phandle-list").valid).toBe(false);
  });
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

  it("keeps every segment when strings and cells are mixed", () => {
    expect(classifyDtsValue('"a", <1>', "mixed")).toEqual({ valueType: "mixed", normalizedValue: '"a", <1>' });
    expect(classifyDtsValue('[00 ff]', "bytes")).toEqual({ valueType: "bytes", normalizedValue: "[00 ff]" });
    expect(classifyDtsValue('"a" junk', "invalid")).toEqual({ valueType: "mixed", normalizedValue: '"a" junk' });
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

  it.each([
    '<1 junk 2>', '<1 2', '<0xGG>', '<1+2>', '<1-2>', '<<1>>',
    '"a" junk', '"a",', '"a', '[0 ff]', '[00 fff]', '[00] trailing',
    '/bits/ 7 <1>', '/bits/ 8 <256>', '/bits/ 16 <-32769>', '<4294967296>',
    '/bits/ 64 <18446744073709551616>', '/bits/ 64 <-9223372036854775809>',
  ])("rejects incomplete or out-of-range input: %s", (raw) => {
    expect(validateDtsValue(raw, "value").valid).toBe(false);
  });

  it.each([
    '[00 ff]', '/bits/ 8 <255 (-128)>', '/bits/ 16 <65535 (-32768)>',
    '<4294967295 (-2147483648)>', '/bits/ 64 <18446744073709551615 (-9223372036854775808)>',
    '"a", <1>',
  ])("accepts exact supported boundaries: %s", (raw) => {
    expect(validateDtsValue(raw, "value").valid).toBe(true);
  });
});

describe("structured editor string and byte helpers", () => {
  it("round-trips decoded strings, duplicates, empty items, quotes, and backslashes", () => {
    const values = ['huawei,direct_charger', '', '', 'a"b', 'C:\\path\\file', '中文', 'line\nnext\tcell', '\u0000'];
    const raw = formatStringList(values);
    expect(validateDtsValue(raw, "strings", "string-list").valid).toBe(true);
    expect(parseStringListValues(raw)).toEqual(values);
    for (const value of values) expect(decodeDtsString(encodeDtsString(value))).toBe(value);
  });

  it("keeps untouched source escapes and layout while replacing only the changed item", () => {
    const raw = String.raw`"a\x22b", "C:\\path",` + '\n\t""';
    const values = parseStringListValues(raw);
    expect(values).toEqual(['a"b', 'C:\\path', '']);
    expect(formatStringList(values, raw)).toBe(raw);
    expect(formatStringList([values[0]!, 'new"path', ''], raw)).toBe(String.raw`"a\x22b", "new\"path",` + '\n\t""');
  });

  it("never extracts just the recognized string part from a mixed or invalid value", () => {
    expect(parseStringListValues('"a", <1>')).toEqual([]);
    expect(parseStringListValues('"a" trailing')).toEqual([]);
  });

  it("distinguishes byte literals from /bits/ cell arrays", () => {
    expect(parseBytesValue('[00 FF]')).toEqual({ kind: 'bytes', width: 8, bytes: ['00', 'FF'] });
    expect(parseBytesValue('/bits/ 16 <0x100 2>')).toEqual({ kind: 'cells', width: 16, bytes: ['0x100', '2'] });
    expect(formatByteLiteral(['00', 'FF'])).toBe('[00 FF]');
  });
});
