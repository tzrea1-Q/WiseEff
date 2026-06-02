import { describe, expect, it } from "vitest";
import {
  evaluateAcceptanceCiConfiguration,
  requiredAcceptanceCiArtifactPaths,
  requiredAcceptanceCiScripts,
  requiredAcceptanceCiWorkflowTokens
} from "./check-acceptance-ci";

const compliantWorkflow = `
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:
    inputs:
      acceptance_mode:
        type: choice
        options:
          - local-non-hdc
          - target-non-hdc
          - full-pilot

jobs:
  acceptance-local-non-hdc:
    name: Acceptance local non-HDC
    services:
      postgres:
        image: postgres:16
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npm run acceptance:ci
      - run: npm run acceptance:models
      - run: npm run acceptance:quality
      - run: npm run acceptance:a11y
      - run: npm run acceptance:visual
      - run: npm run acceptance:responsive
      - run: npm run acceptance:browser -- --mode local-non-hdc
      - uses: actions/upload-artifact@v4
        with:
          path: |
            playwright-report/acceptance
            test-results/acceptance
            docs/generated/acceptance-browser-evidence.md
            docs/generated/acceptance-operation-evidence.md
            docs/generated/acceptance-operation-evidence/index.json
            playwright-report/quality
            test-results/quality

  target-synthetic-acceptance:
    name: Target synthetic acceptance
    if: github.event_name == 'workflow_dispatch' && inputs.acceptance_mode != 'local-non-hdc'
    steps:
      - run: npx playwright install --with-deps chromium
      - run: npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime
        if: inputs.acceptance_mode == 'target-non-hdc'
      - run: npm run acceptance:browser -- --mode full-pilot --no-start-runtime
        if: inputs.acceptance_mode == 'full-pilot'
`;

describe("M5.12 acceptance CI configuration", () => {
  it("requires package scripts and workflow tokens for synthetic acceptance", () => {
    expect(requiredAcceptanceCiScripts).toEqual([
      "acceptance:ci",
      "acceptance:browser",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(requiredAcceptanceCiWorkflowTokens).toEqual(
      expect.arrayContaining([
        "acceptance-local-non-hdc",
        "target-synthetic-acceptance",
        "workflow_dispatch",
        "acceptance_mode",
        "postgres:16",
        "npx playwright install --with-deps chromium",
        "npm run acceptance:browser -- --mode local-non-hdc",
        "npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime",
        "npm run acceptance:browser -- --mode full-pilot --no-start-runtime",
        "actions/upload-artifact@v4"
      ])
    );
    expect(requiredAcceptanceCiArtifactPaths).toEqual([
      "playwright-report/acceptance",
      "test-results/acceptance",
      "docs/generated/acceptance-browser-evidence.md",
      "docs/generated/acceptance-operation-evidence.md",
      "docs/generated/acceptance-operation-evidence/index.json",
      "playwright-report/quality",
      "test-results/quality"
    ]);
  });

  it("passes when the package scripts and workflow archive the required evidence", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: {
        scripts: Object.fromEntries(requiredAcceptanceCiScripts.map((script) => [script, "ok"]))
      },
      workflowText: compliantWorkflow
    });

    expect(result).toMatchObject({
      status: "passed",
      missingScripts: [],
      missingWorkflowTokens: [],
      missingArtifactPaths: []
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
`
    });

    expect(result.status).toBe("failed");
    expect(result.missingScripts).toEqual([
      "acceptance:ci",
      "acceptance:models",
      "acceptance:quality",
      "acceptance:a11y",
      "acceptance:visual",
      "acceptance:responsive"
    ]);
    expect(result.missingWorkflowTokens).toEqual(expect.arrayContaining([...requiredAcceptanceCiWorkflowTokens]));
    expect(result.missingArtifactPaths).toEqual(requiredAcceptanceCiArtifactPaths);
  });

  it("blocks accidental default full-pilot gates on pull requests", () => {
    const result = evaluateAcceptanceCiConfiguration({
      packageJson: {
        scripts: Object.fromEntries(requiredAcceptanceCiScripts.map((script) => [script, "ok"]))
      },
      workflowText: `${compliantWorkflow}
  dangerous-pr-full-pilot:
    steps:
      - run: npm run acceptance:browser -- --mode full-pilot
`
    });

    expect(result.status).toBe("failed");
    expect(result.fullPilotDefaultGate).toBe(true);
  });
});
