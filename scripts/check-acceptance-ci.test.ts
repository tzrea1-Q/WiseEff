import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  CI_SMOKE_TAG,
  countCiSmokeTags,
  evaluateAcceptanceLocalNonHdcBudget,
  evaluateAcceptanceCiConfiguration,
  evaluateImmutableAcceptanceUpload,
  findAcceptanceEnvironmentHelperLoads,
  findForbiddenAcceptanceDotenvImports,
  findForbiddenPlaywrightImports,
  readAcceptanceConfigurationSources,
  readAcceptanceEnvironmentSources,
  requiredAcceptanceCiArtifactPaths,
  requiredAcceptanceCiScripts,
  requiredAcceptanceCiWorkflowTokens
} from "./check-acceptance-ci";

const compliantWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");

const compliantScripts = {
  ...Object.fromEntries(requiredAcceptanceCiScripts.map((script) => [script, "ok"])),
  "acceptance:smoke":
    "playwright test --config playwright.acceptance.config.ts --grep \"@ci-smoke|warm vite entry graph\" e2e/acceptance/runtime-warmup.spec.ts e2e/acceptance/shell-navigation.acceptance.spec.ts e2e/acceptance/auth-runtime.acceptance.spec.ts e2e/acceptance/parameter-home.acceptance.spec.ts"
};

