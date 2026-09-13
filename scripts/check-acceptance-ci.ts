import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { l1CommandIds, l1Jobs } from "./ci-required-results";

export const requiredAcceptanceCiScripts = [
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
  "npm run acceptance:artifacts:finalize -- --root test-results/acceptance-runtime-runs --output test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip",
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
  "test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip"
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
  const postGate0Steps = gate0Index < 0 ? [] : steps.slice(gate0Index + 1);
  const requiredNamedSteps = [
    ...acceptanceLocalNonHdcPreludeSteps,
    ACCEPTANCE_GATE0_STEP,
    ACCEPTANCE_ARTIFACT_SAFETY_STEP,
    ACCEPTANCE_ARTIFACT_UPLOAD_STEP,
  ];
  const missingStepTimeouts = [...new Set([
    ...requiredNamedSteps.filter((step) => (stepTimeouts.get(step) ?? 0) <= 0),
    ...preGate0Steps.filter((step) => step.timeoutMinutes <= 0).map((step) => step.name),
    ...postGate0Steps.filter((step) => step.timeoutMinutes <= 0).map((step) => step.name),
  ])];
  const preGate0BudgetMinutes = preGate0Steps.reduce(
    (total, step) => total + step.timeoutMinutes,
    0,
  );
  const gate0StepTimeoutMinutes = stepTimeouts.get(ACCEPTANCE_GATE0_STEP) ?? 0;
  const artifactSafetyMinutes = stepTimeouts.get(ACCEPTANCE_ARTIFACT_SAFETY_STEP) ?? 0;
  const artifactUploadMinutes = stepTimeouts.get(ACCEPTANCE_ARTIFACT_UPLOAD_STEP) ?? 0;
  const postGate0BudgetMinutes = postGate0Steps.reduce(
    (total, step) => total + step.timeoutMinutes,
    0,
  );
  const requiredExclusiveFloorMinutes = ACCEPTANCE_LOCAL_NON_HDC_PLATFORM_OVERHEAD_MINUTES
    + preGate0BudgetMinutes
    + ACCEPTANCE_GATE0_OWNER_MINUTES
    + postGate0BudgetMinutes;
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
  immutableUploadContract: ImmutableUploadContractResult;
};

export type ImmutableUploadContractResult = {
  status: "passed" | "failed";
  errors: string[];
};

export function evaluateImmutableAcceptanceUpload(workflowText: string): ImmutableUploadContractResult {
  const errors: string[] = [];
  let workflow: {
    jobs?: Record<string, { steps?: Array<Record<string, unknown>> }>;
  };
  try {
    workflow = YAML.parse(workflowText) as typeof workflow;
  } catch {
    return { status: "failed", errors: ["CI workflow YAML is malformed."] };
  }
  const steps = workflow.jobs?.["acceptance-local-non-hdc"]?.steps;
  if (!Array.isArray(steps)) return { status: "failed", errors: ["Acceptance local non-HDC steps are missing."] };
  const safety = steps.find((step) => step.name === ACCEPTANCE_ARTIFACT_SAFETY_STEP);
  const uploads = steps.filter((step) => step.uses === "actions/upload-artifact@v4");
  const upload = uploads.find((step) => step.name === ACCEPTANCE_ARTIFACT_UPLOAD_STEP);
  const archivePath = "test-results/acceptance-runtime-upload/wiseeff-acceptance-local-non-hdc.zip";
  const finalizerCommand = `npm run acceptance:artifacts:finalize -- --root test-results/acceptance-runtime-runs --output ${archivePath}`;
  if (!safety) errors.push("Acceptance artifact safety step is missing.");
  else {
    if (safety.id !== "acceptance_artifact_safety") errors.push("Acceptance artifact safety step id is invalid.");
    if (safety.if !== "always()") errors.push("Acceptance artifact safety must run with if: always().");
    if (safety.run !== finalizerCommand) errors.push("Acceptance artifact safety must run the exact immutable archive finalizer.");
    if (safety["continue-on-error"] === true) errors.push("Acceptance artifact safety cannot continue on error.");
  }
  if (uploads.length !== 1) errors.push("Acceptance local non-HDC must contain exactly one upload-artifact step.");
  if (!upload) errors.push("Acceptance evidence upload step is missing.");
  else {
    if (upload.if !== "always() && steps.acceptance_artifact_safety.outcome == 'success'") {
      errors.push("Acceptance evidence upload must depend only on successful immutable artifact safety.");
    }
    if (upload["continue-on-error"] === true) errors.push("Acceptance evidence upload cannot continue on error.");
    const withInput = upload.with as Record<string, unknown> | undefined;
    if (withInput?.path !== archivePath) errors.push("Acceptance evidence upload must name the exact immutable ZIP archive.");
    if (withInput?.["if-no-files-found"] !== "error") errors.push("Acceptance evidence upload must fail when the archive is absent.");
    if (Number(withInput?.["compression-level"]) !== 0) errors.push("Acceptance evidence upload must not recompress the frozen ZIP.");
  }
  return { status: errors.length === 0 ? "passed" : "failed", errors };
}

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
    || (forbiddenAcceptanceDotenvImports.length === 0 && acceptanceEnvironmentHelperCount === 34);
  const localNonHdcBudget = evaluateAcceptanceLocalNonHdcBudget(input.workflowText);
  const immutableUploadContract = evaluateImmutableAcceptanceUpload(input.workflowText);

  return {
    status:
      missingScripts.length === 0 &&
      missingWorkflowTokens.length === 0 &&
      missingArtifactPaths.length === 0 &&
      missingSmokeSpecPaths.length === 0 &&
      forbiddenPlaywrightImports.length === 0 &&
      acceptanceEnvironmentGate &&
      localNonHdcBudget.status === "passed" &&
      immutableUploadContract.status === "passed" &&
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
    immutableUploadContract,
  };
}

