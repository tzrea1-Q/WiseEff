import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const requiredAcceptanceCiScripts = [
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
  "./.github/actions/setup-dts-toolchain",
  "Acceptance CI metadata (L1)",
  "npm run acceptance:ci",
  "npm run acceptance:models",
  "npm run acceptance:quality",
  "npm run acceptance:quality-run",
  "npm run acceptance:smoke",
  "npm run acceptance:gate0",
  "name: Acceptance artifact safety",
  "npm run acceptance:artifacts:check -- --root test-results/acceptance-runtime-runs",
  "steps.acceptance_artifact_safety.outcome == 'success'",
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
  "test-results/quality",
  "test-results/acceptance-runtime-runs"
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

export const ACCEPTANCE_LOCAL_NON_HDC_PLATFORM_OVERHEAD_MINUTES = 5;
export const ACCEPTANCE_GATE0_OWNER_MINUTES = 60;
export const acceptanceLocalNonHdcPreludeSteps = [
  "Check out repository",
  "Set up Node.js",
  "Install dependencies",
  "Install and verify DTS toolchain",
  "Advisory DTS seed compile (dtc)",
  "Install Playwright Chromium",
  "Acceptance CI metadata",
  "Acceptance state models",
] as const;
const ACCEPTANCE_GATE0_STEP = "Owned visual and browser acceptance Gate 0";
const ACCEPTANCE_ARTIFACT_SAFETY_STEP = "Acceptance artifact safety";
const ACCEPTANCE_ARTIFACT_UPLOAD_STEP = "Upload acceptance evidence";

export type AcceptanceLocalNonHdcBudgetResult = {
  status: "passed" | "failed";
  jobTimeoutMinutes: number;
  platformOverheadMinutes: number;
  preGate0BudgetMinutes: number;
  gate0OwnerMinutes: number;
  gate0StepTimeoutMinutes: number;
  artifactSafetyMinutes: number;
  artifactUploadMinutes: number;
  requiredExclusiveFloorMinutes: number;
  missingStepTimeouts: string[];
};

export function evaluateAcceptanceLocalNonHdcBudget(
  workflowText: string,
): AcceptanceLocalNonHdcBudgetResult {
  const job = workflowJobBlock(workflowText, "acceptance-local-non-hdc");
  const jobTimeoutMinutes = workflowTimeoutMinutes(job);
  const steps = workflowStepBudgets(job);
  const stepTimeouts = new Map(steps.map((step) => [step.name, step.timeoutMinutes]));
  const gate0Index = steps.findIndex((step) => step.name === ACCEPTANCE_GATE0_STEP);
  const preGate0Steps = gate0Index < 0 ? steps : steps.slice(0, gate0Index);
  const requiredNamedSteps = [
    ...acceptanceLocalNonHdcPreludeSteps,
    ACCEPTANCE_GATE0_STEP,
    ACCEPTANCE_ARTIFACT_SAFETY_STEP,
    ACCEPTANCE_ARTIFACT_UPLOAD_STEP,
  ];
  const missingStepTimeouts = [...new Set([
    ...requiredNamedSteps.filter((step) => (stepTimeouts.get(step) ?? 0) <= 0),
    ...preGate0Steps.filter((step) => step.timeoutMinutes <= 0).map((step) => step.name),
  ])];
  const preGate0BudgetMinutes = preGate0Steps.reduce(
    (total, step) => total + step.timeoutMinutes,
    0,
  );
  const gate0StepTimeoutMinutes = stepTimeouts.get(ACCEPTANCE_GATE0_STEP) ?? 0;
  const artifactSafetyMinutes = stepTimeouts.get(ACCEPTANCE_ARTIFACT_SAFETY_STEP) ?? 0;
  const artifactUploadMinutes = stepTimeouts.get(ACCEPTANCE_ARTIFACT_UPLOAD_STEP) ?? 0;
  const requiredExclusiveFloorMinutes = ACCEPTANCE_LOCAL_NON_HDC_PLATFORM_OVERHEAD_MINUTES
    + preGate0BudgetMinutes
    + ACCEPTANCE_GATE0_OWNER_MINUTES
    + artifactSafetyMinutes
    + artifactUploadMinutes;
  const status = jobTimeoutMinutes > requiredExclusiveFloorMinutes
    && gate0StepTimeoutMinutes > ACCEPTANCE_GATE0_OWNER_MINUTES
    && missingStepTimeouts.length === 0
    ? "passed"
    : "failed";

  return {
    status,
    jobTimeoutMinutes,
    platformOverheadMinutes: ACCEPTANCE_LOCAL_NON_HDC_PLATFORM_OVERHEAD_MINUTES,
    preGate0BudgetMinutes,
    gate0OwnerMinutes: ACCEPTANCE_GATE0_OWNER_MINUTES,
    gate0StepTimeoutMinutes,
    artifactSafetyMinutes,
    artifactUploadMinutes,
    requiredExclusiveFloorMinutes,
    missingStepTimeouts,
  };
}

export type AcceptanceCiConfigurationInput = {
  packageJson: {
    scripts?: Record<string, string>;
  };
  workflowText: string;
  smokeTagCount?: number;
  playwrightSources?: Array<{ path: string; source: string }>;
  acceptanceEnvironmentSources?: Array<{ path: string; source: string }>;
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
  forbiddenPlaywrightImports: string[];
  forbiddenAcceptanceDotenvImports: string[];
  acceptanceEnvironmentHelperCount: number;
  acceptanceEnvironmentGate: boolean;
  localNonHdcBudget: AcceptanceLocalNonHdcBudgetResult;
};

const FORBIDDEN_PLAYWRIGHT_IMPORT = /from\s+["']@playwright\/test["']/;

export function findForbiddenPlaywrightImports(files: Array<{ path: string; source: string }>): string[] {
  return files
    .filter((file) => FORBIDDEN_PLAYWRIGHT_IMPORT.test(file.source))
    .map((file) => file.path)
    .sort();
}

export function readPlaywrightSources(roots = ["e2e/acceptance", "e2e/quality"]): Array<{ path: string; source: string }> {
  return roots.flatMap((root) => listTypeScriptFiles(root)).map((path) => ({
    path,
    source: readFileSync(path, "utf8")
  }));
}

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

export function readAcceptanceEnvironmentSources(
  root = "e2e/acceptance",
): Array<{ path: string; source: string }> {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort()
    .map((name) => {
      const path = join(root, name).replaceAll("\\", "/");
      return { path, source: readFileSync(path, "utf8") };
    })
    .filter(({ source }) => source.includes("dotenv/config") || source.includes("loadAcceptanceEnvironment"));
}

export function readAcceptanceConfigurationSources(
  paths = ["playwright.acceptance.config.ts", "playwright.quality.config.ts"],
): Array<{ path: string; source: string }> {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => ({ path, source: readFileSync(path, "utf8") }));
}

export function findForbiddenAcceptanceDotenvImports(
  files: Array<{ path: string; source: string }>,
): string[] {
  return files
    .filter(({ source }) =>
      /(?:import|require\s*\()[^\n]*["']dotenv\/config["']/.test(source)
      || /\bdotenv\.config\s*\(/.test(source))
    .map(({ path }) => path)
    .sort();
}

export function findAcceptanceEnvironmentHelperLoads(
  files: Array<{ path: string; source: string }>,
): string[] {
  return files
    .filter(({ source }) => /loadAcceptanceEnvironment(?:["']|\s*\(\s*\))/.test(source))
    .map(({ path }) => path)
    .sort();
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
  const forbiddenPlaywrightImports = findForbiddenPlaywrightImports(input.playwrightSources ?? []);
  const acceptanceEnvironmentSources = input.acceptanceEnvironmentSources ?? [];
  const forbiddenAcceptanceDotenvImports = findForbiddenAcceptanceDotenvImports(acceptanceEnvironmentSources);
  const acceptanceEnvironmentHelperCount = findAcceptanceEnvironmentHelperLoads(acceptanceEnvironmentSources).length;
  const acceptanceEnvironmentGate = input.acceptanceEnvironmentSources === undefined
    || (forbiddenAcceptanceDotenvImports.length === 0 && acceptanceEnvironmentHelperCount === 29);
  const localNonHdcBudget = evaluateAcceptanceLocalNonHdcBudget(input.workflowText);

  return {
    status:
      missingScripts.length === 0 &&
      missingWorkflowTokens.length === 0 &&
      missingArtifactPaths.length === 0 &&
      missingSmokeSpecPaths.length === 0 &&
      forbiddenPlaywrightImports.length === 0 &&
      acceptanceEnvironmentGate &&
      localNonHdcBudget.status === "passed" &&
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
    missingSmokeSpecPaths,
    forbiddenPlaywrightImports,
    forbiddenAcceptanceDotenvImports,
    acceptanceEnvironmentHelperCount,
    acceptanceEnvironmentGate,
    localNonHdcBudget,
  };
}

export function runAcceptanceCiConfigurationCheck() {
  if (!existsSync(".github/workflows/ci.yml")) {
    throw new Error("CI workflow not found at .github/workflows/ci.yml.");
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as AcceptanceCiConfigurationInput["packageJson"];
  const workflowText = readFileSync(".github/workflows/ci.yml", "utf8");
  const smokeTagCount = countCiSmokeTags(readAcceptanceSpecSources());
  const result = evaluateAcceptanceCiConfiguration({
    packageJson,
    workflowText,
    smokeTagCount,
    playwrightSources: readPlaywrightSources(),
    acceptanceEnvironmentSources: [
      ...readAcceptanceEnvironmentSources(),
      ...readAcceptanceConfigurationSources(),
    ],
  });

  console.log(JSON.stringify(result, null, 2));
  return result;
}

function listTypeScriptFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return listTypeScriptFiles(path);
    }
    return entry.name.endsWith(".ts") ? [path.replaceAll("\\", "/")] : [];
  });
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

function workflowJobBlock(workflowText: string, jobId: string): string {
  const lines = workflowText.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((line) => line === `  ${jobId}:`);
  if (start < 0) return "";
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [a-zA-Z0-9_-]+:\s*$/.test(lines[index] ?? "")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function workflowTimeoutMinutes(block: string): number {
  const match = block.match(/^    timeout-minutes:\s*(\d+)\s*$/m);
  return match ? Number(match[1]) : 0;
}

function workflowStepBudgets(block: string): Array<{ name: string; timeoutMinutes: number }> {
  const lines = block.split("\n");
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s{6}- (?:name|uses|run):/.test(line));
  return starts.map((start, stepIndex) => {
    const end = starts[stepIndex + 1]?.index ?? lines.length;
    const block = lines.slice(start.index, end).join("\n");
    const nameMatch = start.line.match(/^\s{6}- name:\s*(.+?)\s*$/);
    const timeoutMatch = block.match(/^\s+timeout-minutes:\s*(\d+)\s*$/m);
    return {
      name: nameMatch?.[1] ?? `<unnamed pre-Gate0 step ${stepIndex + 1}>`,
      timeoutMinutes: timeoutMatch ? Number(timeoutMatch[1]) : 0,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCiConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
