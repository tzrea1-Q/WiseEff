import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildBrowserAcceptanceEvidence as buildEvidence,
  type BrowserAcceptanceHdcStatus,
  type BrowserAcceptanceMode,
  type BrowserAcceptanceOperationEvidence,
  type BrowserAcceptanceOverallStatus,
  type BrowserAcceptancePilotOutcome,
  type BrowserAcceptanceRequirementCoverage,
  type BrowserAcceptanceStatus,
  type BrowserAcceptanceWorkflowEvidence
} from "../e2e/acceptance/helpers/evidence";
import { acceptanceOperations } from "../e2e/acceptance/operationMatrix";
import { acceptanceRequirements } from "../e2e/acceptance/requirements";
import { evaluateAcceptanceCoverage, readAcceptanceSpecFiles } from "./check-acceptance-coverage";
import { evaluateOperationMatrix, type OperationMatrixResult } from "./check-acceptance-operation-matrix";
import {
  evaluateOperationEvidence,
  readOperationEvidenceRecords,
  writeOperationEvidenceIndex
} from "./check-operation-evidence";

export { buildBrowserAcceptanceEvidence } from "../e2e/acceptance/helpers/evidence";

type RuntimeEnv = Record<string, string | undefined>;

export type BrowserAcceptanceOptions = {
  mode: BrowserAcceptanceMode;
  envFile: string;
  frontendUrl: string;
  evidenceOut: string;
  skipPreflight: boolean;
  startRuntime: boolean;
  headed: boolean;
};

export type CommandInvocation = {
  command: string;
  args: string[];
  env?: RuntimeEnv;
};

export type BrowserAcceptanceRunResult = {
  status: BrowserAcceptanceOverallStatus;
  blockers: string[];
};

export type BrowserAcceptanceRunInput = {
  mode: BrowserAcceptanceMode;
  preflight: {
    status: BrowserAcceptanceStatus;
    outcome?: BrowserAcceptancePilotOutcome;
    hdc?: BrowserAcceptanceHdcStatus;
  };
  playwright: {
    status: BrowserAcceptanceStatus;
    hdc?: BrowserAcceptanceHdcStatus;
  };
  workflows?: BrowserAcceptanceWorkflowEvidence[];
  requirementCoverage?: BrowserAcceptanceRequirementCoverage;
  operationMatrix?: OperationMatrixResult;
  operationEvidence?: BrowserAcceptanceOperationEvidence;
};

export type DefaultWorkflowInput = {
  playwrightStatus: BrowserAcceptanceStatus;
  hdcStatus: BrowserAcceptanceHdcStatus;
  artifactPath: string;
};

const defaultPreflightEvidenceOut = "test-results/acceptance/preflight-evidence.md";
const defaultEvidenceOut = "docs/generated/acceptance-browser-evidence.md";
const defaultPlaywrightJsonReport = "test-results/acceptance/results.json";
const defaultOperationEvidenceRoot = "test-results/acceptance-operation-evidence";
const defaultOperationEvidenceOut = "docs/generated/acceptance-operation-evidence.md";
const defaultOperationEvidenceJsonOut = "docs/generated/acceptance-operation-evidence/index.json";
const commandMaxBuffer = 64 * 1024 * 1024;
const modes: BrowserAcceptanceMode[] = ["local-non-hdc", "target-non-hdc", "full-pilot"];
const workflowDefinitions: BrowserAcceptanceWorkflowEvidence[] = [
  {
    id: "A",
    name: "Shell navigation and access",
    status: "skipped",
    notes: "Core routes load without visible runtime crashes."
  },
  {
    id: "B",
    name: "Parameter management loop",
    status: "skipped",
    notes: "Parameter browser workflow coverage is reported by Playwright specs."
  },
  {
    id: "C",
    name: "Parameter admin governance",
    status: "skipped",
    notes: "Admin governance and audit drawer coverage is reported by Playwright specs."
  },
  {
    id: "D",
    name: "Log analysis loop",
    status: "skipped",
    notes: "Upload, analysis, evidence, feedback, archive, and unsupported-file coverage."
  },
  {
    id: "E",
    name: "Debugging simulator",
    status: "skipped",
    notes: "Simulator read, write, mismatch, rollback, and audit coverage."
  },
  {
    id: "F",
    name: "HDC device lab",
    status: "skipped",
    notes: "Runs only when DEBUG_DEVICE_GATEWAY_MODE=hdc and HDC_DEVICE_LAB_AVAILABLE=true."
  },
  {
    id: "G",
    name: "Agent collaboration",
    status: "skipped",
    notes: "Agent context, approval dialog, reject, approve, and evidence coverage."
  },
  {
    id: "H",
    name: "Permissions and user governance",
    status: "skipped",
    notes: "Route access and user-permissions governance coverage."
  },
  {
    id: "I",
    name: "Product feedback",
    status: "skipped",
    notes: "Sidebar feedback submission, admin triage, and admin-only access coverage."
  }
];
const workflowSpecs: Record<string, string[]> = {
  A: ["shell-navigation.acceptance.spec.ts"],
  B: ["parameters.acceptance.spec.ts"],
  C: ["parameters.acceptance.spec.ts"],
  D: ["log-analysis.acceptance.spec.ts"],
  E: ["debugging-simulator.acceptance.spec.ts"],
  F: ["hdc-device-lab.acceptance.spec.ts"],
  G: [
    "xiaoze-perception.acceptance.spec.ts",
    "xiaoze-action.acceptance.spec.ts",
    "xiaoze-planning.acceptance.spec.ts"
  ],
  H: ["permissions.acceptance.spec.ts"],
  I: ["product-feedback.acceptance.spec.ts"]
};

