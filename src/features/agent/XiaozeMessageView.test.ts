import { describe, expect, it } from "vitest";
import { shouldShowXiaozeWelcomePanel } from "./xiaozeWelcomeRules";

describe("shouldShowXiaozeWelcomePanel", () => {
  it("shows the welcome guide only when the active thread has no messages", () => {
    expect(shouldShowXiaozeWelcomePanel(0)).toBe(true);
    expect(shouldShowXiaozeWelcomePanel(1)).toBe(false);
  });
});
