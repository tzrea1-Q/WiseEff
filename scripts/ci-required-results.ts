import path from "node:path";
import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

type RecordValue = Record<string, unknown>;
export type Identity = {
  event: string; mode: string; fullAcceptance: boolean; ref: string;
  base: string; head: string; sha: string; tree: string; runId: string; attempt: string;
};
export type NativeSummary = {
  version: 1; command: string; identity: Identity; passed: number; skipped: number; files: number;
  optionalSkips: Record<string, number>; sha256: string; filesSha256: string;
};
export const shadowModuleIds = ["feedback-client", "feedback-domain", "feedback-server", "feedback-ui"] as const;
export const l1Jobs = ["l1-static", "l1-frontend", "l1-scripts", "l1-server"] as const;
export const l1CommandIds: Record<string, readonly string[]> = {
  "l1-static": ["checkout", "node", "install", "eslint_cache", "metadata", "build", "ui", "lint", "catalog", "contract", "logs"],
  "l1-frontend": ["checkout", "node", "install", "frontend"],
  "l1-scripts": ["checkout", "node", "install", "toolchain", "advisory", "vector", "scripts", "bridge"],
  "l1-server": ["checkout", "node", "install", "toolchain", "vector", "docs", "server"],
};
const testCommands: Record<string, { job: string; args: string[]; config?: string }> = {
  frontend: { job: "l1-frontend", args: ["test"] },
  scripts: { job: "l1-scripts", args: ["run", "test:scripts"], config: "vitest.scripts.config.ts" },
  bridge: { job: "l1-scripts", args: ["run", "bridge:test"], config: "vitest.bridge.config.ts" },
  server: { job: "l1-server", args: ["run", "test:server"], config: "vitest.server.config.ts" },
};
const flagNames = ["docs_only", "run_l1", "run_quality", "run_smoke", "run_l2"];