export function npmCommand(platform = process.platform) {
  return "npm";
}

export function commandUsesShell(platform = process.platform) {
  return platform === "win32";
}

export function parseBrowserAcceptanceArgs(
  args: readonly string[],
  env: RuntimeEnv = process.env
): BrowserAcceptanceOptions {
  const options: BrowserAcceptanceOptions = {
    mode: parseMode(env.npm_config_mode?.trim() || "local-non-hdc"),
    envFile: env.npm_config_env_file?.trim() || ".env",
    frontendUrl: env.npm_config_frontend_url?.trim() || "http://127.0.0.1:5173",
    evidenceOut: env.npm_config_evidence_out?.trim() || defaultEvidenceOut,
    skipPreflight: parseBoolean(env.npm_config_skip_preflight),
    startRuntime: resolveStartRuntimeFlag(env),
    headed: parseBoolean(env.npm_config_headed)
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === "--mode" && next) {
      options.mode = parseMode(next);
      index += 1;
    } else if (arg.startsWith("--mode=")) {
      options.mode = parseMode(arg.slice("--mode=".length));
    } else if (arg === "--env-file" && next) {
      options.envFile = next;
      index += 1;
    } else if (arg.startsWith("--env-file=")) {
      options.envFile = arg.slice("--env-file=".length);
    } else if (arg === "--frontend-url" && next) {
      options.frontendUrl = next;
      index += 1;
    } else if (arg.startsWith("--frontend-url=")) {
      options.frontendUrl = arg.slice("--frontend-url=".length);
    } else if (arg === "--evidence-out" && next) {
      options.evidenceOut = next;
      index += 1;
    } else if (arg.startsWith("--evidence-out=")) {
      options.evidenceOut = arg.slice("--evidence-out=".length);
    } else if (arg === "--skip-preflight") {
      options.skipPreflight = true;
    } else if (arg === "--no-start-runtime") {
      options.startRuntime = false;
    } else if (arg === "--headed") {
      options.headed = true;
    } else {
      throw new Error(`Unknown or incomplete browser acceptance argument: ${arg}`);
    }
  }

  return options;
}

export function buildPreflightCommand(options: BrowserAcceptanceOptions): CommandInvocation | null {
  if (options.skipPreflight) {
    return null;
  }

  const args = [
    "run",
    "acceptance:preflight",
    "--",
    "--env-file",
    options.envFile,
    "--frontend-url",
    options.frontendUrl,
    "--evidence-out",
    defaultPreflightEvidenceOut
  ];

  if (options.mode === "full-pilot") {
    args.push("--require-pilot-ready");
  }

  if (options.mode === "target-non-hdc" || !options.startRuntime) {
    args.push("--no-start-runtime");
  }

  return {
    command: npmCommand(),
    args,
    ...(options.mode === "local-non-hdc"
      ? {
          env: {
            DEBUG_DEVICE_GATEWAY_MODE: "simulator",
            HDC_DEVICE_LAB_AVAILABLE: "false",
            DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION: "true"
          }
        }
      : {})
  };
}

