import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredAcceptanceCiScripts = [
  "acceptance:ci",
  "acceptance:browser",
  "acceptance:models",
  "acceptance:quality",
  "acceptance:quality-run",
  "acceptance:smoke",
  "acceptance:a11y",
  "acceptance:visual",
  "acceptance:responsive"
] as const;

export const requiredAcceptanceCiWorkflowTokens = [
  "name: Detect changed paths",
  "name: Merge bar",
  "acceptance-smoke:",
  "acceptance-local-non-hdc:",
  "target-synthetic-acceptance:",
  "workflow_dispatch",
  "acceptance_mode",
  "local-non-hdc",
  "target-non-hdc",
  "full-pilot",
  "full-acceptance",
  "cancel-in-progress",
  "pgvector/pgvector:pg16",
  "npx playwright install --with-deps chromium",
  "npm run acceptance:ci",
  "npm run acceptance:models",
  "npm run acceptance:quality",
  "npm run acceptance:quality-run",
  "npm run acceptance:smoke",
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

export const CI_SMOKE_TAG = "@ci-smoke";
export const CI_SMOKE_TAG_MIN = 1;
export const CI_SMOKE_TAG_MAX = 5;
export const requiredSmokeSpecPaths = [
  "e2e/acceptance/runtime-warmup.spec.ts",
  "e2e/acceptance/shell-navigation.acceptance.spec.ts",
  "e2e/acceptance/auth-runtime.acceptance.spec.ts",
  "e2e/acceptance/parameter-home.acceptance.spec.ts"
] as const;

export type AcceptanceCiConfigurationInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  workflowText: string;
  smokeTagCount?: number;
};

export type AcceptanceCiConfigurationResult = {
  status: "passed" | "failed";
  missingScripts: string[];
  missingWorkflowTokens: string[];
  missingArtifactPaths: string[];
  fullPilotDefaultGate: boolean;
  smokeTagCount: number;
  smokeTagGate: boolean;
  missingSmokeSpecPaths: string[];
};

export function countCiSmokeTags(sourceText: string): number {
  if (!sourceText.includes(CI_SMOKE_TAG)) {
    return 0;
  }
  return sourceText.split(CI_SMOKE_TAG).length - 1;
}

export function readAcceptanceSpecSources(root = "e2e/acceptance"): string {
  if (!existsSync(root)) {
    return "";
  }
  return readdirSync(root)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort()
    .map((name) => readFileSync(join(root, name), "utf8"))
    .join("\n");
}

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
  const smokeTagCount = input.smokeTagCount ?? 0;
  const smokeTagGate = smokeTagCount >= CI_SMOKE_TAG_MIN && smokeTagCount <= CI_SMOKE_TAG_MAX;
  const smokeScript = scripts["acceptance:smoke"] ?? "";
  const missingSmokeSpecPaths = requiredSmokeSpecPaths.filter((path) => !smokeScript.includes(path));

  return {
    status:
      missingScripts.length === 0 &&
      missingWorkflowTokens.length === 0 &&
      missingArtifactPaths.length === 0 &&
      missingSmokeSpecPaths.length === 0 &&
      !fullPilotDefaultGate &&
      smokeTagGate
        ? "passed"
        : "failed",
    missingScripts,
    missingWorkflowTokens,
    missingArtifactPaths,
    fullPilotDefaultGate,
    smokeTagCount,
    smokeTagGate,
    missingSmokeSpecPaths
  };
}

export function runAcceptanceCiConfigurationCheck() {
  if (!existsSync(".github/workflows/ci.yml")) {
    throw new Error("CI workflow not found at .github/workflows/ci.yml.");
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as AcceptanceCiConfigurationInput["packageJson"];
  const workflowText = readFileSync(".github/workflows/ci.yml", "utf8");
  const smokeTagCount = countCiSmokeTags(readAcceptanceSpecSources());
  const result = evaluateAcceptanceCiConfiguration({ packageJson, workflowText, smokeTagCount });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function hasDefaultFullPilotGate(normalizedWorkflowText: string) {
  const fullPilotRuns = normalizedWorkflowText.match(
    /run:\s*npm run acceptance:browser -- --mode full-pilot(?! --no-start-runtime)/g
  );

  return (fullPilotRuns?.length ?? 0) > 0;
}

function normalizeWorkflowText(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCiConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