function requireCi(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(`CI_${code}`);
}
function record(value: unknown): RecordValue {
  requireCi(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_OBJECT");
  return value as RecordValue;
}
function exactKeys(value: RecordValue, keys: readonly string[]) {
  requireCi(Object.keys(value).sort().join(",") === [...keys].sort().join(","), "UNMAPPED_FIELDS");
}
export function readIdentity(value: unknown): Identity {
  const item = record(value);
  exactKeys(item, ["event", "mode", "fullAcceptance", "ref", "base", "head", "sha", "tree", "runId", "attempt"]);
  for (const key of ["sha", "tree"]) requireCi(typeof item[key] === "string" && /^[a-f0-9]{40}$/.test(item[key] as string), "IDENTITY_SHA");
  for (const key of ["runId", "attempt"]) requireCi(typeof item[key] === "string" && /^[1-9][0-9]{0,19}$/.test(item[key] as string), "IDENTITY_RUN");
  requireCi(typeof item.fullAcceptance === "boolean" && typeof item.ref === "string", "IDENTITY_EVENT");
  requireCi(["pull_request", "push", "schedule", "workflow_dispatch"].includes(String(item.event)), "UNKNOWN_EVENT");
  if (item.event === "pull_request") {
    for (const key of ["base", "head"]) requireCi(typeof item[key] === "string" && /^[a-f0-9]{40}$/.test(item[key] as string), "IDENTITY_PR");
  } else {
    requireCi(item.base === "" && item.head === "" && item.fullAcceptance === false, "IDENTITY_NON_PR");
  }
  if (item.event === "push" || item.event === "schedule") requireCi(item.ref === "refs/heads/main", "UNKNOWN_REF");
  if (item.event === "workflow_dispatch") requireCi(["local-non-hdc", "target-non-hdc", "full-pilot", "minimal-upgrade"].includes(String(item.mode)), "UNKNOWN_MODE");
  else requireCi(item.mode === "", "UNEXPECTED_MODE");
  return item as Identity;
}
function flagsFor(identity: Identity, needs: RecordValue): Record<string, boolean> {
  const detect = record(needs.detect);
  requireCi(detect.result === "success", "DETECT_FAILED");
  const outputs = record(detect.outputs);
  exactKeys(outputs, flagNames);
  for (const value of Object.values(outputs)) requireCi(value === "true" || value === "false", "UNKNOWN_FLAG");
  const flags = Object.fromEntries(flagNames.map((name) => [name, outputs[name] === "true"]));
  if (identity.event === "pull_request") {
    requireCi(flags.run_l1 !== flags.docs_only && flags.run_l2 === identity.fullAcceptance, "PR_FLAGS");
    if (flags.docs_only) requireCi(!flags.run_smoke && flags.run_quality === identity.fullAcceptance, "DOC_FLAGS");
    else requireCi(flags.run_quality || flags.run_smoke, "PR_FLAGS");
    if (identity.fullAcceptance) requireCi(flags.run_quality, "LABEL_FLAGS");
  } else {
    const local = identity.event !== "workflow_dispatch" || identity.mode === "local-non-hdc";
    requireCi(!flags.docs_only && flags.run_l1 === (identity.event !== "workflow_dispatch") && !flags.run_smoke
      && flags.run_quality === local && flags.run_l2 === local, "EVENT_FLAGS");
  }
  return flags;
}
function assertJobs(needs: RecordValue, expected: Record<string, boolean>) {
  exactKeys(needs, Object.keys(expected));
  for (const [job, selected] of Object.entries(expected)) {
    const result = record(needs[job]).result;
    requireCi(result === "success" || (!selected && result === "skipped"), "REQUIRED_RESULT");
  }
}
export function assertRequiredResults(input: unknown): void {
  const value = record(input);
  const identity = readIdentity(value.identity);
  const needs = record(value.needs);
  const flags = flagsFor(identity, needs);
  assertJobs(needs, {
    detect: true, "build-and-test": true,
    "acceptance-quality": flags.run_quality, "acceptance-smoke": flags.run_smoke,
    "acceptance-local-non-hdc": flags.run_l2,
    "target-synthetic-acceptance": identity.event === "workflow_dispatch" && ["target-non-hdc", "full-pilot"].includes(identity.mode),
    "minimal-upgrade": identity.event === "workflow_dispatch" && identity.mode === "minimal-upgrade",
  });
  sameIdentity(parseJson(record(record(needs["build-and-test"]).outputs).identity), identity);
}

export type ReportOptions = {
  command: string; root: string; startedAt: number; finishedAt: number;
  platform: string; missingPathDts: boolean; missingRehearsalContainer: boolean;
};
function optionalAssertion(file: string, assertion: RecordValue, options: ReportOptions): string | undefined {
  const suite = JSON.stringify(assertion.ancestorTitles);
  if (options.command === "scripts" && options.missingPathDts && file === "scripts/vendorDtSchemaGenerator.test.ts"
    && suite === '["vendor schema real dt-validate fixtures"]') return "missing-path-dts";
  if (options.command === "scripts" && options.missingRehearsalContainer && file === "scripts/wayfinder/parameter-catalog-rehearsal.integration.test.ts"
    && suite === '["parameter catalog rehearsal artifact"]') return "missing-rehearsal-container";
  if (options.command === "bridge" && options.platform !== "darwin") {
    if (file === "packages/device-bridge/src/cli.test.ts" && suite === '["device bridge cli"]'
      && ["detects CLI entry across macOS /tmp and /private/tmp aliases", "installs macOS launch agent via service install"].includes(String(assertion.title))) return "non-macos";
    if (file === "packages/device-bridge/src/macosUrlScheme.test.ts" && suite === '["macosUrlScheme register/unregister"]'
      && ["registers launcher app and calls lsregister", "unregisters launcher app and removes bundle"].includes(String(assertion.title))) return "non-macos";
  }
}
export function validateNativeReport(report: unknown, files: string[], options: ReportOptions) {
  const value = record(report);
  const count = (key: string): number => {
    requireCi(Number.isSafeInteger(value[key]) && Number(value[key]) >= 0, "REPORT_COUNTER");
    return Number(value[key]);
  };
  requireCi(value.success === true && count("numFailedTests") === 0 && count("numFailedTestSuites") === 0
    && count("numPendingTestSuites") === 0 && count("numTodoTests") === 0, "REPORT_FAILED");
  requireCi(count("numTotalTestSuites") > 0 && count("numTotalTestSuites") === count("numPassedTestSuites"), "REPORT_SUITES");
  requireCi(typeof value.startTime === "number" && value.startTime >= options.startedAt && value.startTime <= options.finishedAt, "STALE_REPORT");
  requireCi(Array.isArray(value.testResults) && files.length > 0 && new Set(files).size === files.length, "REPORT_FILES");
  const results = value.testResults.map(record);
  const names = results.map((result) => result.name);
  requireCi(names.length === files.length && new Set(names).size === files.length
    && files.every((file) => names.includes(file)), "REPORT_FILES");
  let passed = 0;
  let skipped = 0;
  const optionalSkips: Record<string, number> = {};
  for (const result of results) {
    requireCi(result.status === "passed" && result.message === "" && Array.isArray(result.assertionResults)
      && result.assertionResults.length > 0, "EMPTY_OR_FAILED_SUITE");
    const file = path.relative(options.root, String(result.name)).replaceAll("\\", "/");
    requireCi(file !== ".." && !file.startsWith("../") && !path.isAbsolute(file), "REPORT_PATH");
    let filePassed = 0;
    for (const raw of result.assertionResults) {
      const assertion = record(raw);
      requireCi(Array.isArray(assertion.failureMessages) && assertion.failureMessages.length === 0, "ASSERTION_FAILED");
      if (assertion.status === "passed") { passed += 1; filePassed += 1; }
      else {
        const reason = optionalAssertion(file, assertion, options);
        requireCi(assertion.status === "skipped" && reason, "REQUIRED_TEST_SKIPPED");
        skipped += 1;
        optionalSkips[reason] = (optionalSkips[reason] ?? 0) + 1;
      }
    }
    requireCi(filePassed > 0, "ALL_SKIPPED_FILE");
  }
  requireCi(passed > 0 && passed === count("numPassedTests") && skipped === count("numPendingTests")
    && passed + skipped === count("numTotalTests"), "REPORT_COUNTER_MISMATCH");
  return { passed, skipped, files: files.length, optionalSkips };
}

function parseJson(value: unknown): unknown {
  requireCi(typeof value === "string" && Buffer.byteLength(value) <= 64 * 1024, "JSON_SIZE");
  return JSON.parse(value);
}
function sameIdentity(value: unknown, expected: Identity) {
  const actual = readIdentity(value);
  requireCi(Object.keys(expected).every((key) => actual[key as keyof Identity] === expected[key as keyof Identity]), "IDENTITY_MISMATCH");
}
export function assertTestSummary(value: unknown, command: string, identity: Identity): asserts value is NativeSummary {
  const summary = record(value);
  exactKeys(summary, ["version", "command", "identity", "passed", "skipped", "files", "optionalSkips", "sha256", "filesSha256"]);
  requireCi(summary.version === 1 && summary.command === command, "REPORT_COMMAND");
  sameIdentity(summary.identity, identity);
  for (const key of ["passed", "files", "skipped"]) requireCi(Number.isSafeInteger(summary[key]) && Number(summary[key]) >= (key === "skipped" ? 0 : 1), "REPORT_COUNTER");
  for (const key of ["sha256", "filesSha256"]) requireCi(typeof summary[key] === "string" && /^[a-f0-9]{64}$/.test(String(summary[key])), "REPORT_HASH");
  const optional = record(summary.optionalSkips);
  for (const [key, count] of Object.entries(optional)) requireCi(["missing-path-dts", "missing-rehearsal-container", "non-macos"].includes(key)
    && Number.isSafeInteger(count) && Number(count) > 0, "REPORT_OPTIONAL");
  requireCi(Object.values(optional).reduce<number>((sum, count) => sum + Number(count), 0) === summary.skipped, "REPORT_OPTIONAL");
}
type ShadowModule = {
  id: typeof shadowModuleIds[number]; status: "observation-pending"; selected: boolean;
  wouldSelectFileCount: number; actualFullFileCount: number; matchedCount: number;
};
export type ShadowSummary = {
  version: 1; scope: "ci-shadow"; effectiveMode: "shadow"; activation: "observation-pending"; memo: "disabled";
  status: "observed" | "unavailable" | "not-applicable"; error: string | null;
  planValid: boolean; identity: Identity; command: "frontend" | "scripts" | "bridge" | "server";
  fullFallback: boolean; selectionScope: "full-required" | "module-subset" | "unavailable" | "not-applicable";
  selectionDigest: string | null; activationEligible: false;
  policyDigest: string | null; registryDigest: string | null; nativeReportSha256: string | null; actualFilesSha256: string | null;
  actualFullFileCount: number; modules: ShadowModule[];
};
export type ShadowSettlement = {
  status: "observed" | "unavailable" | "not-applicable";
  planValid: boolean;
  error: string | null;
};
const shadowCommands = ["frontend", "scripts", "bridge", "server"] as const;
const shadowErrors = ["SHADOW_PLAN_INVALID", "SHADOW_ADAPTER_FAILED", "SHADOW_IDENTITY_MISMATCH", "SHADOW_NATIVE_INVALID"] as const;
function shadowModules(value: unknown): ShadowModule[] {
  requireCi(Array.isArray(value) && value.length === shadowModuleIds.length, "SHADOW_MODULES");
  const modules = value.map((raw) => {
    const item = record(raw);
    exactKeys(item, ["id", "status", "selected", "wouldSelectFileCount", "actualFullFileCount", "matchedCount"]);
    requireCi(typeof item.id === "string" && shadowModuleIds.includes(item.id as typeof shadowModuleIds[number]), "SHADOW_MODULES");
    requireCi(item.status === "observation-pending" && typeof item.selected === "boolean", "SHADOW_MODULES");
    for (const key of ["wouldSelectFileCount", "actualFullFileCount", "matchedCount"]) {
      requireCi(Number.isSafeInteger(item[key]) && Number(item[key]) >= 0, "SHADOW_COUNTER");
    }
    return item as ShadowModule;
  });
  requireCi(new Set(modules.map((module) => module.id)).size === shadowModuleIds.length
    && shadowModuleIds.every((id, index) => modules[index]?.id === id), "SHADOW_MODULES");
  return modules;
}
export function assertShadowSummary(value: unknown, expected: Identity, command: string, native?: NativeSummary): asserts value is ShadowSummary {
  const summary = record(value);
  exactKeys(summary, ["version", "scope", "effectiveMode", "activation", "memo", "status", "error", "planValid", "identity", "command", "fullFallback", "selectionScope", "selectionDigest", "activationEligible", "policyDigest", "registryDigest",
    "nativeReportSha256", "actualFilesSha256", "actualFullFileCount", "modules"]);
  sameIdentity(summary.identity, expected);
  requireCi(summary.version === 1 && summary.scope === "ci-shadow" && summary.effectiveMode === "shadow"
    && summary.activation === "observation-pending" && summary.memo === "disabled" && shadowCommands.includes(command as typeof shadowCommands[number])
    && summary.command === command && summary.activationEligible === false && typeof summary.fullFallback === "boolean", "SHADOW_IDENTITY_MISMATCH");
  requireCi(Number.isSafeInteger(summary.actualFullFileCount) && Number(summary.actualFullFileCount) >= 0, "SHADOW_COUNTER");
  const modules = shadowModules(summary.modules);
  for (const module of modules) requireCi(module.actualFullFileCount === summary.actualFullFileCount && module.matchedCount <= module.actualFullFileCount
    && module.wouldSelectFileCount <= module.actualFullFileCount && module.matchedCount === module.wouldSelectFileCount
    && (module.selected || (module.wouldSelectFileCount === 0 && module.matchedCount === 0)), "SHADOW_COUNTER");
  if (summary.status === "observed") {
    requireCi(summary.planValid === true && summary.error === null, "SHADOW_STATUS");
    requireCi(((summary.fullFallback && summary.selectionScope === "full-required") || (!summary.fullFallback && summary.selectionScope === "module-subset"))
      && typeof summary.selectionDigest === "string" && /^[a-f0-9]{64}$/.test(String(summary.selectionDigest)), "SHADOW_SELECTION");
    for (const key of ["policyDigest", "registryDigest", "nativeReportSha256", "actualFilesSha256"])
      requireCi(typeof summary[key] === "string" && /^[a-f0-9]{64}$/.test(String(summary[key])), "SHADOW_DIGEST");
    requireCi(Number(summary.actualFullFileCount) > 0, "SHADOW_COUNTER");
    if (summary.fullFallback) {
      requireCi(modules.every((module) => module.selected && module.wouldSelectFileCount === summary.actualFullFileCount
        && module.matchedCount === summary.actualFullFileCount), "SHADOW_COUNTER");
    }
  } else if (summary.status === "unavailable") {
    requireCi(summary.planValid === false && typeof summary.error === "string" && shadowErrors.includes(summary.error as typeof shadowErrors[number]), "SHADOW_STATUS");
    requireCi(!summary.fullFallback && summary.selectionScope === "unavailable" && summary.selectionDigest === null
      && summary.policyDigest === null && summary.registryDigest === null, "SHADOW_SELECTION");
    for (const key of ["nativeReportSha256", "actualFilesSha256"]) requireCi(summary[key] === null || (typeof summary[key] === "string" && /^[a-f0-9]{64}$/.test(String(summary[key]))), "SHADOW_DIGEST");
  } else {
    requireCi(summary.status === "not-applicable" && summary.planValid === false && summary.error === "NOT_APPLICABLE"
      && !summary.fullFallback && summary.selectionScope === "not-applicable" && summary.selectionDigest === null
      && summary.policyDigest === null && summary.registryDigest === null && summary.nativeReportSha256 === null
      && summary.actualFilesSha256 === null && summary.actualFullFileCount === 0, "SHADOW_STATUS");
  }
  if (native) {
    requireCi(summary.command === native.command, "SHADOW_NATIVE_MISMATCH");
    if (summary.status !== "not-applicable") requireCi(summary.nativeReportSha256 === native.sha256
      && summary.actualFilesSha256 === native.filesSha256 && summary.actualFullFileCount === native.files, "SHADOW_NATIVE_MISMATCH");
  }
}
function shadowInput(value: unknown): RecordValue {
  const input = record(value);
  exactKeys(input, ["identity", "needs", "nativeNeeds"]);
  return input;
}
export function assertShadowResults(input: unknown): ShadowSummary[] {
  const value = shadowInput(input);
  const identity = readIdentity(value.identity);
  const needs = record(value.needs);
  const nativeNeeds = record(value.nativeNeeds);
  const nativeFlags = flagsFor(identity, nativeNeeds);
  if (identity.event !== "pull_request" || !nativeFlags.run_l1) return [];
  const expectedJobs = ["detect", "l1-frontend", "l1-scripts", "l1-server"];
  exactKeys(needs, expectedJobs);
  const nativeDetect = record(nativeNeeds.detect);
  const detect = record(needs.detect);
  exactKeys(detect, ["result", "outputs"]);
  requireCi(detect.result === nativeDetect.result, "SHADOW_DETECT_MISMATCH");
  const nativeDetectOutputs = record(nativeDetect.outputs);
  const detectOutputs = record(detect.outputs);
  exactKeys(detectOutputs, flagNames);
  exactKeys(nativeDetectOutputs, flagNames);
  for (const name of flagNames) requireCi(detectOutputs[name] === nativeDetectOutputs[name], "SHADOW_DETECT_MISMATCH");
  const projections: Array<[string, string]> = [["l1-frontend", "shadow_frontend"], ["l1-scripts", "shadow_scripts"], ["l1-scripts", "shadow_bridge"], ["l1-server", "shadow_server"]];
  const nativeJobs = new Map(expectedJobs.slice(1).map((job) => [job, record(nativeNeeds[job])]));
  for (const [job, keys] of [["l1-frontend", ["shadow_frontend"]], ["l1-scripts", ["shadow_scripts", "shadow_bridge"]], ["l1-server", ["shadow_server"]]] as const) {
    const needed = record(needs[job]);
    requireCi(needed.result === nativeJobs.get(job)?.result, "SHADOW_REQUIRED_RESULT");
    exactKeys(needed, ["result", "outputs"]);
    exactKeys(record(needed.outputs), keys);
  }
  let common: string | undefined;
  const summaries: ShadowSummary[] = [];
  for (const [job, key] of projections) {
    const needed = record(needs[job]);
    requireCi(needed.result === nativeJobs.get(job)?.result, "SHADOW_REQUIRED_RESULT");
    const outputs = record(needed.outputs);
    const shadow = parseJson(outputs[key]);
    const command = key.replace("shadow_", "");
    const receipt = parseJson(record(record(nativeNeeds[job]).outputs).receipt);
    const reports = record(record(receipt).reports);
    const native = record(reports[command]);
    assertTestSummary(native, command, identity);
    assertShadowSummary(shadow, identity, command, identity.event === "pull_request" ? native : undefined);
    const summary = shadow as ShadowSummary;
    summaries.push(summary);
    if (summary.status === "observed") {
      const association = JSON.stringify({ policyDigest: summary.policyDigest, registryDigest: summary.registryDigest,
        selectionDigest: summary.selectionDigest, selectionScope: summary.selectionScope, fullFallback: summary.fullFallback, activationEligible: summary.activationEligible,
        selectedModules: summary.modules.map((module) => [module.id, module.selected]) });
      if (common === undefined) common = association; else requireCi(common === association, "SHADOW_ASSOCIATION_MISMATCH");
    }
  }
  return summaries;
}
function shadowFailure(error: unknown): typeof shadowErrors[number] {
  return error instanceof Error && shadowErrors.includes(error.message as typeof shadowErrors[number])
    ? error.message as typeof shadowErrors[number] : "SHADOW_PLAN_INVALID";
}
export function settleShadowResults(input: unknown): ShadowSettlement {
  try {
    const raw = record(input);
    const identity = readIdentity(raw.identity);
    const nativeNeeds = record(raw.nativeNeeds);
    const flags = flagsFor(identity, nativeNeeds);
    if (identity.event !== "pull_request" || !flags.run_l1) return { status: "not-applicable", planValid: false, error: "NOT_APPLICABLE" };
    const value = shadowInput(raw);
    const summaries = assertShadowResults(value);
    const unavailable = summaries.find((summary) => summary.status !== "observed");
    if (unavailable) return { status: "unavailable", planValid: false, error: unavailable.status === "unavailable" ? unavailable.error : "SHADOW_PLAN_INVALID" };
    return { status: "observed", planValid: true, error: null };
  } catch (error) {
    return { status: "unavailable", planValid: false, error: shadowFailure(error) };
  }
}
function settleShadowEnvironment(value: unknown, identity: Identity, nativeNeeds: unknown): ShadowSettlement {
  try {
    const flags = flagsFor(identity, record(nativeNeeds));
    if (identity.event !== "pull_request" || !flags.run_l1) return { status: "not-applicable", planValid: false, error: "NOT_APPLICABLE" };
    if (typeof value !== "string" || Buffer.byteLength(value) > 64 * 1024) return { status: "unavailable", planValid: false, error: "SHADOW_PLAN_INVALID" };
    return settleShadowResults({ identity, needs: parseJson(value), nativeNeeds });
  } catch (error) {
    return { status: "unavailable", planValid: false, error: shadowFailure(error) };
  }
}
export function createL1Receipt(input: unknown) {
  const value = record(input);
  const identity = readIdentity(value.identity);
  const job = String(value.job);
  requireCi(Object.hasOwn(l1CommandIds, job), "UNKNOWN_JOB");
  const steps = record(value.steps);
  exactKeys(steps, l1CommandIds[job]);
  const commands: Record<string, string> = {};
  const reports: Record<string, unknown> = {};
  for (const id of l1CommandIds[job]) {
    const step = record(steps[id]);
    requireCi(step.outcome === "success" || (id === "advisory" && step.outcome === "failure"), "COMMAND_FAILED");
    commands[id] = String(step.outcome);
    if (Object.hasOwn(testCommands, id)) {
      const report = parseJson(record(step.outputs).report);
      assertTestSummary(report, id, identity);
      reports[id] = report;
    }
  }
  return { version: 1, identity, job, commands, reports };
}
export function assertL1Results(input: unknown): void {
  const value = record(input);
  const identity = readIdentity(value.identity);
  const needs = record(value.needs);
  const flags = flagsFor(identity, needs);
  assertJobs(needs, { detect: true, ...Object.fromEntries(l1Jobs.map((job) => [job, flags.run_l1])) });
  for (const job of l1Jobs) {
    const needed = record(needs[job]);
    if (needed.result === "skipped") continue;
    const receipt = record(parseJson(record(needed.outputs).receipt));
    exactKeys(receipt, ["version", "identity", "job", "commands", "reports"]);
    requireCi(receipt.version === 1 && receipt.job === job, "RECEIPT_JOB");
    sameIdentity(receipt.identity, identity);
    const commands = record(receipt.commands);
    const reports = record(receipt.reports);
    exactKeys(commands, l1CommandIds[job]);
    exactKeys(reports, Object.keys(testCommands).filter((id) => testCommands[id].job === job));
    for (const id of l1CommandIds[job]) requireCi(commands[id] === "success" || (id === "advisory" && commands[id] === "failure"), "COMMAND_FAILED");
    for (const [id, report] of Object.entries(reports)) assertTestSummary(report, id, identity);
  }
}

function currentIdentity(): Identity {
  const env = process.env;
  const git = (revision: string) => execFileSync("git", ["--no-replace-objects", "rev-parse", "--verify", revision], { encoding: "utf8" }).trim();
  const sha = git("HEAD");
  requireCi(sha === env.GITHUB_SHA, "EXECUTION_SHA");
  requireCi(env.EFF_FULL_ACCEPTANCE === "true" || env.EFF_FULL_ACCEPTANCE === "false", "LABEL_FLAG");
  return readIdentity({ event: env.GITHUB_EVENT_NAME, mode: env.EFF_MODE ?? "", fullAcceptance: env.EFF_FULL_ACCEPTANCE === "true",
    ref: env.GITHUB_REF, base: env.EFF_BASE_SHA ?? "", head: env.EFF_HEAD_SHA ?? "", sha, tree: git("HEAD^{tree}"),
    runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT });
}
function writeOutput(key: string, value: unknown) {
  const json = JSON.stringify(value);
  requireCi(Buffer.byteLength(json) <= 64 * 1024 && process.env.GITHUB_OUTPUT, "OUTPUT_SIZE");
  appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${json}\n`);
}
export function readPrivateReport(file: string): Buffer {
  const parent = lstatSync(path.dirname(file));
  requireCi(parent.isDirectory() && !parent.isSymbolicLink() && (parent.mode & 0o077) === 0
    && parent.uid === process.getuid?.(), "REPORT_DIRECTORY");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    requireCi(stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid?.() && stat.size > 0 && stat.size <= 32 * 1024 * 1024, "REPORT_FILE");
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const bytes = readSync(fd, data, offset, data.length - offset, offset);
      requireCi(bytes > 0, "REPORT_CHANGED");
      offset += bytes;
    }
    const after = fstatSync(fd);
    requireCi(data.length === stat.size && stat.size === after.size && stat.mtimeMs === after.mtimeMs, "REPORT_CHANGED");
    return data;
  } finally { closeSync(fd); }
}
function unavailableShadow(identity: Identity, command: NativeSummary["command"], native: NativeSummary, error: "SHADOW_ADAPTER_FAILED" | "NOT_APPLICABLE"): ShadowSummary {
  const notApplicable = error === "NOT_APPLICABLE";
  return {
    version: 1, scope: "ci-shadow", effectiveMode: "shadow", activation: "observation-pending", memo: "disabled",
    status: notApplicable ? "not-applicable" : "unavailable", error: notApplicable ? "NOT_APPLICABLE" : error,
    planValid: false, identity, command: command as ShadowSummary["command"], fullFallback: false,
    selectionScope: notApplicable ? "not-applicable" : "unavailable", selectionDigest: null, activationEligible: false,
    policyDigest: null, registryDigest: null,
    nativeReportSha256: notApplicable ? null : native.sha256, actualFilesSha256: notApplicable ? null : native.filesSha256,
    actualFullFileCount: notApplicable ? 0 : native.files,
    modules: shadowModuleIds.map((id) => ({ id, status: "observation-pending" as const, selected: false,
      wouldSelectFileCount: 0, actualFullFileCount: notApplicable ? 0 : native.files, matchedCount: 0 })),
  };
}
function runShadowAdapter(identity: Identity, command: NativeSummary["command"], files: string[], native: NativeSummary): ShadowSummary {
  if (identity.event !== "pull_request") return unavailableShadow(identity, command, native, "NOT_APPLICABLE");
  try {
    const executable = path.resolve(process.cwd(), "node_modules/.bin/tsx");
    const result = spawnSync(executable, ["scripts/verification/ci-shadow.ts"], {
      cwd: process.cwd(), input: JSON.stringify({ identity, command, files, native }), encoding: "utf8", stdio: ["pipe", "pipe", "ignore"],
      timeout: 30_000, maxBuffer: 128 * 1024,
    });
    requireCi(result.status === 0 && !result.error && typeof result.stdout === "string", "SHADOW_ADAPTER_FAILED");
    const shadow = JSON.parse(result.stdout.trim());
    assertShadowSummary(shadow, identity, command, native);
    return shadow;
  } catch { return unavailableShadow(identity, command, native, "SHADOW_ADAPTER_FAILED"); }
}
function runTest(command: string, identity: Identity) {
  requireCi(Object.hasOwn(testCommands, command) && testCommands[command].job === process.env.GITHUB_JOB, "UNKNOWN_COMMAND");
  const specification = testCommands[command];
  requireCi(process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP), "REPORT_TEMP");
  const directory = mkdtempSync(path.join(realpathSync(process.env.RUNNER_TEMP), "wiseeff-l1-"));
  chmodSync(directory, 0o700);
  const output = path.join(directory, "report.json");
  const env = command === "frontend" ? { ...process.env, VITE_WISEEFF_RUNTIME_MODE: process.env.VITE_WISEEFF_RUNTIME_MODE?.trim() || "mock" } : process.env;
  // filesOnly discovers the unchanged config's full file set without importing tests or starting PG fixtures.
  const listed = JSON.parse(execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "list", "--filesOnly", "--json",
    ...(specification.config ? ["--config", specification.config] : [])], { encoding: "utf8", env, maxBuffer: 4 * 1024 * 1024 }));
  requireCi(Array.isArray(listed) && listed.length > 0, "DISCOVERY_EMPTY");
  const files = listed.map((entry: unknown) => { const item = record(entry); requireCi(typeof item.file === "string", "DISCOVERY_FILE"); return item.file; });
  const missing = (tool: string, args: string[]) => spawnSync(tool, args, { stdio: "ignore", timeout: 5_000 }).status !== 0;
  const options: ReportOptions = { command, root: process.cwd(), startedAt: Date.now(), finishedAt: 0, platform: process.platform,
    missingPathDts: command === "scripts" && (missing("dtc", ["--version"]) || missing("dt-validate", ["--version"])),
    missingRehearsalContainer: command === "scripts" && missing("docker", ["inspect", process.env.WAYFINDER_POSTGRES_CONTAINER?.trim() || "wiseeff-postgres-1"]) };
  const result = spawnSync("npm", [...specification.args, "--", "--reporter=default", "--reporter=json", `--outputFile=${output}`], { stdio: "inherit", env });
  options.finishedAt = Date.now();
  requireCi(result.status === 0 && !result.error, "TEST_COMMAND_FAILED");
  const bytes = readPrivateReport(output);
  const summary = validateNativeReport(JSON.parse(bytes.toString("utf8")), files, options);
  const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
  const native = { version: 1 as const, command, identity, ...summary, sha256: digest(bytes), filesSha256: digest(JSON.stringify(files.sort())) } as NativeSummary;
  writeOutput("report", native);
  writeOutput("shadow", runShadowAdapter(identity, command, files, native));
  console.log(`CI ${command}: ${summary.files} files, ${summary.passed} passed, ${summary.skipped} optional skipped; fresh report retained locally.`);
}
function main() {
  const [mode, command] = process.argv.slice(2);
  const identity = currentIdentity();
  if (mode === "test") return runTest(command, identity);
  if (mode === "receipt") return writeOutput("receipt", createL1Receipt({ identity, job: process.env.GITHUB_JOB, steps: parseJson(process.env.EFF_STEPS) }));
  const input = { identity, needs: parseJson(process.env.EFF_NEEDS) };
  if (mode === "l1") {
    assertL1Results(input);
    const shadow = settleShadowEnvironment(process.env.EFF_SHADOW, identity, input.needs);
    console.log(`CI shadow: ${shadow.status}; planValid:${shadow.planValid}`);
    writeOutput("identity", identity);
  }
  else if (mode === "required") assertRequiredResults(input);
  else throw new Error("CI_UNKNOWN_COMMAND");
  console.log(`CI ${mode}: required results and execution identity verified.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    console.error(error instanceof Error && /^CI_[A-Z_]+$/.test(error.message) ? error.message : "CI_REJECTED");
    process.exitCode = 1;
  }
}
