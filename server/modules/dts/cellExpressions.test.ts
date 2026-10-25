import { describe, expect, it } from "vitest";
import { parseDts } from "./parser";
import { parseDtsValue, renderDtsValue } from "./valueAst";

describe("native DTS integer expressions", () => {
  it("resolves a BIT-style expansion without losing original text or spans", () => {
    const raw = "<(1U << (3))>", source = `/dts-v1/;\n/ { flags = ${raw}; status = "okay"; };`;
    const parsed = parseDtsValue("flags", raw);
    expect(parsed.value).toEqual({ kind: "cells", bits: 32, groups: [[{ kind: "integer", raw: "(1U << (3))", value: "8" }]] });
    expect(parsed.rawText).toBe(raw);
    expect(renderDtsValue(parsed.value, raw)).toBe(raw);
    const document = parseDts(source), property = document.topLevel[0]!.children[0]!;
    expect(property.kind).toBe("property");
    if (property.kind !== "property") throw new Error("expected property");
    expect(property.value).toEqual(parsed.value);
    expect(source.slice(property.span.start, property.span.end)).toBe(raw);
    expect(document.topLevel[0]!.children).toHaveLength(2);
  });

  it.each([
    ["(2 + 3 * 4)", "14"], ["((2 + 3) * 4)", "20"], ["(20 / 3 % 4)", "2"],
    ["((1U << 5) | 3)", "35"], ["((0xf & 6) ^ 3)", "5"], ["(32 >> 2)", "8"],
    ["(1 < 2)", "1"], ["(1 <= 1)", "1"], ["(2 > 3)", "0"], ["(2 >= 3)", "0"],
    ["(3 == 3)", "1"], ["(3 != 3)", "0"], ["(!0 || 0)", "1"], ["(2 && 3)", "1"],
    ["(7 - 2)", "5"], ["(~0U)", "-1"], ["((0xffffffffffffffffULL + 2) >> 1)", "0"],
    ["(077 + 1)", "64"], ["(0xffffffffUL)", "4294967295"],
  ])("evaluates native integer arithmetic %s", (expression, expected) => {
    const raw = `<${expression}>`, value = parseDtsValue("flags", raw).value;
    expect(value).toMatchObject({ kind: "cells", groups: [[{ kind: "integer", value: expected }]] });
    expect(renderDtsValue(value, raw)).toBe(raw);
  });

  it("retains full 64-bit precision and individual expression cells in mixed groups", () => {
    const raw = '/bits/ 64 <(1ULL << 63) 9007199254740993>, /bits/ 64 <(0xffffffffffffffffULL)>', value = parseDtsValue("flags", raw).value;
    expect(value).toMatchObject({ kind: "cells", bits: 64, groups: [
      [{ value: "9223372036854775808" }, { value: "9007199254740993" }], [{ value: "18446744073709551615" }],
    ] });
    expect(renderDtsValue(value, raw)).toBe(raw);
    const source = `/ { flags = ${raw}; enabled; };`, document = parseDts(source);
    expect(document.topLevel[0]!.children).toHaveLength(2);
  });

  it("preserves comments within unchanged expressions while replacing another cell", () => {
    const raw = '<(1U /* 保留 > < , */ << 3) 7>', value = parseDtsValue("flags", raw).value;
    expect(renderDtsValue(value, raw)).toBe(raw);
    if (value.kind !== "cells") throw new Error("expected cells");
    value.groups[0]![1] = { kind: "integer", raw: "9", value: "9" };
    expect(renderDtsValue(value, raw)).toBe('<(1U /* 保留 > < , */ << 3) 9>');
  });

  it("keeps original macro invocations available to the preprocessing provenance owner", () => {
    const raw = '<BIT(1 + 2) PICK(1 ? 2 : 3)>', source = `/ { flags = ${raw}; status = "okay"; };`;
    const document = parseDts(source), property = document.topLevel[0]!.children[0]!;
    expect(property).toMatchObject({ kind: "property", rawText: raw });
    expect(document.topLevel[0]!.children).toHaveLength(2);
    expect(() => parseDtsValue("flags", raw)).toThrow();
  });

  it.each([
    "<(1 / 0)>", "<(1 % 0)>", "<(1 << 64)>", "<(1 >> (-1))>", "<(1 + unknown)>",
    "<(1 ? 2 : 3)>", "<(1, 2)>", "<(1 +)>", "<(1 2)>", "<(1 + 0x100000000)>", "<(+1)>",
    "<(0x10000000000000000ULL)>", "<1UU>", "<1LLL>", "<(09 + 1)>",
    `<${"(".repeat(65)}1${")".repeat(65)}>`, `<(${"1+".repeat(1024)}1)>`,
  ])("rejects unsupported, invalid or excessive expressions explicitly: %s", raw => {
    expect(() => parseDtsValue("flags", raw)).toThrow();
  });
});
