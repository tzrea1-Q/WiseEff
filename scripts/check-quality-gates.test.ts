import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateQualityGateConfiguration,
  requiredQualityGateScripts,
  requiredQualityGateSpecFiles
} from "./check-quality-gates";

const qualityConfigSource = readFileSync("playwright.quality.config.ts", "utf8");

describe("M5.11 quality gates", () => {
  it.each(["consistency", "compact", "visual", "a11y", "responsive"])(
    "fails when %s is not registered in the quality config",
    (project) => {
      const result = evaluateQualityGateConfiguration({
        packageJson: JSON.parse(readFileSync("package.json", "utf8")),
        existingFiles: new Set(requiredQualityGateSpecFiles),
        qualityConfigSource: `selectQualityProjects([${["consistency", "compact", "visual", "a11y", "responsive"]
          .filter((name) => name !== project).map((name) => `{ name: "${name}" }`).join(",")}], qualityLane)`
      });
      expect(result).toMatchObject({ status: "failed", missingProjects: [project] });
    }
  );

  it.each(["consistency", "compact", "visual", "a11y", "responsive"])(
    "fails when the %s quality project configuration is missing",
    (project) => {
      const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
      delete packageJson.scripts[`acceptance:${project}`];
      const result = evaluateQualityGateConfiguration({
        qualityConfigSource,
        packageJson,
        existingFiles: new Set(requiredQualityGateSpecFiles)
      });
      expect(result.status).toBe("failed");
      expect(result.missingScripts).toContain(`acceptance:${project}`);
    }
  );

  it.each([
    "e2e/quality/consistency.quality.spec.ts",
    "e2e/quality/consistency.collector.spec.ts",
    "e2e/quality/compact.quality.spec.ts",
    "e2e/quality/visual.quality.spec.ts",
    "e2e/quality/a11y.quality.spec.ts",
    "e2e/quality/responsive.quality.spec.ts"
  ])("fails when the quality spec %s is missing", (file) => {
    const existingFiles = new Set<string>(requiredQualityGateSpecFiles);
    existingFiles.delete(file);
    const result = evaluateQualityGateConfiguration({
      qualityConfigSource,
      packageJson: JSON.parse(readFileSync("package.json", "utf8")),
      existingFiles
    });
    expect(result).toMatchObject({ status: "failed", missingSpecFiles: [file] });
  });

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

  it("requires every quality project's npm script", () => {
    expect(requiredQualityGateScripts).toEqual([
      "acceptance:consistency",
      "acceptance:compact",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);

    const result = evaluateQualityGateConfiguration({
      qualityConfigSource,
      packageJson: {
        scripts: {
          "acceptance:consistency": "playwright test --config playwright.quality.config.ts --project consistency",
          "acceptance:compact": "playwright test --config playwright.quality.config.ts --project compact",
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
      qualityConfigSource,
      packageJson: {
        scripts: {
          "acceptance:a11y": "playwright test --config playwright.quality.config.ts --project a11y"
        }
      },
      existingFiles: new Set(["e2e/quality/a11y.quality.spec.ts"])
    });

    expect(result).toMatchObject({
      status: "failed",
      missingScripts: ["acceptance:consistency", "acceptance:compact", "acceptance:visual", "acceptance:responsive"],
      missingSpecFiles: [
        "e2e/quality/consistency.quality.spec.ts",
        "e2e/quality/consistency.collector.spec.ts",
        "e2e/quality/compact.quality.spec.ts",
        "e2e/quality/visual.quality.spec.ts",
        "e2e/quality/responsive.quality.spec.ts"
      ]
    });
  });
});
