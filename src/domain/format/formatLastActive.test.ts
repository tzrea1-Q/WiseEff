import { describe, expect, it } from "vitest";
import { formatLastActive } from "./formatLastActive";

describe("formatLastActive", () => {
  it("routes ISO timestamps through the shared datetime formatter", () => {
    expect(formatLastActive(new Date(Date.now() - 30_000).toISOString())).toBe("刚刚");
    expect(formatLastActive("2020-01-05T12:52:49.398Z")).toMatch(/^2020-01-05 \d{2}:\d{2}$/);
  });

  it("maps legacy English relative strings to product Chinese", () => {
    expect(formatLastActive("never")).toBe("从未");
    expect(formatLastActive("just now")).toBe("刚刚");
    expect(formatLastActive("2h ago")).toBe("2 小时前");
    expect(formatLastActive("3d ago")).toBe("3 天前");
    expect(formatLastActive("15m ago")).toBe("15 分钟前");
    expect(formatLastActive("yesterday")).toBe("昨天");
    expect(formatLastActive("today 09:12")).toBe("今天 09:12");
    expect(formatLastActive("disabled")).toBe("已停用");
  });

  it("keeps Chinese and unknown strings unchanged", () => {
    expect(formatLastActive("刚刚")).toBe("刚刚");
    expect(formatLastActive("some unknown value")).toBe("some unknown value");
    expect(formatLastActive("")).toBe("");
  });
});
