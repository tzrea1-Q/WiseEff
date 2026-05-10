import { describe, expect, it } from "vitest";
import { parseRange, validateKey, validateRange } from "./validation";

describe("validateKey", () => {
  it("空字符串返回 error", () => {
    const result = validateKey("", []);
    expect(result.level).toBe("error");
    expect(result.message).toContain("不能为空");
  });

  it("只包含空白字符返回 error", () => {
    const result = validateKey("   ", []);
    expect(result.level).toBe("error");
  });

  it("与 existingKeys 中某一项完全相同时返回 error", () => {
    const result = validateKey("debug.fast_charge", ["debug.fast_charge", "debug.other"]);
    expect(result.level).toBe("error");
    expect(result.message).toContain("已被使用");
  });

  it("包含空格时返回 warning", () => {
    const result = validateKey("debug fast charge", []);
    expect(result.level).toBe("warning");
    expect(result.message).toContain("snake_case");
  });

  it("包含大写字母时返回 warning", () => {
    const result = validateKey("debug.fastCharge", []);
    expect(result.level).toBe("warning");
  });

  it("合法 snake_case / dot notation 返回 null", () => {
    expect(validateKey("debug.fast_charge_current", [])).toEqual({ level: null, message: null });
    expect(validateKey("simple_key", [])).toEqual({ level: null, message: null });
  });

  it("existingKeys 中包含自己的 key 时不视为重复（通过 selfKey 参数）", () => {
    const result = validateKey("debug.fast_charge", ["debug.fast_charge"], "debug.fast_charge");
    expect(result.level).toBe(null);
  });
});

describe("parseRange", () => {
  it("解析 '1500 - 4500' 得到 min=1500, max=4500", () => {
    expect(parseRange("1500 - 4500")).toEqual({ min: 1500, max: 4500 });
  });

  it("解析带小数的 '0.1 - 2.0'", () => {
    expect(parseRange("0.1 - 2.0")).toEqual({ min: 0.1, max: 2.0 });
  });

  it("解析负数 '-10 - 10'", () => {
    expect(parseRange("-10 - 10")).toEqual({ min: -10, max: 10 });
  });

  it("解析不带空格 '100-200'", () => {
    expect(parseRange("100-200")).toEqual({ min: 100, max: 200 });
  });

  it("解析 en dash '1500 – 4500'（Unicode \\u2013）", () => {
    expect(parseRange("1500 \u2013 4500")).toEqual({ min: 1500, max: 4500 });
  });

  it("格式不合法返回 null", () => {
    expect(parseRange("")).toBeNull();
    expect(parseRange("abc")).toBeNull();
    expect(parseRange("1500")).toBeNull();
    expect(parseRange("1500 ~ 4500")).toBeNull();
  });
});

describe("validateRange", () => {
  it("value 在区间内返回 null", () => {
    expect(validateRange("3200", "1500 - 4500")).toEqual({ level: null, message: null });
  });

  it("value 低于 min 返回 warning", () => {
    const result = validateRange("1000", "1500 - 4500");
    expect(result.level).toBe("warning");
    expect(result.message).toContain("超出");
  });

  it("value 高于 max 返回 warning", () => {
    const result = validateRange("5000", "1500 - 4500");
    expect(result.level).toBe("warning");
  });

  it("value 非数字返回 null（放弃校验，不报错）", () => {
    expect(validateRange("abc", "1500 - 4500")).toEqual({ level: null, message: null });
  });

  it("range 格式不合法时返回 null（放弃校验）", () => {
    expect(validateRange("3200", "invalid range")).toEqual({ level: null, message: null });
  });

  it("空值返回 null", () => {
    expect(validateRange("", "1500 - 4500")).toEqual({ level: null, message: null });
  });
});
