import { describe, expect, it } from "vitest";
import { formatDtsValueSchema, validateDtsValueAgainstSchema as validate } from "./dtsValueSchema";

describe("pinned DTS value schema", () => {
  it("checks scalar cells and retains 64-bit precision", () => {
    expect(validate("current", "<7>", { type: "integer", maximum: 6 })).toContain("不能大于 6");
    expect(validate("counter", "/bits/ 64 <9007199254740993>", { type: "integer", maximum: 9007199254740992 })).toContain("不能大于");
  });
  it("checks flat and grouped arrays without flattening a declared nested shape", () => {
    const item = { type: "integer", minimum: 0, maximum: 10 };
    expect(validate("values", "<1 12>", { type: "array", items: item })).toContain("第 2 项不能大于 10");
    expect(validate("values", "<1 2>, <3>", { type: "array", items: { type: "array", minItems: 2, items: item } })).toContain("第 2 项至少需要 2 项");
    expect(validate("values", "<1 2>", { type: "array", minItems: 2, maxItems: 2, items: item })).toBeUndefined();
  });
  it("preserves string-list cardinality and handles boolean, bytes and absent constraints", () => {
    expect(validate("names", '"a", ""', { type: "array", maxItems: 1 })).toContain("当前 2 项");
    expect(validate("flag", "", { type: "boolean" })).toBeUndefined();
    expect(validate("ranges", "", { type: "null" })).toBeUndefined();
    expect(validate("bytes", "[00 ff]", { type: "array", items: { type: "integer", maximum: 10 } })).toContain("第 2 项不能大于 10");
    expect(validate("x", "<8>", undefined)).toBeUndefined();
    expect(validate("x", "<8>", { description: "No authored shape" })).toBeUndefined();
  });
  it("describes only authored bounds", () => {
    expect(formatDtsValueSchema({ type: "array", minItems: 2, maxItems: 2, items: { type: "integer", minimum: 1, maximum: 9 } })).toBe("固定 2 项；每项：最小 1；最大 9");
    expect(formatDtsValueSchema({ type: "integer" })).toBe("");
  });
});