export function loadEnvContent(content: string, baseEnv: RuntimeEnv = process.env): RuntimeEnv {
  const env: RuntimeEnv = { ...baseEnv };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    const key = line.slice(0, separatorIndex).trim();
    if (!key || Object.prototype.hasOwnProperty.call(env, key)) {
      continue;
    }

    env[key] = unquoteEnvValue(line.slice(separatorIndex + 1).trim());
  }

  return env;
}

export function buildBrowserAcceptanceCommand(
  options: BrowserAcceptanceOptions,
  loadedEnv: RuntimeEnv = process.env
): CommandInvocation {
  const args = ["run", "acceptance:e2e", "--"];

  if (options.headed) {
    args.push("--headed");
  }

  return { command: npmCommand(), args, env: buildPlaywrightEnv(options, loadedEnv) };
}

export function buildPlaywrightEnv(options: BrowserAcceptanceOptions, loadedEnv: RuntimeEnv = process.env): RuntimeEnv {
  const env: RuntimeEnv = { ...loadedEnv };
  env.WISEEFF_ACCEPTANCE_FRONTEND_URL = options.frontendUrl;

  if (options.mode === "local-non-hdc") {
    env.DEBUG_DEVICE_GATEWAY_MODE = "simulator";
    env.HDC_DEVICE_LAB_AVAILABLE = "false";
    env.DEVICE_GATEWAY_ALLOW_SIMULATOR_IN_PRODUCTION = "true";
  }

  if (options.mode === "target-non-hdc" || !options.startRuntime || !options.skipPreflight) {
    env.WISEEFF_ACCEPTANCE_NO_START_RUNTIME = "true";
  }

  return env;
}

export function resolvePlaywrightHdcStatus(env: RuntimeEnv): BrowserAcceptanceHdcStatus {
  return env.DEBUG_DEVICE_GATEWAY_MODE === "hdc" && env.HDC_DEVICE_LAB_AVAILABLE === "true" ? "ready" : "skipped";
}