export function runAcceptanceCiConfigurationCheck() {
  if (!existsSync(".github/workflows/ci.yml")) {
    throw new Error("CI workflow not found at .github/workflows/ci.yml.");
  }

  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as AcceptanceCiConfigurationInput["packageJson"];
  const workflowText = readFileSync(".github/workflows/ci.yml", "utf8");
  const smokeTagCount = countCiSmokeTags(readAcceptanceSpecSources());
  const configuration = evaluateAcceptanceCiConfiguration({
    packageJson,
    workflowText,
    smokeTagCount,
    playwrightSources: readPlaywrightSources(),
    acceptanceEnvironmentSources: [
      ...readAcceptanceEnvironmentSources(),
      ...readAcceptanceConfigurationSources(),
    ],
  });
  const l1Equivalence = evaluateL1CiWorkflow(workflowText);
  const result = { ...configuration, l1Equivalence,
    status: configuration.status === "passed" && l1Equivalence.status === "passed" ? "passed" : "failed" };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export function evaluateL1CiWorkflow(workflowText: string): { status: "passed" | "failed"; errors: string[] } {
  const errors: string[] = [];
  type Step = { id?: string; name?: string; run?: string; uses?: string; if?: string; "continue-on-error"?: boolean;
    with?: Record<string, unknown>; env?: Record<string, unknown> };
  type Job = { name?: string; needs?: string | string[]; if?: string; "runs-on"?: string; steps?: Step[];
    "continue-on-error"?: boolean; "timeout-minutes"?: number;
    outputs?: Record<string, string>; services?: Record<string, { image?: string }>; env?: Record<string, string> };
  let workflow: { jobs: Record<string, Job>; env?: Record<string, string> };
  try { workflow = YAML.parse(workflowText) as typeof workflow; }
  catch { return { status: "failed", errors: ["Malformed L1 workflow."] }; }
  const jobs = workflow?.jobs;
  const check = (valid: unknown, message: string) => { if (!valid) errors.push(message); };
  const cli = "node --experimental-strip-types scripts/ci-required-results.ts";
  const identityEnvironment = {
    EFF_BASE_SHA: "${{ github.event.pull_request.base.sha }}", EFF_HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
    EFF_MODE: "${{ inputs.acceptance_mode }}",
    EFF_FULL_ACCEPTANCE: "${{ github.event_name == 'pull_request' && contains(github.event.pull_request.labels.*.name, 'full-acceptance') }}",
  };
  for (const [key, expression] of Object.entries(identityEnvironment)) check(workflow?.env?.[key] === expression, `L1 identity field ${key} must come from workflow context.`);
  const commands: Record<string, string> = {
    install: "npm ci", metadata: "npm run acceptance:ci", build: "npm run build", docs: "npm run docs:check",
    ui: "npm run ui:check", lint: "npm run lint", contract: "npm run contract:check", logs: "npm run logs:eval",
    advisory: "npm run dtc:seed:compile", receipt: `${cli} receipt`,
    ...Object.fromEntries(["frontend", "scripts", "bridge", "server"].map((id) => [id, `${cli} test ${id}`])),
  };
  const vectorCommand = `node --input-type=module -e '
  import pg from "pg";
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("create extension if not exists vector");
  const row = await client.query(
    "select extname from pg_extension where extname = $1",
    ["vector"],
  );
  if (row.rowCount !== 1) {
    throw new Error("pgvector extension was not created");
  }
  await client.end();
'`;
  const trustedBase = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
  const catalogCommand = 'set -euo pipefail\ngit fetch --no-tags origin "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}"\ntest "$(git rev-parse --verify "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}^{commit}")" = "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}"\nnpm run parameter-catalog-boundaries:check -- --trusted-base-sha "${PARAMETER_CATALOG_TRUSTED_BASE_SHA}"';
  for (const id of l1Jobs) {
    const job = jobs?.[id];
    if (!job) { errors.push(`Missing ${id}.`); continue; }
    check(job.needs === "detect" && job.if === "needs.detect.outputs.run_l1 == 'true'", `${id} must retain fixed L1 selection.`);
    check(job["runs-on"] === "ubuntu-latest", `${id} must retain the runner platform.`);
    check(job["continue-on-error"] === undefined && job["timeout-minutes"] === 20, `${id} must retain timeout and strict job failure semantics.`);
    const steps = job.steps ?? [];
    check(JSON.stringify(steps.map((step) => step.id)) === JSON.stringify([...l1CommandIds[id], "receipt"]), `${id} lost, reordered, or added an unmapped command.`);
    for (const step of steps) {
      check(step["continue-on-error"] === (step.id === "advisory" ? true : undefined), `${id}/${step.id} changed failure semantics.`);
      check(step.if === (step.id === "receipt" ? "always()" : undefined), `${id}/${step.id} changed execution conditions.`);
      if (step.id && commands[step.id]) check(step.run === commands[step.id], `${id}/${step.id} changed the original command.`);
    }
    const step = (key: string) => steps.find((item) => item.id === key);
    check(step("checkout")?.uses === "actions/checkout@v4" && step("checkout")?.with?.["fetch-depth"] === 0, `${id} needs full checkout history.`);
    check(step("node")?.uses === "actions/setup-node@v4" && step("node")?.with?.["node-version-file"] === ".nvmrc"
      && step("node")?.with?.cache === "npm", `${id} needs existing Node/npm setup.`);
    check(step("receipt")?.env?.EFF_STEPS === "${{ toJSON(steps) }}" && job.outputs?.receipt === "${{ steps.receipt.outputs.receipt }}", `${id} must publish its invocation receipt.`);
    if (id === "l1-scripts" || id === "l1-server") {
      check(job.services?.postgres?.image === "pgvector/pgvector:pg16" && job.env?.DATABASE_URL === "postgres://wiseeff:wiseeff@127.0.0.1:5432/wiseeff", `${id} requires the real PG/vector service.`);
      check(step("toolchain")?.uses === "./.github/actions/setup-dts-toolchain", `${id} requires verified DTS tooling.`);
      check(step("vector")?.run?.trim() === vectorCommand, `${id} requires the original vector create/read assertion.`);
    }
    if (id === "l1-static") {
      check(step("catalog")?.env?.PARAMETER_CATALOG_TRUSTED_BASE_SHA === trustedBase && step("catalog")?.run?.trim() === catalogCommand, "Static trusted-base ratchet changed.");
      check(step("eslint_cache")?.uses === "actions/cache@v4" && step("eslint_cache")?.with?.path === "node_modules/.cache/eslint", "ESLint cache must be retained.");
    }
  }
  const gateNeeds = {
    "build-and-test": ["detect", ...l1Jobs],
    required: ["detect", "build-and-test", "acceptance-quality", "acceptance-smoke", "acceptance-local-non-hdc", "target-synthetic-acceptance", "minimal-upgrade"],
  };
  for (const [id, needs] of Object.entries(gateNeeds)) {
    const job = jobs?.[id];
    const steps = job?.steps ?? [];
    check(job?.if === "always()" && job?.name === (id === "required" ? "Merge bar" : "Build and test"), `${id} stable gate must always run.`);
    check(job?.["continue-on-error"] === undefined && job?.["timeout-minutes"] === 5, `${id} must retain timeout and strict job failure semantics.`);
    check(JSON.stringify(job?.needs) === JSON.stringify(needs), `${id} has missing or unmapped dependencies.`);
    check(steps.length === 3 && steps[0]?.uses === "actions/checkout@v4" && steps[1]?.uses === "actions/setup-node@v4"
      && steps[1]?.with?.["node-version-file"] === ".nvmrc" && steps[2]?.run === `${cli} ${id === "required" ? "required" : "l1"}`
      && steps[2]?.env?.EFF_NEEDS === "${{ toJSON(needs) }}" && steps.every((step) => step.if === undefined && step["continue-on-error"] === undefined), `${id} must validate exact results without npm installation or failure suppression.`);
  }
  check(jobs?.["build-and-test"]?.outputs?.identity === "${{ steps.results.outputs.identity }}", "Build and test must publish its verified execution identity.");
  return { status: errors.length ? "failed" : "passed", errors };
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
    .filter(({ line }) => /^\s{6}-\s+\S/u.test(line));
  return starts.map((start, stepIndex) => {
    const end = starts[stepIndex + 1]?.index ?? lines.length;
    const block = lines.slice(start.index, end).join("\n");
    const nameMatch = block.match(/^\s{6}-\s+name:\s*(.+?)\s*$|^\s{8}name:\s*(.+?)\s*$/m);
    const timeoutMatch = block.match(/^\s+timeout-minutes:\s*(\d+)\s*$/m);
    return {
      name: nameMatch?.[1] ?? nameMatch?.[2] ?? `<unnamed workflow step ${stepIndex + 1}>`,
      timeoutMinutes: timeoutMatch ? Number(timeoutMatch[1]) : 0,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = runAcceptanceCiConfigurationCheck();
  process.exit(result.status === "passed" ? 0 : 1);
}
