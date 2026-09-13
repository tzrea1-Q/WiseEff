import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  constants,
  createWriteStream,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseArgs } from "node:util";

import { validateWorkspaceLinks } from "../check-workspace-links";
import { validateNativeReport, readPrivateReport } from "../ci-required-results";
import { buildVitestInvocation } from "../run-vitest";
import { stopOwnedProcessGroup, waitForOwnedProcessGroupExit } from "../owned-process-group";
import { createPreview, type Preview } from "./plan";

export const TASK_IDS = ["ci-changed-paths", "feedback-frontend-client"] as const;
export type TaskId = typeof TASK_IDS[number];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const implementationRoot = ROOT;
const RUNS_DIRECTORY = path.join(ROOT, "work", "verification-runs");
const RECORD_NAME = "record.json";
const NATIVE_REPORT_NAME = "native-report.json";
const STDOUT_NAME = "stdout.log";
const STDERR_NAME = "stderr.log";
const LOCK_NAMES: Record<TaskId, string> = {
  "ci-changed-paths": "ci-changed-paths.lock",
  "feedback-frontend-client": "feedback-frontend-client.lock",
};
const SCRIPT_BUDGET_MS = 5 * 60 * 1_000;
const FRONTEND_BUDGET_MS = 10 * 60 * 1_000;
const TERMINATION_GRACE_MS = 5_000;
const VERIFY_GRACE_MS = 1_000;
const DISCOVERY_LIMIT = 4 * 1024 * 1024;
const LOG_LIMIT = 16 * 1024 * 1024;
const RECORD_LIMIT = 64 * 1024;
const NATIVE_REPORT_LIMIT = 32 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/u;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ALLOWED_HOST_ENV = ["HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TZ"] as const;
const REJECTED_STARTUP_ENV = ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD"] as const;
export const SOURCE_PATHS = [
  "package.json",
  "package-lock.json",
  "vite.config.ts",
  "vitest.scripts.config.ts",
  "scripts/verify.ts",
  "scripts/verification/plan.ts",
  "scripts/verification/selection.ts",
  "scripts/verification/registry.json",
  "scripts/verification/run.ts",
  "scripts/verification/run.test.ts",
  "scripts/verification/report.ts",
  "scripts/verification/report.test.ts",
  "scripts/ci-required-results.ts",
] as const;

type ProcessIdentity = { startToken: string; commandSha256: string };
export type TaskSpec = {
  id: TaskId;
  config: string;
  files: string[];
  budgetMs: number;
  testConfigRuntimeMode: "mock" | null;
};

export type SourceFileObservation = { path: string; bytes: number; sha256: string };
export type PhaseObservation = {
  startedAt: string;
  finishedAt: string;
  wallMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutBytes: number;
  stderrBytes: number;
  lifecycleSettled: boolean;
};
export type RunRecord = {
  schemaVersion: 1;
  complete: boolean;
  scope: "fresh-local-feedback";
  runId: string;
  root: string;
  taskId: TaskId;
  acceptedBase: string;
  head: string;
  tree: string;
  executedSha: string;
  headTree: string;
  sourceDigest: string;
  sourceFiles: SourceFileObservation[];
  policyDigest: string;
  nodeVersion: string;
  dependencies: { packageVersion: string; vitestVersion: string };
  childEnvRuntimeMode: "mock" | "api";
  testConfigRuntimeMode: "mock" | null;
  discoveryArgv: string[];
  runArgv: string[];
  discovery: PhaseObservation | null;
  execution: PhaseObservation | null;
  startedAt: string;
  finishedAt: string;
  wallMs: number;
  activityBudgetMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  native: { discoveredFiles: string[]; files: number; passed: number; skipped: number; reportSha256: string | null };
  logs: { stdoutSha256: string; stderrSha256: string; stdoutBytes: number; stderrBytes: number };
  claimedStatus: "passed" | "failed";
  error: string | null;
  memo: "disabled";
  acceptancePending: true;
  tokenUsage: null;
};

