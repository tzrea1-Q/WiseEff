import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CI_SMOKE_TAG,
  countCiSmokeTags,
  evaluateAcceptanceLocalNonHdcBudget,
  evaluateAcceptanceCiConfiguration,
  findAcceptanceEnvironmentHelperLoads,
  findForbiddenAcceptanceDotenvImports,
  findForbiddenPlaywrightImports,
  readAcceptanceConfigurationSources,
  readAcceptanceEnvironmentSources,
  requiredAcceptanceCiArtifactPaths,
  requiredAcceptanceCiScripts,
  requiredAcceptanceCiWorkflowTokens
} from "./check-acceptance-ci";

const compliantWorkflow = `
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:
    inputs:
      acceptance_mode:
        type: choice
        options:
          - local-non-hdc
          - target-non-hdc
          - full-pilot

concurrency:
  group: ci
  cancel-in-progress: true

jobs:
  detect:
    name: Detect changed paths
    steps:
      - run: echo detect

  build-and-test:
    steps:
      - name: Acceptance CI metadata (L1)
        run: npm run acceptance:ci
      - run: npm run acceptance:quality
      - run: npm run acceptance:quality-run

  required:
    name: Merge bar

  acceptance-smoke:
    steps:
      - run: npm run acceptance:smoke

  acceptance-local-non-hdc:
    if: contains(github.event.pull_request.labels.*.name, 'full-acceptance')
    name: Acceptance local non-HDC
    timeout-minutes: 150
    services:
      postgres:
        image: pgvector/pgvector:pg16
    steps:
      - name: Check out repository
        timeout-minutes: 5
        run: echo checkout
      - name: Set up Node.js
        timeout-minutes: 5
        run: echo node
      - name: Install dependencies
        timeout-minutes: 15
        run: npm ci
      - name: Install and verify DTS toolchain
        timeout-minutes: 20
        uses: ./.github/actions/setup-dts-toolchain
      - name: Advisory DTS seed compile (dtc)
        timeout-minutes: 3
        run: npm run dtc:seed:compile
      - name: Install Playwright Chromium
        timeout-minutes: 15
        run: npx playwright install --with-deps chromium
      - name: Acceptance CI metadata
        timeout-minutes: 3
        run: npm run acceptance:ci
      - name: Acceptance state models
        timeout-minutes: 5
        run: npm run acceptance:models
      - name: Owned visual and browser acceptance Gate 0
        timeout-minutes: 65
        run: npm run acceptance:gate0
      - name: Acceptance artifact safety
        id: acceptance_artifact_safety
        if: always()
        timeout-minutes: 5
        run: npm run acceptance:artifacts:check -- --root test-results/acceptance-runtime-runs
      - name: Upload acceptance evidence
        if: always() && steps.acceptance_artifact_safety.outcome == 'success'
        timeout-minutes: 5
        uses: actions/upload-artifact@v4
        with:
          path: |
            playwright-report/acceptance
            test-results/acceptance
            docs/generated/acceptance-browser-evidence.md
            docs/generated/acceptance-operation-evidence.md
            docs/generated/acceptance-operation-evidence/index.json
            playwright-report/quality
            test-results/quality
            test-results/acceptance-runtime-runs

  target-synthetic-acceptance:
    name: Target synthetic acceptance
    if: github.event_name == 'workflow_dispatch' && inputs.acceptance_mode != 'local-non-hdc'
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npm run acceptance:quality-run
      - run: npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
        if: inputs.acceptance_mode == 'target-non-hdc'
      - run: npm run acceptance:browser -- --mode full-pilot --no-start-runtime
        if: inputs.acceptance_mode == 'full-pilot'
`;

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
      jobTimeoutMinutes: 150,
      platformOverheadMinutes: 5,
      preGate0BudgetMinutes: 71,
      gate0OwnerMinutes: 60,
      artifactSafetyMinutes: 5,
      artifactUploadMinutes: 5,
      requiredExclusiveFloorMinutes: 146,
      missingStepTimeouts: [],
    });
    expect(budget.jobTimeoutMinutes).toBeGreaterThan(budget.requiredExclusiveFloorMinutes);

    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace("    timeout-minutes: 150", "    timeout-minutes: 146"),
    ).status).toBe("failed");
    expect(evaluateAcceptanceLocalNonHdcBudget(
      workflow.replace(
        "      - name: Owned visual and browser acceptance Gate 0",
        "      - name: Unbounded added prerequisite\n        run: npm run surprise\n\n      - name: Owned visual and browser acceptance Gate 0",
      ),
    )).toMatchObject({ status: "failed", missingStepTimeouts: ["Unbounded added prerequisite"] });
  });

  it("routes every formerly dotenv-backed acceptance spec through the owned-runtime-aware helper", () => {
    const sources = readAcceptanceEnvironmentSources();

    expect(findForbiddenAcceptanceDotenvImports(sources)).toEqual([]);
    expect(findAcceptanceEnvironmentHelperLoads(sources)).toHaveLength(27);
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
      "test-results/acceptance-runtime-runs"
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