export function evaluateBrowserAcceptanceRun(input: BrowserAcceptanceRunInput): BrowserAcceptanceRunResult {
  const blockers: string[] = [];
  const preflightOutcome = input.preflight.outcome ?? "unknown";
  const hdc = input.preflight.hdc ?? "absent";
  const playwrightHdc = input.playwright.hdc ?? "unknown";

  if (input.playwright.status !== "passed") {
    blockers.push("Playwright acceptance did not pass.");
  }

  for (const workflow of input.workflows ?? []) {
    if (workflow.id === "F" && input.mode !== "full-pilot") {
      continue;
    }

    if (workflow.status !== "passed") {
      blockers.push(`Workflow ${workflow.id ?? workflow.name} did not pass browser acceptance.`);
    }
  }

  if (input.requirementCoverage?.status === "failed") {
    if (input.requirementCoverage.missingRequiredIds.length > 0) {
      blockers.push(
        `Acceptance requirement coverage is missing required IDs: ${input.requirementCoverage.missingRequiredIds.join(", ")}.`
      );
    }
    if (input.requirementCoverage.unknownIds.length > 0) {
      blockers.push(
        `Acceptance requirement coverage references unknown IDs: ${input.requirementCoverage.unknownIds.join(", ")}.`
      );
    }
  }

  if (input.operationMatrix?.status === "failed") {
    if (input.operationMatrix.missingAutomatedOperationIds.length > 0) {
      blockers.push(
        `Operation matrix is missing automated operation markers: ${input.operationMatrix.missingAutomatedOperationIds.join(", ")}.`
      );
    }
    if (input.operationMatrix.deferredOperationIdsMissingReason.length > 0) {
      blockers.push(
        `Operation matrix has deferred operation IDs without reasons: ${input.operationMatrix.deferredOperationIdsMissingReason.join(", ")}.`
      );
    }
    if (input.operationMatrix.operationsMissingAssertions.length > 0) {
      blockers.push(
        `Operation matrix operations are missing assertions: ${input.operationMatrix.operationsMissingAssertions.join(", ")}.`
      );
    }
    if (input.operationMatrix.unknownOperationIds.length > 0) {
      blockers.push(`Operation matrix references unknown operation IDs: ${input.operationMatrix.unknownOperationIds.join(", ")}.`);
    }
    if (input.operationMatrix.unknownAcceptanceIds.length > 0) {
      blockers.push(
        `Operation matrix references unknown acceptance IDs: ${input.operationMatrix.unknownAcceptanceIds.join(", ")}.`
      );
    }
  }

  if (input.operationEvidence?.status === "failed" && input.operationEvidence.missingOperationIds.length > 0) {
    blockers.push(`Operation evidence is missing required IDs: ${input.operationEvidence.missingOperationIds.join(", ")}.`);
  }
  if (input.operationEvidence?.status === "failed" && input.operationEvidence.invalidEvidenceIds.length > 0) {
    blockers.push(
      `Operation evidence records are missing review or forensic metadata: ${input.operationEvidence.invalidEvidenceIds.join(", ")}.`
    );
  }

  if (input.preflight.status !== "passed") {
    blockers.push("Acceptance preflight did not pass.");
  }

  if (input.mode === "local-non-hdc") {
    if (!["pilot_ready", "non_hdc_local"].includes(preflightOutcome)) {
      blockers.push("Local non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.");
    }

    if (!["skipped", "absent"].includes(hdc)) {
      blockers.push("Local non-HDC mode requires HDC to be skipped or absent.");
    }
  }

  if (input.mode === "target-non-hdc") {
    if (!["pilot_ready", "non_hdc_local"].includes(preflightOutcome)) {
      blockers.push("Target non-HDC mode requires pilot_ready or non_hdc_local preflight outcome.");
    }

    if (!["skipped", "absent"].includes(hdc)) {
      blockers.push("Target non-HDC mode requires HDC to be explicitly skipped or absent.");
    }
  }

  if (input.mode === "full-pilot") {
    if (preflightOutcome !== "pilot_ready") {
      blockers.push("Full pilot mode requires pilot_ready preflight outcome.");
    }

    if (hdc !== "ready") {
      blockers.push("Full pilot mode requires HDC to be ready.");
    }

    if (playwrightHdc !== "ready") {
      blockers.push("Full pilot mode requires Playwright HDC browser specs to be ready.");
    }
  }

  return { status: blockers.length > 0 ? "failed" : "passed", blockers };
}

export function buildDefaultBrowserAcceptanceWorkflows(input: DefaultWorkflowInput): BrowserAcceptanceWorkflowEvidence[] {
  const artifact = [input.artifactPath];
  const hdcWorkflowStatus: BrowserAcceptanceStatus = input.hdcStatus === "ready" ? input.playwrightStatus : "skipped";

  return workflowDefinitions.map((workflow) => ({
    ...workflow,
    status: workflow.id === "F" ? hdcWorkflowStatus : input.playwrightStatus,
    artifacts: artifact
  }));
}

export function deriveBrowserAcceptanceWorkflowsFromPlaywrightReport(
  report: unknown,
  artifactPath: string
): BrowserAcceptanceWorkflowEvidence[] {
  const specStatuses = collectSpecStatuses(report);

  return workflowDefinitions.map((workflow) => {
    const specFiles = workflow.id ? workflowSpecs[workflow.id] ?? [] : [];
    const statuses = specFiles.flatMap((specFile) => specStatuses.get(specFile) ?? []);
    const status = summarizeStatuses(statuses);

    return {
      ...workflow,
      status,
      artifacts: [artifactPath]
    };
  });
}

