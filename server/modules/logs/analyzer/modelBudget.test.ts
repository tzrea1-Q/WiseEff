import { describe, expect, it } from "vitest";
import { logCompletionLimit } from "./modelBudget";

describe("logCompletionLimit", () => {
  it.each([
    [4_003, 1_000],
    [512, 256],
    [512_000, 8_192]
  ])("limits a %i-token budget to %i output tokens", (tokenBudget, expected) => {
    expect(logCompletionLimit(tokenBudget)).toBe(expected);
  });
});