export type TerminalResult = {
  version: 1;
  scope: "fresh-local-feedback";
  runId: string | null;
  taskId: TaskId | null;
  status: "passed" | "failed";
  error: string | null;
  sourceSha: string | null;
  tree: string | null;
  sourceDigest: string | null;
  nativeFiles: number | null;
  nativePassed: number | null;
  nativeSkipped: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  wallMs: number | null;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  memo: "disabled";
  acceptancePending: true;
  tokenUsage: null;
};

export class RunError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new RunError(code);
}

export function taskSpec(taskId: TaskId): TaskSpec {
  if (taskId === "ci-changed-paths") {
    return { id: taskId, config: "vitest.scripts.config.ts", files: ["scripts/ci-changed-paths.test.ts"], budgetMs: SCRIPT_BUDGET_MS, testConfigRuntimeMode: null };
  }
  return {
    id: taskId,
    config: "vite.config.ts",
    files: [
      "src/features/product-feedback/FeedbackAdminDrawer.test.tsx",
      "src/features/product-feedback/FeedbackAdminPage.test.tsx",
      "src/features/product-feedback/FeedbackDialog.styles.test.ts",
      "src/features/product-feedback/FeedbackDialog.test.tsx",
      "src/infrastructure/http/productFeedbackClient.test.ts",
    ],
    budgetMs: FRONTEND_BUDGET_MS,
    testConfigRuntimeMode: "mock",
  };
}

function isTaskId(value: unknown): value is TaskId {
  return typeof value === "string" && (TASK_IDS as readonly string[]).includes(value);
}

export function parseRunArgs(argv: string[]): { base: string; task: TaskId; force: boolean } {
  let values: { base?: string; task?: string; force?: boolean };
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: { base: { type: "string" }, task: { type: "string" }, force: { type: "boolean" } },
    }));
  } catch {
    fail("INVALID_ARGUMENTS");
  }
  if (typeof values.base !== "string" || !FULL_SHA.test(values.base) || !isTaskId(values.task)) fail("INVALID_ARGUMENTS");
  return { base: values.base, task: values.task, force: values.force === true };
}

function ensureRoot(): void {
  if (process.platform === "win32") fail("UNSUPPORTED_PLATFORM");
  let root: string;
  let cwd: string;
  try {
    root = realpathSync(ROOT);
    cwd = realpathSync(process.cwd());
  } catch {
    fail("ROOT_UNAVAILABLE");
  }
  if (root !== ROOT || cwd !== root) fail("NON_ROOT_CWD");
  ensurePathAncestors(ROOT, ROOT);
}

function ensurePathAncestors(root: string, target: string): void {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("FOREIGN_PATH");
  let current = absoluteRoot;
  const parts = relative ? relative.split(path.sep) : [];
  for (const part of parts) {
    current = path.join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); } catch { fail("PATH_UNAVAILABLE"); }
    if (stat.isSymbolicLink()) fail("SYMLINK_PATH");
  }
}

function checkRegularFile(file: string, maxBytes: number, expectedMode?: number): Stats {
  ensurePathAncestors(ROOT, file);
  let stat: Stats;
  try { stat = lstatSync(file); } catch { fail("MISSING_INPUT"); }
  const uid = process.getuid?.();
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid) || stat.size > maxBytes) fail("UNSAFE_FILE");
  if (expectedMode !== undefined && (stat.mode & 0o777) !== expectedMode) fail("UNSAFE_FILE_MODE");
  return stat;
}