async function main() {
  const options = parseBrowserAcceptanceArgs(process.argv.slice(2));
  const loadedEnv = loadEnvFile(options.envFile, process.env);
  const preflightCommand = buildPreflightCommand(options);
  const preflight = preflightCommand
    ? runPreflight(preflightCommand)
    : {
        status: "skipped" as const,
        outcome: "unknown" as const,
        hdc: "unknown" as const,
        artifactPath: defaultPreflightEvidenceOut,
        detail: "--skip-preflight was provided."
      };

  const playwrightCommand = buildBrowserAcceptanceCommand(options, loadedEnv);
  clearOperationEvidenceRecords();
  const playwright = runPlaywright(playwrightCommand);
  const workflows = readBrowserAcceptanceWorkflows(defaultPlaywrightJsonReport, {
    playwrightStatus: playwright.status,
    hdcStatus: playwright.hdc,
    artifactPath: playwright.artifactPath
  });
  const requirementCoverage = evaluateAcceptanceCoverage({
    requirements: acceptanceRequirements,
    specFiles: readAcceptanceSpecFiles()
  });
  const operationMatrix = evaluateOperationMatrix({
    operations: acceptanceOperations,
    specFiles: readAcceptanceSpecFiles(),
    knownAcceptanceIds: acceptanceRequirements.map((requirement) => requirement.id)
  });
  const operationEvidence = evaluateOperationEvidence({
    operations: acceptanceOperations,
    records: readOperationEvidenceRecords(defaultOperationEvidenceRoot)
  });
  writeOperationEvidenceIndex({
    evaluation: operationEvidence,
    markdownOut: defaultOperationEvidenceOut,
    jsonOut: defaultOperationEvidenceJsonOut
  });
  const evaluation = evaluateBrowserAcceptanceRun({
    mode: options.mode,
    preflight,
    playwright,
    workflows,
    requirementCoverage,
    operationMatrix,
    operationEvidence
  });
  const evidence = buildEvidence({
    date: new Date().toISOString(),
    metadata: getGitMetadata(),
    mode: options.mode,
    status: evaluation.status,
    preflight,
    playwright,
    workflows,
    requirementCoverage,
    operationEvidence,
    artifactPaths: [
      defaultPreflightEvidenceOut,
      defaultPlaywrightJsonReport,
      "test-results/acceptance",
      "playwright-report/acceptance",
      defaultOperationEvidenceOut,
      defaultOperationEvidenceJsonOut
    ],
    blockers: evaluation.blockers
  });

  mkdirSync(dirname(options.evidenceOut), { recursive: true });
  writeFileSync(options.evidenceOut, evidence, "utf8");
  console.log(evidence);
  process.exit(evaluation.status === "passed" ? 0 : 1);
}

function clearOperationEvidenceRecords(root = defaultOperationEvidenceRoot) {
  rmSync(root, { recursive: true, force: true });
}

function runPreflight(command: CommandInvocation) {
  const result = runCommand(command);
  const evidence = readPreflightEvidence(defaultPreflightEvidenceOut);
  const outcome = evidence.outcome;
  const hdc: BrowserAcceptanceHdcStatus =
    outcome === "pilot_ready" ? "ready" : outcome === "non_hdc_local" ? "skipped" : "unknown";

  return {
    status: commandStatus(result),
    outcome,
    hdc,
    artifactPath: defaultPreflightEvidenceOut,
    detail: commandDetail(result)
  };
}

function runPlaywright(command: CommandInvocation) {
  const result = runCommand(command);

  return {
    status: commandStatus(result),
    hdc: resolvePlaywrightHdcStatus(command.env ?? process.env),
    artifactPath: "playwright-report/acceptance/index.html",
    detail: commandDetail(result)
  };
}

function readBrowserAcceptanceWorkflows(reportPath: string, fallback: DefaultWorkflowInput) {
  if (!existsSync(reportPath)) {
    return buildDefaultBrowserAcceptanceWorkflows(fallback);
  }

  try {
    return deriveBrowserAcceptanceWorkflowsFromPlaywrightReport(JSON.parse(readFileSync(reportPath, "utf8")), fallback.artifactPath);
  } catch {
    return buildDefaultBrowserAcceptanceWorkflows(fallback);
  }
}

