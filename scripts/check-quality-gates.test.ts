import { describe, expect, it } from "vitest";
import {
  evaluateQualityGateConfiguration,
  requiredQualityGateScripts,
  requiredQualityGateSpecFiles
} from "./check-quality-gates";

describe("M5.11 quality gates", () => {
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
