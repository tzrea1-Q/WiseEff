import { describe, expect, it } from "vitest";
import { classifyDtsValue } from "./valueTyping";
import { parseDts } from "./parser";

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
    // Grouped multi-<> is mixed; compare flat cell sequence equivalence for mixed flatten:
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

  it("wires classification into parseDts property nodes", () => {
    const doc = parseDts(`&n {
	hex = <0xB 0x4B>;
	groups = <1 2>,<3 4>;
	list = "a", "b";
	refs = <&a &b>;
	bytes = /bits/ 8 <0x19>;
	flag;
	ranges;
};`);
    const props = Object.fromEntries(
      doc.topLevel[0].children.filter((c) => c.kind === "property").map((p) => [p.name, p]),
    );
    expect(props.hex.valueType).toBe("u32-array");
    expect(props.hex.normalizedValue).toBe("<0xb 0x4b>");
    expect(props.groups.valueType).toBe("mixed");
    expect(props.groups.normalizedValue).toBe("<1 2 3 4>");
    expect(props.list.valueType).toBe("string-list");
    expect(props.refs.valueType).toBe("phandle-list");
    expect(props.bytes.valueType).toBe("bytes");
    expect(props.flag).toMatchObject({ valueType: "bool", normalizedValue: "true" });
    expect(props.ranges).toMatchObject({ valueType: "empty", normalizedValue: "empty" });
  });
});
