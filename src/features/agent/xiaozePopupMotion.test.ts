import { describe, expect, it } from "vitest";
import { dimensionToCss, readXiaozePopupMotionDurations } from "./xiaozePopupMotion";

describe("xiaozePopupMotion", () => {
  it("formats popup dimensions", () => {
    expect(dimensionToCss(420, 560)).toBe("420px");
    expect(dimensionToCss("50%", 560)).toBe("50%");
    expect(dimensionToCss(undefined, 560)).toBe("560px");
  });

  it("exposes motion durations", () => {
    const durations = readXiaozePopupMotionDurations();
    expect(durations.openMs).toBeGreaterThan(0);
    expect(durations.closeMs).toBeGreaterThan(0);
  });
});
