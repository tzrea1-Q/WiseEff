import { describe, expect, it } from "vitest";
import { formatAbsolute, formatRelativeOrAbsolute } from "./formatDateTime";

describe("formatRelativeOrAbsolute", () => {
  const now = new Date("2026-08-13T10:00:00");

  it("renders sub-minute timestamps as 刚刚", () => {
    expect(formatRelativeOrAbsolute("2026-08-13T09:59:30", now)).toBe("刚刚");
    expect(formatRelativeOrAbsolute("2026-08-13T10:00:00", now)).toBe("刚刚");
  });

  it("renders minutes within the hour", () => {
    expect(formatRelativeOrAbsolute("2026-08-13T09:57:00", now)).toBe("3 分钟前");
    expect(formatRelativeOrAbsolute("2026-08-13T09:01:00", now)).toBe("59 分钟前");
  });

  it("renders hours within the same day", () => {
    expect(formatRelativeOrAbsolute("2026-08-13T08:00:00", now)).toBe("2 小时前");
    expect(formatRelativeOrAbsolute("2026-08-13T00:30:00", now)).toBe("9 小时前");
  });

  it("renders yesterday with a clock time", () => {
    expect(formatRelativeOrAbsolute("2026-08-12T14:30:00", now)).toBe("昨天 14:30");
    expect(formatRelativeOrAbsolute("2026-08-12T23:30:00", now)).toBe("昨天 23:30");
  });

  it("renders whole days inside the 7-day window", () => {
    expect(formatRelativeOrAbsolute("2026-08-11T09:00:00", now)).toBe("2 天前");
    expect(formatRelativeOrAbsolute("2026-08-07T09:00:00", now)).toBe("6 天前");
  });

  it("renders absolute datetime at and beyond the 7-day boundary", () => {
    expect(formatRelativeOrAbsolute("2026-08-06T10:00:00", now)).toBe("2026-08-06 10:00");
    expect(formatRelativeOrAbsolute("2026-08-05T12:52:49", now)).toBe("2026-08-05 12:52");
    // Just inside the elapsed-time boundary stays relative (calendar diff = 7).
    expect(formatRelativeOrAbsolute("2026-08-06T10:00:01", now)).toBe("7 天前");
  });

  it("renders future timestamps as absolute except within clock-skew tolerance", () => {
    expect(formatRelativeOrAbsolute("2026-08-13T10:00:30", now)).toBe("刚刚");
    expect(formatRelativeOrAbsolute("2026-08-13T12:00:00", now)).toBe("2026-08-13 12:00");
  });

  it("falls back to the original text for invalid input", () => {
    expect(formatRelativeOrAbsolute("刚刚", now)).toBe("刚刚");
    expect(formatRelativeOrAbsolute("not-a-date", now)).toBe("not-a-date");
    expect(formatRelativeOrAbsolute("", now)).toBe("");
  });
});

describe("formatAbsolute", () => {
  it("renders the full precise timestamp", () => {
    expect(formatAbsolute("2026-08-05T12:52:49")).toBe("2026-08-05 12:52:49");
  });

  it("falls back to the original text for invalid input", () => {
    expect(formatAbsolute("—")).toBe("—");
    expect(formatAbsolute("")).toBe("");
  });
});
