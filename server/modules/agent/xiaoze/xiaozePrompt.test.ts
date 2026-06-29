import { describe, expect, it } from "vitest";
import { XIAOZE_PROMPT_VERSION, XIAOZE_SYSTEM_PROMPT } from "./xiaozePrompt";

describe("xiaozePrompt", () => {
  it("exports a versioned system prompt", () => {
    expect(XIAOZE_PROMPT_VERSION).toBe("2026-06-29.1");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("Xiaoze");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("Never claim a write occurred");
    expect(XIAOZE_SYSTEM_PROMPT).toContain("FORBIDDEN");
  });
});
