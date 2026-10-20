import { describe, expect, it } from "vitest";
import { formatBytes } from "./formatBytes";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [42, "42 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [20 * 1024, "20.0 KB"],
    [1536, "1.5 KB"],
    [1024 ** 2, "1.0 MB"],
    [1.25 * 1024 ** 2, "1.3 MB"]
  ])("formats %s bytes as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
