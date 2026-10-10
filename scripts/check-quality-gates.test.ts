import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateQualityGateConfiguration,
  requiredQualityGateScripts,
  requiredQualityGateSpecFiles
} from "./check-quality-gates";

describe("M5.11 quality gates", () => {
  it.each([
    "/debugging-admin/nodes",
    "/log-admin",
    "/log-dashboard",
    "/parameter-admin/projects/aurora",
    "/parameter-admin/projects/aurora/config-sets",
    "/parameter-admin/projects/aurora/configuration",
    "/parameter-admin/projects/aurora/conflicts",
    "/parameter-admin/projects/aurora/files",
    "/parameter-admin/projects/aurora/structure",
    "/parameter-home"
  ])("keeps UIA-001 route %s in the accessibility scan", (route) => {
    const spec = readFileSync("e2e/quality/a11y.quality.spec.ts", "utf8");
    expect(spec).toContain(JSON.stringify(route));
  });

  it("does not exclude the UIA-001 hotspot, working chip, or source line numbers", () => {
    const spec = readFileSync("e2e/quality/a11y.quality.spec.ts", "utf8");
    for (const selector of [
      ".parameter-home__view-switcher-item--hotspots",
      ".configuration-workbench__working",
      ".project-primary-dts-viewer__line-number"
    ]) {
      expect(spec).not.toContain(JSON.stringify(selector));
    }
  });

  it("requires the a11y, visual, and responsive npm scripts", () => {
    expect(requiredQualityGateScripts).toEqual([
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);

    const result = evaluateQualityGateConfiguration({
      packageJson: {
        scripts: {
          "acceptance:a11y": "playwright test --config playwright.quality.config.ts --project a11y",
          "acceptance:visual": "playwright test --config playwright.quality.config.ts --project visual",
          "acceptance:responsive": "playwright test --config playwright.quality.config.ts --project responsive"
        }
      },
      existingFiles: new Set(requiredQualityGateSpecFiles)
    });

    expect(result).toMatchObject({
      status: "passed",
      missingScripts: [],
      missingSpecFiles: []
    });
  });

  it("fails when any quality script or spec file is missing", () => {
    const result = evaluateQualityGateConfiguration({
      packageJson: {
        scripts: {
          "acceptance:a11y": "playwright test --config playwright.quality.config.ts --project a11y"
        }
      },
      existingFiles: new Set(["e2e/quality/a11y.quality.spec.ts"])
    });

    expect(result).toMatchObject({
      status: "failed",
      missingScripts: ["acceptance:visual", "acceptance:responsive"],
      missingSpecFiles: [
        "e2e/quality/visual.quality.spec.ts",
        "e2e/quality/responsive.quality.spec.ts"
      ]
    });
  });
});
