import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactQualityRoutes } from "../../e2e/quality/compact-routes";

describe("compact PC quality coverage", () => {
  it("covers each archetype and all five previously failing routes without a full second matrix", () => {
    expect(compactQualityRoutes.map((route) => route.template)).toEqual(expect.arrayContaining([
      "NavigatorWorkbench", "AdminListPage", "OverviewPage", "SettingsFormPage", "ReviewInbox", "RetiredNotice"
    ]));
    expect(compactQualityRoutes.map((route) => route.path)).toEqual(expect.arrayContaining([
      "/parameter-home", "/parameter-admin", "/parameter-admin/specs", "/parameter-admin/modules",
      "/parameter-admin/specs/identity-mapping"
    ]));
    expect(new Set(compactQualityRoutes.map((route) => route.path)).size).toBe(compactQualityRoutes.length);
    expect(compactQualityRoutes).toHaveLength(9);
  });

  it("runs the compact gate in the existing CI quality command", () => {
    const config = readFileSync("playwright.quality.config.ts", "utf8");
    expect(config).toMatch(/name: "compact"[\s\S]*?testMatch: \/compact\\\.quality\\\.spec\\\.ts\/[\s\S]*?dependencies: \["runtime-warmup"\][\s\S]*?viewport: \{ width: 1280, height: 800 \}/);
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(workflow).toContain("run: npm run acceptance:quality-run");
  });
});
