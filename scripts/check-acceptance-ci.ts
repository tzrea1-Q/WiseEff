import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const requiredAcceptanceCiScripts = [
  "acceptance:ci",
  "acceptance:browser",
  "acceptance:models",
  "acceptance:quality",
  "acceptance:a11y",
  "acceptance:visual",
  "acceptance:responsive"
] as const;

export const requiredAcceptanceCiWorkflowTokens = [
  "acceptance-local-non-hdc",
  "target-synthetic-acceptance",
  "workflow_dispatch",
  "acceptance_mode",
  "local-non-hdc",
  "target-non-hdc",
  "full-pilot",
  "postgres:16",
  "npx playwright install --with-deps chromium",
  "npm run acceptance:ci",
  "npm run acceptance:models",
  "npm run acceptance:quality",
  "npm run acceptance:a11y",
  "npm run acceptance:visual",
  "npm run acceptance:responsive",
  "npm run acceptance:browser -- --mode local-non-hdc",
  "npm run acceptance:browser -- --mode target-non-hdc --no-start-runtime",
  "npm run acceptance:browser -- --mode full-pilot --no-start-runtime",
  "actions/upload-artifact@v4"
] as const;

export const requiredAcceptanceCiArtifactPaths = [
  "playwright-report/acceptance",
  "test-results/acceptance",
  "docs/generated/acceptance-browser-evidence.md",
  "docs/generated/acceptance-operation-evidence.md",
  "docs/generated/acceptance-operation-evidence/index.json",
  "playwright-report/quality",
  "test-results/quality"
] as const;

export type AcceptanceCiConfigurationInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  workflowText: string;
};

export type AcceptanceCiConfigurationResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingWorkflowTokens: string[];
  missingArtifactPaths: string[];
  fullPilotDefaultGate: boolean;
};

export function evaluateAcceptanceCiConfiguration(
  input: AcceptanceCiConfigurationInput
): AcceptanceCiConfigurationResult {
  const scripts = input.packageJson.scripts ?? {};
  const workflowText = normalizeWorkflowText(input.workflowText);
  const missingScripts = requiredAcceptanceCiScripts.filter((scriptName) => !scripts[scriptName]);
  const missingWorkflowTokens = requiredAcceptanceCiWorkflowTokens.filter(
    (token) => !workflowText.includes(normalizeWorkflowText(token))
  );
  const missingArtifactPaths = requiredAcceptanceCiArtifactPaths.filter(
    (path) => !workflowText.includes(normalizeWorkflowText(path))
  );
  const fullPilotDefaultGate = hasDefaultFullPilotGate(workflowText);

  return {
    status:
      missingScripts.length === 0 &&
      missingWorkflowTokens.length === 0 &&
      missingArtifactPaths.length === 0 &&
      !fullPilotDefaultGate
        ? "passed"
        : "failed",
    missingScripts,
    missingWorkflowTokens,
    missingArtifactPaths,
    fullPilotDefaultGate
  };
}

export function runAcceptanceCiConfigurationCheck() {
  if (!existsSync(".github/workflows/ci.yml")) {
    throw new Error("CI workflow not found at .github/workflows/ci.yml.");
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as AcceptanceCiConfigurationInput["packageJson"];
  const workflowText = readFileSync(".github/workflows/ci.yml", "utf8");
  const result = evaluateAcceptanceCiConfiguration({ packageJson, workflowText });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function hasDefaultFullPilotGate(normalizedWorkflowText: string) {
  const fullPilotRuns = normalizedWorkflowText.match(/run:\s*npm run acceptance:browser -- --mode full-pilot(?! --no-start-runtime)/g);

  return (fullPilotRuns?.length ?? 0) > 0;
}

function normalizeWorkflowText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCiConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
