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
        "3200"
      )
    ).toBe("输入毫安值，例如 3200。");
  });

  it("builds a device-oriented default hint without exposing the transport", () => {
    expect(resolveWriteFormatHint({}, "3200")).toBe(
      "例如输入 3200，系统会将该值写入当前设备节点。"
    );
  });
});
