import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quality snapshot configuration", () => {
  it("keeps visual screenshot baselines platform-scoped for CI portability", () => {
    const config = readFileSync("playwright.quality.config.ts", "utf8");

    expect(config).toContain("{platform}");
  });
});
