import { describe, expect, it } from "vitest";
import { formatLastActive, normalizeTimestampInput } from "./formatLastActive";

describe("formatLastActive", () => {
  it("routes ISO timestamps through the shared datetime formatter", () => {
    expect(formatLastActive(new Date(Date.now() - 30_000).toISOString())).toBe("刚刚");
    expect(formatLastActive("2020-01-05T12:52:49.398Z")).toMatch(/^2020-01-05 \d{2}:\d{2}$/);
  });

  it("formats Postgres text timestamps with optional milliseconds and short timezones", () => {
    const pgWithMs = "2026-08-12 04:04:25.984+00";
    const pgNoMs = "2026-08-12 04:04:25+00";
    const pgPlus8 = "2026-08-12 12:04:25.984+08";

    expect(formatLastActive(pgWithMs)).not.toBe(pgWithMs);
    expect(formatLastActive(pgNoMs)).not.toBe(pgNoMs);
    expect(formatLastActive(pgPlus8)).not.toBe(pgPlus8);
    expect(formatLastActive("2020-01-05 12:52:49.984+00")).toMatch(/^2020-01-05 \d{2}:\d{2}$/);
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

  it("keeps already-formatted Chinese unchanged", () => {
    expect(formatLastActive("刚刚")).toBe("刚刚");
    expect(formatLastActive("从未")).toBe("从未");
    expect(formatLastActive("2 小时前")).toBe("2 小时前");
    expect(formatLastActive("今天 09:12")).toBe("今天 09:12");
  });

  it("renders unparseable strings as 未知 and keeps empty strings empty", () => {
    expect(formatLastActive("some unknown value")).toBe("未知");
    expect(formatLastActive("")).toBe("");
  });
});

describe("normalizeTimestampInput", () => {
  it("normalizes Postgres text timestamps for parsing", () => {
    expect(normalizeTimestampInput("2026-08-12 04:04:25.984+00")).toBe("2026-08-12T04:04:25.984+00:00");
    expect(normalizeTimestampInput("2026-08-12 12:04:25+08")).toBe("2026-08-12T12:04:25+08:00");
    expect(normalizeTimestampInput("2020-01-05T12:52:49.398Z")).toBe("2020-01-05T12:52:49.398Z");
  });

  it("returns null for non-timestamp input", () => {
    expect(normalizeTimestampInput("never")).toBeNull();
    expect(normalizeTimestampInput("some garbage")).toBeNull();
  });
});
