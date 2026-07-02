import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quality snapshot configuration", () => {
  it("keeps visual screenshot baselines platform-scoped for CI portability", () => {
    const qualityConfig = readFileSync("playwright.quality.config.ts", "utf8");
    const e2eConfig = readFileSync("playwright.config.ts", "utf8");

    expect(qualityConfig).toContain("{platform}");
    expect(e2eConfig).toContain("{platform}");
  });

  it("keeps quality specs behind the dedicated quality Playwright config", () => {
    const e2eConfig = readFileSync("playwright.config.ts", "utf8");

    expect(e2eConfig).toMatch(/testIgnore:.*quality.*\.quality\.spec\.ts/s);
  });

  it("keeps default E2E Xiaoze flows on deterministic mode", () => {
    const sharedConfig = readFileSync("playwright.shared.ts", "utf8");

    expect(sharedConfig).toMatch(/XIAOZE_DETERMINISTIC:\s*"true"/);
  });

  it("fails fast instead of reusing an unknown local E2E runtime by default", () => {
    const e2eConfig = readFileSync("playwright.config.ts", "utf8");

    expect(e2eConfig).toContain('process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true"');
    expect(e2eConfig).not.toContain("!process.env.CI");
  });
});