function ensureDirectory(directory: string, mode: number): void {
  const absolute = path.resolve(directory);
  ensurePathAncestors(ROOT, path.dirname(absolute));
  if (!existsSync(absolute)) mkdirSync(absolute, { recursive: true, mode });
  ensurePathAncestors(ROOT, absolute);
  const stat = lstatSync(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UNSAFE_DIRECTORY");
}

function createOwnedEmptyFile(file: string): void {
  ensurePathAncestors(ROOT, path.dirname(file));
  const fd = openSync(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function digest(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function framedDigest(entries: Array<[string, Buffer]>): string {
  const hash = createHash("sha256");
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const size = Buffer.alloc(8);
    size.writeBigUInt64BE(BigInt(nameBytes.length));
    hash.update(size).update(nameBytes);
    size.writeBigUInt64BE(BigInt(value.length));
    hash.update(size).update(value);
  }
  return hash.digest("hex");
}

function inspectSources(): { sourceDigest: string; sourceFiles: SourceFileObservation[] } {
  const entries: Array<[string, Buffer]> = [];
  const sourceFiles: SourceFileObservation[] = [];
  for (const relative of SOURCE_PATHS) {
    const file = path.join(ROOT, relative);
    const stat = checkRegularFile(file, 8 * 1024 * 1024);
    const bytes = Buffer.from(readFileSync(file, "utf8"), "utf8");
    if (bytes.length !== stat.size) fail("SOURCE_CHANGED");
    const sha256 = digest(bytes);
    sourceFiles.push({ path: relative, bytes: bytes.length, sha256 });
    entries.push([relative, bytes]);
  }
  return { sourceDigest: framedDigest(entries), sourceFiles };
}

function readPackageVersion(relative: string): string {
  const file = path.join(ROOT, relative);
  checkRegularFile(file, 512 * 1024);
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); } catch { fail("DEPENDENCY_METADATA"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { version?: unknown }).version !== "string") fail("DEPENDENCY_METADATA");
  return (value as { version: string }).version;
}

function dependencyObservation(): RunRecord["dependencies"] {
  const packageVersion = readPackageVersion("package.json");
  const vitestVersion = readPackageVersion("node_modules/vitest/package.json");
  checkRegularFile(path.join(ROOT, "node_modules/vitest/vitest.mjs"), 512 * 1024);
  return { packageVersion, vitestVersion };
}

function fixedVitestPath(): string {
  const entry = path.join(ROOT, "node_modules/vitest/vitest.mjs");
  checkRegularFile(entry, 512 * 1024);
  return entry;
}

function validateTaskInputs(spec: TaskSpec): string[] {
  checkRegularFile(path.join(ROOT, spec.config), 2 * 1024 * 1024);
  const files = spec.files.map((relative) => {
    checkRegularFile(path.join(ROOT, relative), 8 * 1024 * 1024);
    return path.join(ROOT, relative);
  });
  return files;
}

function childEnvironment(spec: TaskSpec, tempDirectory: string): { env: NodeJS.ProcessEnv; mode: "mock" | "api" } {
  for (const key of REJECTED_STARTUP_ENV) {
    if (process.env[key]?.trim()) fail("HOST_STARTUP_INJECTION");
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("DYLD_") && value?.trim()) fail("HOST_STARTUP_INJECTION");
  }
  const invocation = buildVitestInvocation([], process.env, process.platform);
  const mode = invocation.env.VITE_WISEEFF_RUNTIME_MODE;
  if (mode !== "mock" && mode !== "api") fail("UNKNOWN_RUNTIME_MODE");
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_HOST_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
  const nodeDirectory = path.dirname(process.execPath);
  env.PATH = `${nodeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.TMPDIR = tempDirectory;
  env.TMP = tempDirectory;
  env.TEMP = tempDirectory;
  env.VITE_WISEEFF_RUNTIME_MODE = mode;
  if (spec.testConfigRuntimeMode === "mock") env.VITE_WISEEFF_TEST_CONFIG_RUNTIME_MODE = "mock";
  return { env, mode };
}

function fixedProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const end = stat.lastIndexOf(")");
      const fields = end >= 0 ? stat.slice(end + 2).trim().split(/\s+/u) : [];
      const startTicks = fields[19];
      const command = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", "\n");
      if (!startTicks || !command) return undefined;
      return { startToken: `linux-start-ticks:${startTicks}`, commandSha256: digest(command) };
    } catch { return undefined; }
  }
  if (process.platform !== "darwin") return undefined;
  try {
    const output = execFileSync("/bin/ps", ["-o", "lstart=", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      env: { PATH: "/bin:/usr/bin", LC_ALL: "C" },
      timeout: 1_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const match = output.match(/^(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+([\s\S]+)$/u);
    if (!match?.[1] || !match[2]) return undefined;
    return { startToken: `darwin-lstart:${match[1]}`, commandSha256: digest(match[2]) };
  } catch { return undefined; }
}

function sameIdentity(expected: ProcessIdentity, current: ProcessIdentity | undefined): boolean {
  return current?.startToken === expected.startToken && current.commandSha256 === expected.commandSha256;
}

async function processGroupExists(pid: number): Promise<boolean> {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    throw error;
  }
}

async function waitForGroupAbsent(pid: number, graceMs: number): Promise<boolean> {
  const deadline = Date.now() + graceMs;
  while (true) {
    if (!(await processGroupExists(pid))) return true;
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(25, Math.max(1, deadline - Date.now()))));
  }
}

class BoundedFileCapture extends Writable {
  readonly chunks: Buffer[] = [];
  bytes = 0;
  constructor(private readonly file: ReturnType<typeof createWriteStream>, private readonly limit: number) {
    super();
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.bytes + value.length > this.limit) {
      callback(new RunError("OUTPUT_LIMIT"));
      return;
    }
    this.bytes += value.length;
    this.chunks.push(value);
    if (this.file.write(value)) callback();
    else this.file.once("drain", () => callback());
  }
  text(): string { return Buffer.concat(this.chunks).toString("utf8"); }
}

type NativeRunOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  stdoutLimit: number;
  deadlineAt: number;
};

type NativeRunResult = {
  phase: PhaseObservation;
  stdout: string;
  lifecycleSettled: boolean;
  error: string | null;
};

async function runNative(options: NativeRunOptions): Promise<NativeRunResult> {
  const startedMs = Date.now();
  const child = spawn(process.execPath, options.argv, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!child.pid || !child.stdout || !child.stderr) fail("CHILD_LAUNCH_FAILED");
  const pid = child.pid;
  const identity = fixedProcessIdentity(pid);
  if (!identity) fail("CHILD_IDENTITY_UNAVAILABLE");
  const stdoutFile = createWriteStream(options.stdoutPath, { flags: "w", mode: 0o600 });
  const stderrFile = createWriteStream(options.stderrPath, { flags: "w", mode: 0o600 });
  const stdoutCapture = new BoundedFileCapture(stdoutFile, options.stdoutLimit);
  const stderrCapture = new BoundedFileCapture(stderrFile, LOG_LIMIT);
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  let failure: Error | undefined;
  const stdoutDone = pipeline(child.stdout, stdoutCapture).catch((error) => { failure ??= asError(error); throw error; }).finally(() => new Promise<void>((resolve) => stdoutFile.end(() => resolve())));
  const stderrDone = pipeline(child.stderr, stderrCapture).catch((error) => { failure ??= asError(error); throw error; }).finally(() => new Promise<void>((resolve) => stderrFile.end(() => resolve())));
  const wait = waitForOwnedProcessGroupExit(child, {
    signal: controller.signal,
    expectedProcessIdentity: identity,
    readProcessIdentity: fixedProcessIdentity,
    terminateGraceMs: TERMINATION_GRACE_MS,
    verifyGraceMs: VERIFY_GRACE_MS,
  });
  timeoutHandle = setTimeout(() => controller.abort(new RunError("NATIVE_TIMEOUT")), Math.max(1, options.deadlineAt - Date.now()));
  const outputFailure = Promise.race([stdoutDone, stderrDone]).catch((error) => {
    if (!controller.signal.aborted) controller.abort(asError(error));
  });
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  try {
    exitCode = await wait;
  } catch (error) {
    failure ??= asError(error);
    if (!controller.signal.aborted) controller.abort(failure);
    await wait.catch((waitError) => { failure ??= asError(waitError); });
  }
  clearTimeout(timeoutHandle);
  await Promise.allSettled([stdoutDone, stderrDone, outputFailure]);
  signal = child.signalCode;
  const finishedMs = Date.now();
  let groupSettled = false;
  try {
    groupSettled = await waitForGroupAbsent(pid, VERIFY_GRACE_MS);
    if (!groupSettled && sameIdentity(identity, fixedProcessIdentity(pid))) {
      await stopOwnedProcessGroup(child, { expectedProcessIdentity: identity, readProcessIdentity: fixedProcessIdentity });
      groupSettled = await waitForGroupAbsent(pid, VERIFY_GRACE_MS);
    }
  } catch (error) {
    failure ??= asError(error);
  }
  if (!groupSettled) failure ??= new RunError("CHILD_GROUP_UNSETTLED");
  if (failure && failure.message === "NATIVE_TIMEOUT") signal = signal ?? "SIGTERM";
  const phase: PhaseObservation = {
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    wallMs: finishedMs - startedMs,
    exitCode,
    signal,
    stdoutBytes: stdoutCapture.bytes,
    stderrBytes: stderrCapture.bytes,
    lifecycleSettled: groupSettled,
  };
  return { phase, stdout: stdoutCapture.text(), lifecycleSettled: groupSettled, error: failure ? errorCode(failure) : null };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorCode(error: Error): string {
  if (error instanceof RunError) return error.code;
  if (error instanceof AggregateError) return error.errors.map((item) => errorCode(asError(item))).join("+");
  return "CHILD_FAILED";
}

function sourceIdentity(preview: Preview, sources: { sourceDigest: string; sourceFiles: SourceFileObservation[] }): Pick<RunRecord, "acceptedBase" | "head" | "tree" | "executedSha" | "headTree" | "policyDigest" | "sourceDigest" | "sourceFiles"> {
  return {
    acceptedBase: preview.acceptedBase,
    head: preview.head,
    tree: preview.tree,
    executedSha: preview.executedSha,
    headTree: preview.headTree,
    policyDigest: preview.policyDigest,
    sourceDigest: sources.sourceDigest,
    sourceFiles: sources.sourceFiles,
  };
}

function emptyPhase(): PhaseObservation | null { return null; }

function newRecord(input: {
  runId: string;
  task: TaskSpec;
  preview: Preview;
  sources: { sourceDigest: string; sourceFiles: SourceFileObservation[] };
  dependencies: RunRecord["dependencies"];
  mode: "mock" | "api";
  discoveryArgv: string[];
  runArgv: string[];
  startedAt: string;
  budgetMs: number;
}): RunRecord {
  return {
    schemaVersion: 1,
    complete: false,
    scope: "fresh-local-feedback",
    runId: input.runId,
    root: ROOT,
    taskId: input.task.id,
    ...sourceIdentity(input.preview, input.sources),
    nodeVersion: process.version,
    dependencies: input.dependencies,
    childEnvRuntimeMode: input.mode,
    testConfigRuntimeMode: input.task.testConfigRuntimeMode,
    discoveryArgv: input.discoveryArgv,
    runArgv: input.runArgv,
    discovery: emptyPhase(),
    execution: emptyPhase(),
    startedAt: input.startedAt,
    finishedAt: input.startedAt,
    wallMs: 0,
    activityBudgetMs: input.budgetMs,
    exitCode: null,
    signal: null,
    native: { discoveredFiles: [], files: 0, passed: 0, skipped: 0, reportSha256: null },
    logs: { stdoutSha256: digest(Buffer.alloc(0)), stderrSha256: digest(Buffer.alloc(0)), stdoutBytes: 0, stderrBytes: 0 },
    claimedStatus: "failed",
    error: null,
    memo: "disabled",
    acceptancePending: true,
    tokenUsage: null,
  };
}

function writeAtomicRecord(runDirectory: string, value: RunRecord): void {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > RECORD_LIMIT) fail("RECORD_TOO_LARGE");
  const temporary = path.join(runDirectory, `${RECORD_NAME}.${process.pid}.tmp`);
  ensurePathAncestors(ROOT, runDirectory);
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeFileSync(fd, `${json}\n`, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(temporary, path.join(runDirectory, RECORD_NAME));
}

type RunStorage = { runId: string; directory: string; nativeReport: string; stdout: string; stderr: string; lockPath: string; lockFd: number; lockStat: Stats; lockText: string };

function createStorage(task: TaskId): RunStorage {
  ensureDirectory(path.join(ROOT, "work"), 0o755);
  ensureDirectory(RUNS_DIRECTORY, 0o755);
  const lockPath = path.join(RUNS_DIRECTORY, LOCK_NAMES[task]);
  const lockText = JSON.stringify({ schemaVersion: 1, taskId: task, pid: process.pid, runId: "pending", identity: fixedProcessIdentity(process.pid) });
  if (!fixedProcessIdentity(process.pid)) fail("OWNER_IDENTITY_UNAVAILABLE");
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("TASK_LOCK_BUSY");
    fail("TASK_LOCK_UNAVAILABLE");
  }
  let runId: string;
  let directory: string;
  for (;;) {
    runId = randomUUID();
    if (!RUN_ID.test(runId)) continue;
    directory = path.join(RUNS_DIRECTORY, runId);
    try { mkdirSync(directory, { mode: 0o700 }); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") { closeSync(lockFd); unlinkSync(lockPath); fail("RUN_DIRECTORY_UNAVAILABLE"); } }
  }
  ensurePathAncestors(ROOT, directory);
  const runStat = lstatSync(directory);
  const uid = process.getuid?.();
  if (!runStat.isDirectory() || runStat.isSymbolicLink() || (uid !== undefined && runStat.uid !== uid) || (runStat.mode & 0o777) !== 0o700) {
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* retain the lock when its disposition is uncertain */ }
    fail("UNSAFE_DIRECTORY");
  }
  const identity = fixedProcessIdentity(process.pid);
  const text = JSON.stringify({ schemaVersion: 1, taskId: task, pid: process.pid, runId, identity });
  try {
    writeFileSync(lockFd, text, "utf8");
    fsyncSync(lockFd);
    for (const name of [STDOUT_NAME, STDERR_NAME, NATIVE_REPORT_NAME]) createOwnedEmptyFile(path.join(directory, name));
    const lockStat = fstatSync(lockFd);
    return { runId, directory, nativeReport: path.join(directory, NATIVE_REPORT_NAME), stdout: path.join(directory, STDOUT_NAME), stderr: path.join(directory, STDERR_NAME), lockPath, lockFd, lockStat, lockText: text };
  } catch (error) {
    closeSync(lockFd);
    try { unlinkSync(lockPath); } catch { /* retain the lock if its disposition is uncertain */ }
    throw error;
  }
}

function releaseStorage(storage: RunStorage): boolean {
  try {
    const current = lstatSync(storage.lockPath);
    const original = storage.lockStat;
    const uid = process.getuid?.();
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || (current.mode & 0o777) !== 0o600 || (uid !== undefined && current.uid !== uid)
      || current.dev !== original.dev || current.ino !== original.ino || readFileSync(storage.lockPath, "utf8") !== storage.lockText) return false;
    unlinkSync(storage.lockPath);
    closeSync(storage.lockFd);
    return true;
  } catch {
    try { closeSync(storage.lockFd); } catch { /* already closed */ }
    return false;
  }
}

function fileHash(file: string, maxBytes: number): { sha256: string; bytes: number } {
  const stat = checkRegularFile(file, maxBytes, 0o600);
  const value = Buffer.from(readFileSync(file, "utf8"), "utf8");
  if (value.length !== stat.size) fail("FILE_CHANGED");
  return { sha256: digest(value), bytes: value.length };
}

function parseDiscovery(text: string, files: string[]): string[] {
  if (Buffer.byteLength(text, "utf8") > DISCOVERY_LIMIT) fail("DISCOVERY_TOO_LARGE");
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail("DISCOVERY_INVALID"); }
  if (!Array.isArray(value) || value.length === 0) fail("DISCOVERY_EMPTY");
  const discovered = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as { file?: unknown }).file !== "string") fail("DISCOVERY_FILE");
    const file = path.resolve((entry as { file: string }).file);
    if (file !== path.join(ROOT, path.relative(ROOT, file))) fail("DISCOVERY_PATH");
    return file;
  });
  if (new Set(discovered).size !== discovered.length || discovered.length !== files.length || files.some((file) => !discovered.includes(file))) fail("DISCOVERY_FILES");
  return discovered;
}

function applyPhase(record: RunRecord, phase: "discovery" | "execution", value: PhaseObservation): void {
  record[phase] = value;
  record.finishedAt = value.finishedAt;
  record.wallMs = Date.parse(record.finishedAt) - Date.parse(record.startedAt);
  record.exitCode = value.exitCode;
  record.signal = value.signal;
}

function terminalFromRecord(record: RunRecord): TerminalResult {
  return {
    version: 1,
    scope: "fresh-local-feedback",
    runId: record.runId,
    taskId: record.taskId,
    status: record.claimedStatus,
    error: record.error,
    sourceSha: record.executedSha,
    tree: record.tree,
    sourceDigest: record.sourceDigest,
    nativeFiles: record.native.files,
    nativePassed: record.native.passed,
    nativeSkipped: record.native.skipped,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    wallMs: record.wallMs,
    exitCode: record.exitCode,
    signal: record.signal,
    memo: "disabled",
    acceptancePending: true,
    tokenUsage: null,
  };
}

export async function runFreshTask(options: { base: string; task: TaskId; force?: boolean }): Promise<{ exitCode: number; terminal: TerminalResult; record: RunRecord }> {
  if (!FULL_SHA.test(options.base) || !isTaskId(options.task)) fail("INVALID_ARGUMENTS");
  ensureRoot();
  const spec = taskSpec(options.task);
  const preview = createPreview({ cwd: ROOT, base: options.base });
  const sources = inspectSources();
  const dependencies = dependencyObservation();
  const files = validateTaskInputs(spec);
  const vitest = fixedVitestPath();
  const common = ["--config", path.join(ROOT, spec.config), ...files];
  const discoveryArgv = [vitest, "list", "--filesOnly", "--json", ...common];
  const storage = createStorage(spec.id);
  const startedAt = new Date().toISOString();
  const tempDirectory = path.join(storage.directory, "tmp");
  mkdirSync(tempDirectory, { mode: 0o700 });
  ensurePathAncestors(ROOT, tempDirectory);
  const { env, mode } = childEnvironment(spec, tempDirectory);
  const runArgv = [vitest, "run", ...common, "--reporter=default", "--reporter=json", `--outputFile=${storage.nativeReport}`];
  const record = newRecord({ runId: storage.runId, task: spec, preview, sources, dependencies, mode, discoveryArgv, runArgv, startedAt, budgetMs: spec.budgetMs });
  let lifecycleSettled = true;
  try {
    const workspaceErrors = await validateWorkspaceLinks(ROOT);
    if (workspaceErrors.length > 0) throw new RunError("WORKSPACE_LINKS_INVALID");
    const deadlineAt = Date.now() + spec.budgetMs;
    const discovery = await runNative({ argv: discoveryArgv, env, cwd: ROOT, stdoutPath: storage.stdout, stderrPath: storage.stderr, stdoutLimit: DISCOVERY_LIMIT, deadlineAt });
    applyPhase(record, "discovery", discovery.phase);
    lifecycleSettled &&= discovery.lifecycleSettled;
    if (discovery.error) throw new RunError(discovery.error);
    if (discovery.phase.exitCode !== 0 || discovery.phase.signal) throw new RunError("DISCOVERY_CHILD_FAILED");
    record.native.discoveredFiles = parseDiscovery(discovery.stdout, files);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new RunError("NATIVE_TIMEOUT");
    const execution = await runNative({ argv: runArgv, env, cwd: ROOT, stdoutPath: storage.stdout, stderrPath: storage.stderr, stdoutLimit: LOG_LIMIT, deadlineAt });
    applyPhase(record, "execution", execution.phase);
    lifecycleSettled &&= execution.lifecycleSettled;
    if (execution.error) throw new RunError(execution.error);
    let nativeBytes: Buffer;
    try { nativeBytes = readPrivateReport(storage.nativeReport); } catch { throw new RunError("NATIVE_REPORT_UNAVAILABLE"); }
    if (nativeBytes.length > NATIVE_REPORT_LIMIT) throw new RunError("NATIVE_REPORT_TOO_LARGE");
    const reportHash = digest(nativeBytes);
    record.native.reportSha256 = reportHash;
    const native = validateNativeReport(JSON.parse(nativeBytes.toString("utf8")), files, {
      command: "local-feedback",
      root: ROOT,
      startedAt: Date.parse(record.execution?.startedAt ?? startedAt),
      finishedAt: Date.parse(record.execution?.finishedAt ?? new Date().toISOString()),
      platform: process.platform,
      missingPathDts: false,
      missingRehearsalContainer: false,
    });
    record.native.files = native.files;
    record.native.passed = native.passed;
    record.native.skipped = native.skipped;
    if (record.execution?.exitCode !== 0 || record.execution.signal) throw new RunError("NATIVE_CHILD_FAILED");
    if (record.native.skipped !== 0) throw new RunError("REQUIRED_TEST_SKIPPED");
    const afterPreview = createPreview({ cwd: ROOT, base: options.base });
    const afterSources = inspectSources();
    if (!isDeepStrictEqual(preview, afterPreview) || !isDeepStrictEqual(sources, afterSources)) throw new RunError("SOURCE_DRIFT");
    record.claimedStatus = "passed";
  } catch (error) {
    const code = errorCode(asError(error));
    record.error = code;
    record.claimedStatus = "failed";
  }
  const finishedAt = new Date().toISOString();
  record.finishedAt = finishedAt;
  record.wallMs = Date.parse(finishedAt) - Date.parse(record.startedAt);
  try {
    const stdout = fileHash(storage.stdout, LOG_LIMIT);
    const stderr = fileHash(storage.stderr, LOG_LIMIT);
    record.logs = { stdoutSha256: stdout.sha256, stderrSha256: stderr.sha256, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes };
  } catch (error) {
    record.error ??= errorCode(asError(error));
    record.claimedStatus = "failed";
    lifecycleSettled = false;
  }
  const canComplete = record.claimedStatus === "passed" || (record.error !== null && record.native.reportSha256 !== null && lifecycleSettled);
  record.complete = canComplete;
  if (record.complete && !releaseStorage(storage)) {
    record.complete = false;
    record.claimedStatus = "failed";
    record.error = "LOCK_DISPOSITION_FAILED";
  } else if (!record.complete && lifecycleSettled) {
    releaseStorage(storage);
  }
  try { writeAtomicRecord(storage.directory, record); }
  catch (error) { record.complete = false; record.claimedStatus = "failed"; record.error = errorCode(asError(error)); try { writeAtomicRecord(storage.directory, record); } catch { /* preserve the incomplete directory */ } }
  const terminal = terminalFromRecord(record);
  return { exitCode: record.complete && record.claimedStatus === "passed" ? 0 : 1, terminal, record };
}

export function renderTerminal(result: TerminalResult): string {
  const json = JSON.stringify(result);
  if (Buffer.byteLength(json, "utf8") > 4 * 1024) throw new RunError("OUTPUT_TOO_LARGE");
  return `${json}\n`;
}

export async function runCommand(argv: string[]): Promise<number> {
  const options = parseRunArgs(argv);
  const result = await runFreshTask(options);
  process.stdout.write(renderTerminal(result.terminal));
  return result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommand(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => {
    const code = error instanceof RunError ? error.code : "INVALID_ARGUMENTS";
    process.stdout.write(`${JSON.stringify({ version: 1, scope: "fresh-local-feedback", status: "failed", error: code, memo: "disabled", acceptancePending: true, tokenUsage: null })}\n`);
    process.exitCode = 1;
  });
}