function runCommand(command: CommandInvocation) {
  const result = spawnSync(command.command, command.args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: command.env ? { ...process.env, ...command.env } : process.env,
    maxBuffer: commandMaxBuffer,
    shell: commandUsesShell()
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  return result;
}

function commandStatus(result: SpawnSyncReturns<string>): BrowserAcceptanceStatus {
  return result.error || result.status !== 0 ? "failed" : "passed";
}

function commandDetail(result: SpawnSyncReturns<string>) {
  if (result.error) {
    return result.error.message;
  }

  if (result.status !== 0) {
    return [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `Exited with status ${result.status}.`;
  }

  return "ok";
}

function readPreflightEvidence(path: string): { outcome: BrowserAcceptancePilotOutcome } {
  try {
    const content = readFileSync(path, "utf8");
    const outcome = /Pilot outcome:\s*`([^`]+)`/.exec(content)?.[1];

    return { outcome: parsePilotOutcome(outcome ?? "unknown") };
  } catch {
    return { outcome: "unknown" };
  }
}

function loadEnvFile(envFile: string, baseEnv: RuntimeEnv): RuntimeEnv {
  return loadEnvContent(readFileSync(envFile, "utf8"), baseEnv);
}

function parseMode(value: string): BrowserAcceptanceMode {
  if (modes.includes(value as BrowserAcceptanceMode)) {
    return value as BrowserAcceptanceMode;
  }

  throw new Error(`Unsupported browser acceptance mode: ${value}`);
}

function parsePilotOutcome(value: string): BrowserAcceptancePilotOutcome {
  if (["pilot_ready", "non_hdc_local", "blocked"].includes(value)) {
    return value as BrowserAcceptancePilotOutcome;
  }

  return "unknown";
}

type PlaywrightSuite = {
  file?: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
};

type PlaywrightSpec = {
  tests?: Array<{ results?: Array<{ status?: string }> }>;
};

function collectSpecStatuses(report: unknown) {
  const statuses = new Map<string, BrowserAcceptanceStatus[]>();

  function visitSuite(value: unknown) {
    if (!isRecord(value)) {
      return;
    }

    const suite = value as PlaywrightSuite;
    const fileName = typeof suite.file === "string" ? normalizeSpecFile(suite.file) : undefined;
    if (fileName && Array.isArray(suite.specs)) {
      for (const spec of suite.specs) {
        for (const status of collectStatusesFromSpec(spec)) {
          statuses.set(fileName, [...(statuses.get(fileName) ?? []), status]);
        }
      }
    }

    if (Array.isArray(suite.suites)) {
      for (const child of suite.suites) {
        visitSuite(child);
      }
    }
  }

  if (isRecord(report) && Array.isArray(report.suites)) {
    for (const suite of report.suites) {
      visitSuite(suite);
    }
  }

  return statuses;
}

function collectStatusesFromSpec(spec: PlaywrightSpec) {
  const statuses: BrowserAcceptanceStatus[] = [];
  for (const test of spec.tests ?? []) {
    for (const result of test.results ?? []) {
      statuses.push(mapPlaywrightResultStatus(result.status));
    }
  }

  return statuses;
}

function summarizeStatuses(statuses: BrowserAcceptanceStatus[]): BrowserAcceptanceStatus {
  if (statuses.length === 0) {
    return "skipped";
  }

  if (statuses.includes("failed")) {
    return "failed";
  }

  if (statuses.includes("skipped")) {
    return "skipped";
  }

  return "passed";
}

function mapPlaywrightResultStatus(status: string | undefined): BrowserAcceptanceStatus {
  if (status === "passed") {
    return "passed";
  }

  if (status === "skipped") {
    return "skipped";
  }

  return "failed";
}

function normalizeSpecFile(value: string) {
  return value.replace(/\\/g, "/").split("/").at(-1) ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseBoolean(value: string | undefined) {
  return value?.trim() === "true";
}

function resolveStartRuntimeFlag(env: RuntimeEnv) {
  if (parseBoolean(env.npm_config_no_start_runtime)) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(env, "npm_config_start_runtime")) {
    return env.npm_config_start_runtime?.trim() === "true";
  }

  return true;
}

function getGitMetadata() {
  return {
    branch: captureGit(["branch", "--show-current"]) || "unknown",
    commit: captureGit(["rev-parse", "HEAD"]) || "unknown",
    dirty: captureGit(["status", "--short"]).length > 0
  };
}

function captureGit(args: string[]) {
  const result = spawnSync("git", args, { encoding: "utf8", maxBuffer: commandMaxBuffer });
  return result.status === 0 ? result.stdout.trim() : "";
}

function unquoteEnvValue(value: string) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
