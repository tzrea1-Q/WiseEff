import { describe, expect, it } from "vitest";
import { resolveWriteFormatExample, resolveWriteFormatHint } from "./writeFormat";

describe("writeFormat", () => {
  it("prefers configured example over target and current values", () => {
    expect(
      resolveWriteFormatExample({
        writeFormatExample: "3200",
        targetValue: "3600",
        currentValue: "3000"
      })
    ).toBe("3200");
  });

  it("falls back to target then current then default", () => {
    expect(resolveWriteFormatExample({ targetValue: "3600", currentValue: "3000" })).toBe("3600");
    expect(resolveWriteFormatExample({ currentValue: "3000" })).toBe("3000");
    expect(resolveWriteFormatExample({})).toBe("value");
  });

  it("uses configured hint when provided", () => {
    expect(
      resolveWriteFormatHint(
        { writeFormatHint: "输入毫安值，例如 3200。" },
        "3200",
        "hdc"
      )
    ).toBe("输入毫安值，例如 3200。");
  });

  it("builds default hint from example and protocol", () => {
    expect(resolveWriteFormatHint({}, "3200", "hdc")).toBe(
      "例如输入 3200，系统会通过 HDC 将该值写入当前节点。"
    );
    expect(resolveWriteFormatHint({}, "3200", "adb")).toBe(
      "例如输入 3200，系统会通过 ADB 将该值写入当前节点。"
    );
  });
});