describe("M5.12 acceptance CI configuration", () => {
  it("keeps the L2 platform budget strictly above bounded prelude, Gate0 owner, and always finalization", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const budget = evaluateAcceptanceLocalNonHdcBudget(workflow);

    expect(budget).toMatchObject({
      status: "passed",
      jobTimeoutMinutes: 155,
      platformOverheadMinutes: 5,
      preGate0BudgetMinutes: 72,
      gate0OwnerMinutes: 60,
      artifactSafetyMinutes: 5,
      artifactUploadMinutes: 5,
      requiredExclusiveFloorMinutes: 151,
      missingStepTimeouts: [],
    });
    expect(budget.jobTimeoutMinutes).toBeGreaterThan(budget.requiredExclusiveFloorMinutes);

    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace("    timeout-minutes: 155", "    timeout-minutes: 151"),
    ).status).toBe("failed");
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Owned visual and browser acceptance Gate 0",
        "      - name: Unbounded added prerequisite\n        run: npm run surprise\n\n      - name: Owned visual and browser acceptance Gate 0",
      ),
    )).toMatchObject({ status: "failed", missingStepTimeouts: ["Unbounded added prerequisite"] });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - name: Unbounded added finalizer\n        if: always()\n        run: npm run surprise:finalize\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({ status: "failed", missingStepTimeouts: ["Unbounded added finalizer"] });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - name: Bounded added finalizer\n        if: always()\n        timeout-minutes: 4\n        run: npm run surprise:finalize\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      requiredExclusiveFloorMinutes: 155,
      missingStepTimeouts: [],
    });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - if: always()\n        name: If-first unbounded finalizer\n        run: npm run surprise:if-first\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      missingStepTimeouts: ["If-first unbounded finalizer"],
    });
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Upload acceptance evidence",
        "      - if: always()\n        name: If-first bounded finalizer\n        timeout-minutes: 4\n        run: npm run surprise:if-first\n\n      - name: Upload acceptance evidence",
      ),
    )).toMatchObject({
      status: "failed",
      requiredExclusiveFloorMinutes: 155,
      missingStepTimeouts: [],
    });
  });

  it("routes every formerly dotenv-backed acceptance spec through the owned-runtime-aware helper", () => {
    const sources = readAcceptanceEnvironmentSources();

    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    expect(findAcceptanceEnvironmentHelperLoads(sources)).toHaveLength(32);
  });

  it("routes both Playwright acceptance configs through the same owned-runtime-aware helper", () => {
    const sources = readAcceptanceConfigurationSources();

    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    expect(findAcceptanceEnvironmentHelperLoads(sources)).toHaveLength(2);
  });

  it("requires layered job ids, smoke, and a single quality-run token", () => {
    expect(requiredAcceptanceCiScripts).toEqual([
      "acceptance:ci",
      "acceptance:browser",
      "acceptance:artifacts:check",
      "acceptance:artifacts:finalize",
      "acceptance:gate0",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:quality-run",
      "acceptance:smoke",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(requiredAcceptanceCiWorkflowTokens).toEqual(
      expect.arrayContaining([
        "name: Detect changed paths",
        "name: Merge bar",
        "acceptance-smoke:",
        "acceptance-local-non-hdc:",
        "full-acceptance",
        "cancel-in-progress",
        "Acceptance CI metadata (L1)",
        "./.github/actions/setup-dts-toolchain",
        "npm run acceptance:quality-run",
        "npm run acceptance:smoke",
        "npm run acceptance:gate0"
      ])
    );
    expect(requiredAcceptanceCiWorkflowTokens).not.toContain("npm run acceptance:a11y");
    expect(requiredAcceptanceCiArtifactPaths).toEqual([
      "playwright-report/acceptance",
      "test-results/acceptance",
      "docs/generated/acceptance-browser-evidence.md",
      "docs/generated/acceptance-operation-evidence.md",
      "docs/generated/acceptance-operation-evidence/index.json",
      "playwright-report/quality",
      "test-results/quality",
      "test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip"
    ]);
  });

  it("passes when the package scripts, workflow layers, and smoke cap are present", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: compliantWorkflow,
      smokeTagCount: 3
    });

    expect(result).toMatchObject({
      status: "passed",
      missingScripts: [],
      missingWorkflowTokens: [],
      missingArtifactPaths: [],
      smokeTagGate: true
    });
  });

  it("fails when CI cannot run local acceptance or archive evidence", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: {
        scripts: {
          "acceptance:browser": "tsx -- scripts/run-browser-acceptance.ts"
        }
      },
      workflowText: `
name: CI
on:
  pull_request:
jobs:
  build-and-test:
    steps:
      - run: npm test
`,
      smokeTagCount: 0
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual([
      "acceptance:ci",
      "acceptance:artifacts:check",
      "acceptance:artifacts:finalize",
      "acceptance:gate0",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:quality-run",
      "acceptance:smoke",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(result.missingWorkflowTokens).toEqual(expect.arrayContaining([...requiredAcceptanceCiWorkflowTokens]));
    expect(result.missingArtifactPaths).toEqual(requiredAcceptanceCiArtifactPaths);
    expect(result.smokeTagGate).toBe(false);
  });

  it("rejects uploading the live tree or bypassing immutable finalizer failure", () => {
    expect(evaluateImmutableAcceptanceUpload(compliantWorkflow)).toEqual({ status: "passed", errors: [] });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace(
        "path: test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip",
        "path: test-results/acceptance-runtime-runs",
      ),
    )).toMatchObject({ status: "failed" });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace(
        "always() && steps.acceptance_artifact_safety.outcome == 'success'",
        "always()",
      ),
    )).toMatchObject({ status: "failed" });
    expect(evaluateImmutableAcceptanceUpload(
      compliantWorkflow.replace("if-no-files-found: error\n          compression-level: 0", "if-no-files-found: ignore\n          compression-level: 0"),
    )).toMatchObject({ status: "failed" });
  });

  it("rejects extra diagnostic uploads, raw fallbacks, skipped safety and late identity", () => {
    for (const mutate of [
      ...["v3", "unreviewed"].map((ref) => (w: any) => {
        w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.name === "Upload acceptance evidence").uses = `actions/upload-artifact@${ref}`;
      }),
      (w: any) => w.jobs["acceptance-local-non-hdc"].steps.push({ uses: "actions/upload-artifact@v3", with: { path: "." } }),
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic_upload").with.path = "test-results/**"; },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic")["continue-on-error"] = true; },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps.find((s: any) => s.id === "acceptance_diagnostic").shell = "python3 {0}"; },
      (w: any) => { const steps = w.jobs["acceptance-local-non-hdc"].steps; steps.push(...steps.splice(1, 1)); },
      (w: any) => { w.jobs["acceptance-local-non-hdc"].steps = w.jobs["acceptance-local-non-hdc"].steps.filter((s: any) => s.id !== "acceptance_diagnostic_fallback"); },
    ]) {
      const workflow = YAML.parse(compliantWorkflow);
      mutate(workflow);
      expect(evaluateImmutableAcceptanceUpload(YAML.stringify(workflow)).status).toBe("failed");
    }
  });

  it("blocks accidental default full-pilot gates on pull requests", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: `${compliantWorkflow}
  dangerous-pr-full-pilot:
    steps:
      - run: npm run acceptance:browser -- --mode full-pilot
`,
      smokeTagCount: 3
    });

    expect(result.status).toBe("failed");
    expect(result.fullPilotDefaultGate).toBe(true);
  });

  it("fails when a spec imports @playwright/test instead of playwright/test", () => {
    expect(
      findForbiddenPlaywrightImports([
        { path: "e2e/acceptance/ok.spec.ts", source: 'import { test } from "playwright/test";\n' }
      ])
    ).toEqual([]);
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: { scripts: compliantScripts },
      workflowText: compliantWorkflow,
      smokeTagCount: 3,
      playwrightSources: [
        {
          path: "e2e/acceptance/broken.acceptance.spec.ts",
          source: 'import { test } from "@playwright/test";\n'
        }
      ]
    });
    expect(result.status).toBe("failed");
    expect(result.forbiddenPlaywrightImports).toEqual(["e2e/acceptance/broken.acceptance.spec.ts"]);
  });

  it("skips DTS bootstrap on a warm cache and does not install it in quality", () => {
    const action = readFileSync(".github/actions/setup-dts-toolchain/action.yml", "utf8");
    expect(action).toContain("Use cached DTS toolchain if it already verifies");
    expect(action).toContain("if: steps.dts-warm.outputs.warm != 'true'");
    expect(action).toContain("timeout 180s sudo apt-get update");

    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const qualityJob = workflow.split("\n  acceptance-quality:")[1]?.split("\n  acceptance-smoke:")[0] ?? "";
    expect(qualityJob).toContain("Acceptance quality");
    expect(qualityJob).toContain("timeout-minutes: 35");
    expect(qualityJob).not.toContain("setup-dts-toolchain");
    expect(workflow).toContain("./.github/actions/setup-dts-toolchain");
  });

  it("keeps the isolated minimal upgrade mode out of target acceptance", () => {
    const { jobs } = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    expect(jobs["target-synthetic-acceptance"].if).toContain("inputs.acceptance_mode != 'minimal-upgrade'");
    expect(jobs["minimal-upgrade"].if).toContain("inputs.acceptance_mode == 'minimal-upgrade'");
    expect(JSON.stringify(jobs["minimal-upgrade"])).not.toContain("secrets.");
    const evidenceUpload = jobs["minimal-upgrade"].steps.find((step: { with?: { name?: string } }) =>
      step.with?.name === "minimal-upgrade-terminal-evidence");
    expect(evidenceUpload.with.path).toBe("/tmp/wiseeff-minimal-terminal-*/evidence.zip");
  });

  it("rejects a missing or oversized @ci-smoke set", () => {
    expect(countCiSmokeTags(`test("a", { tag: ["${CI_SMOKE_TAG}"] }, async () => {});`)).toBe(1);
    expect(
      evaluateAcceptanceCiConfiguration({
        packageJson: { scripts: compliantScripts },
        workflowText: compliantWorkflow,
        smokeTagCount: 6
      }).smokeTagGate
    ).toBe(false);
  });
});
