import { describe, expect, it } from "vitest";
import { supportsXiaozeProactiveInsights } from "./xiaozeProactiveInsights";

describe("supportsXiaozeProactiveInsights", () => {
  it("allows parameter and log analysis pages", () => {
    expect(supportsXiaozeProactiveInsights("parameters")).toBe(true);
    expect(supportsXiaozeProactiveInsights("parameter-review")).toBe(true);
    expect(supportsXiaozeProactiveInsights("logs")).toBe(true);
  });

  it("blocks unrelated pages such as the personal workbench", () => {
    expect(supportsXiaozeProactiveInsights("parameter-home")).toBe(false);
    expect(supportsXiaozeProactiveInsights("debugging")).toBe(false);
    expect(supportsXiaozeProactiveInsights("home")).toBe(false);
  });
});
