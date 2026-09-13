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
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseArgs } from "node:util";

import { validateWorkspaceLinks } from "../check-workspace-links";
import { validateNativeReport } from "../ci-required-results";
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
const TERMINATION_GRACE_MS = 1_000;
const VERIFY_GRACE_MS = 250;
const CLEANUP_WINDOW_MS = 6_000;
const STREAM_SETTLEMENT_GRACE_MS = 1_000;
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

export type ProcessIdentity = { startToken: string; commandSha256: string };
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
  dependencies: {
    packageVersion: string;
    vitestVersion: string;
    packageJsonSha256: string;
    vitestPackageSha256: string;
    vitestEntrySha256: string;
  };
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
  rejectDuplicateOptions(argv);
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

function rejectDuplicateOptions(argv: string[]): void {
  const seen = new Set<string>();
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--") continue;
    const name = token.slice(2).split("=", 1)[0];
    if (seen.has(name)) fail("DUPLICATE_ARGUMENT");
    seen.add(name);
  }
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

export function ensurePathAncestors(root: string, target: string): void {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("FOREIGN_PATH");
  let rootStat: Stats;
  try { rootStat = lstatSync(absoluteRoot); } catch { fail("PATH_UNAVAILABLE"); }
  const uid = process.getuid?.();
  if (rootStat.isSymbolicLink()) fail("SYMLINK_PATH");
  if (!rootStat.isDirectory() || (uid !== undefined && rootStat.uid !== uid)) fail("UNSAFE_DIRECTORY");
  let current = absoluteRoot;
  const parts = relative ? relative.split(path.sep) : [];
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); } catch { fail("PATH_UNAVAILABLE"); }
    if (stat.isSymbolicLink()) fail("SYMLINK_PATH");
    if ((uid !== undefined && stat.uid !== uid) || (index < parts.length - 1 && !stat.isDirectory())) fail("UNSAFE_DIRECTORY");
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
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== mode) fail("UNSAFE_DIRECTORY");
}

type DirectoryObservation = { path: string; dev: number; ino: number; uid: number; mode: number };

function observeDirectory(directory: string, expectedMode: number): DirectoryObservation {
  ensurePathAncestors(ROOT, directory);
  let stat: Stats;
  try { stat = lstatSync(directory); } catch { fail("PATH_UNAVAILABLE"); }
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== expectedMode) fail("UNSAFE_DIRECTORY");
  return { path: directory, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o777 };
}

function observeDirectories(entries: Array<[string, number]>): DirectoryObservation[] {
  return entries.map(([directory, mode]) => observeDirectory(directory, mode));
}

function verifyDirectories(observations: DirectoryObservation[]): void {
  for (const expected of observations) {
    const current = observeDirectory(expected.path, expected.mode);
    if (current.dev !== expected.dev || current.ino !== expected.ino || current.uid !== expected.uid || current.mode !== expected.mode) fail("DIRECTORY_CHANGED");
  }
}

function captureDirectoryIdentities(root: string, targetDirectory: string): DirectoryObservation[] {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetDirectory);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("FOREIGN_PATH");
  const parts = relative ? relative.split(path.sep) : [];
  const observations: DirectoryObservation[] = [];
  let current = absoluteRoot;
  for (const part of ["", ...parts]) {
    if (part) current = path.join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); } catch { fail("PATH_UNAVAILABLE"); }
    const uid = process.getuid?.();
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)) fail("UNSAFE_DIRECTORY");
    observations.push({ path: current, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode: stat.mode & 0o777 });
  }
  return observations;
}

function verifyDirectoryIdentities(observations: DirectoryObservation[]): void {
  for (const expected of observations) {
    let current: Stats;
    try { current = lstatSync(expected.path); } catch { fail("PATH_UNAVAILABLE"); }
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino
      || current.uid !== expected.uid || (current.mode & 0o777) !== expected.mode) fail("DIRECTORY_CHANGED");
  }
}

function readOwnedBytes(file: string, limit: number, expectedMode: number, minimum = 1): Buffer {
  const ancestors = captureDirectoryIdentities(ROOT, path.dirname(file));
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { fail("NATIVE_REPORT_UNAVAILABLE"); }
  try {
    const before = fstatSync(fd);
    const uid = process.getuid?.();
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || (uid !== undefined && before.uid !== uid)
      || (before.mode & 0o777) !== expectedMode || before.size < minimum || before.size > limit) fail("UNSAFE_FILE");
    const data = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < data.length) {
      const bytes = readSync(fd, data, offset, data.length - offset, offset);
      if (bytes <= 0) fail("FILE_CHANGED");
      offset += bytes;
    }
    const after = fstatSync(fd);
    const leaf = lstatSync(file);
    if (!after.isFile() || after.isSymbolicLink() || after.nlink !== before.nlink || after.uid !== before.uid
      || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
      || after.mtimeMs !== before.mtimeMs || (after.mode & 0o777) !== expectedMode
      || !leaf.isFile() || leaf.isSymbolicLink() || leaf.dev !== before.dev || leaf.ino !== before.ino
      || leaf.uid !== before.uid || leaf.nlink !== before.nlink || (leaf.mode & 0o777) !== expectedMode) fail("FILE_CHANGED");
    verifyDirectoryIdentities(ancestors);
    return data;
  } finally { closeSync(fd); }
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

function dependencyObservation(): RunRecord["dependencies"] {
  const observed = (relative: string, limit: number) => {
    const file = path.join(ROOT, relative);
    const stat = checkRegularFile(file, limit);
    const bytes = Buffer.from(readFileSync(file, "utf8"), "utf8");
    if (bytes.length !== stat.size) fail("DEPENDENCY_CHANGED");
    return { bytes, sha256: digest(bytes) };
  };
  const packageJson = observed("package.json", 512 * 1024);
  const vitestPackage = observed("node_modules/vitest/package.json", 512 * 1024);
  const vitestEntry = observed("node_modules/vitest/vitest.mjs", 512 * 1024);
  let packageVersion: string;
  let vitestVersion: string;
  try {
    packageVersion = JSON.parse(packageJson.bytes.toString("utf8")).version;
    vitestVersion = JSON.parse(vitestPackage.bytes.toString("utf8")).version;
  } catch { fail("DEPENDENCY_METADATA"); }
  if (typeof packageVersion !== "string" || typeof vitestVersion !== "string") fail("DEPENDENCY_METADATA");
  return { packageVersion, vitestVersion, packageJsonSha256: packageJson.sha256, vitestPackageSha256: vitestPackage.sha256, vitestEntrySha256: vitestEntry.sha256 };
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

export function buildFreshChildEnvironment(spec: TaskSpec, tempDirectory: string, inherited: NodeJS.ProcessEnv = process.env): { env: NodeJS.ProcessEnv; mode: "mock" | "api" } {
  for (const key of REJECTED_STARTUP_ENV) {
    if (inherited[key]?.trim()) fail("HOST_STARTUP_INJECTION");
  }
  for (const [key, value] of Object.entries(inherited)) {
    if (key.startsWith("DYLD_") && value?.trim()) fail("HOST_STARTUP_INJECTION");
  }
  const invocation = buildVitestInvocation([], inherited, process.platform);
  const mode = invocation.env.VITE_WISEEFF_RUNTIME_MODE;
  if (mode !== "mock" && mode !== "api") fail("UNKNOWN_RUNTIME_MODE");
  const env: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_HOST_ENV) if (inherited[key] !== undefined) env[key] = inherited[key];
  const nodeDirectory = path.dirname(process.execPath);
  env.PATH = `${nodeDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.TMPDIR = tempDirectory;
  env.TMP = tempDirectory;
  env.TEMP = tempDirectory;
  env.VITE_WISEEFF_RUNTIME_MODE = mode;
  if (spec.testConfigRuntimeMode === "mock") env.VITE_WISEEFF_TEST_CONFIG_RUNTIME_MODE = "mock";
  return { env, mode };
}

function childEnvironment(spec: TaskSpec, tempDirectory: string): { env: NodeJS.ProcessEnv; mode: "mock" | "api" } {
  return buildFreshChildEnvironment(spec, tempDirectory);
}

export function buildFreshArgv(spec: TaskSpec, phase: "discovery" | "execution", files: string[], vitest: string, nativeReportPath?: string): string[] {
  const nodeFlags = spec.testConfigRuntimeMode === "mock" ? ["--max-old-space-size=768"] : [];
  const common = ["--config", path.join(ROOT, spec.config), ...files];
  if (phase === "discovery") return [...nodeFlags, vitest, "list", "--filesOnly", "--json", ...common];
  if (!nativeReportPath) fail("NATIVE_REPORT_UNAVAILABLE");
  return [...nodeFlags, vitest, "run", ...common, "--reporter=default", "--reporter=json", `--outputFile=${nativeReportPath}`];
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

class BoundedFileCapture extends Transform {
  readonly chunks: Buffer[] = [];
  bytes = 0;
  constructor(private readonly limit: number, private readonly existingBytes = 0, private readonly retain = true) {
    super();
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null, data?: Buffer) => void): void {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (this.existingBytes + this.bytes + value.length > this.limit) {
      callback(new RunError("OUTPUT_LIMIT"));
      return;
    }
    this.bytes += value.length;
    if (this.retain) this.chunks.push(value);
    callback(null, value);
  }
  text(): string { return Buffer.concat(this.chunks).toString("utf8"); }
}

export type NativeRunOptions = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  stdoutPath: string;
  stderrPath: string;
  stdoutLimit: number;
  stdoutExistingBytes?: number;
  stderrExistingBytes?: number;
  deadlineAt: number;
  cancelSignal?: AbortSignal;
  readProcessIdentity?: (pid: number) => ProcessIdentity | undefined;
  openLog?: (file: string) => Writable;
};

export type NativeRunResult = {
  phase: PhaseObservation;
  stdout: string;
  lifecycleSettled: boolean;
  error: string | null;
};

type StreamSettlement = { results: PromiseSettledResult<unknown>[]; closed: boolean; timedOut: boolean };

function isClosed(stream: { closed?: boolean; writableFinished?: boolean }): boolean {
  const state = stream as { closed?: boolean; writableFinished?: boolean };
  return state.closed === true && (state.writableFinished === undefined || state.writableFinished === true);
}

export async function runNative(options: NativeRunOptions): Promise<NativeRunResult> {
  const startedMs = Date.now();
  let stdoutFile: Writable | undefined;
  let stderrFile: Writable | undefined;
  try {
    const openLog = options.openLog ?? openOwnedAppend;
    stdoutFile = openLog(options.stdoutPath);
    stderrFile = openLog(options.stderrPath);
  } catch (error) {
    stdoutFile?.destroy();
    stderrFile?.destroy();
    throw error;
  }
  if (!stdoutFile || !stderrFile) {
    stdoutFile?.destroy();
    stderrFile?.destroy();
    fail("LOG_OPEN_FAILED");
  }
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, options.argv, {
      cwd: options.cwd,
      env: options.env,
      detached: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    stdoutFile.destroy(); stderrFile.destroy();
    throw error;
  }
  if (!child.pid || !child.stdout || !child.stderr) {
    stdoutFile.destroy(); stderrFile.destroy();
    fail("CHILD_LAUNCH_FAILED");
  }
  const pid = child.pid;
  const readIdentity = options.readProcessIdentity ?? fixedProcessIdentity;
  const identity = readIdentity(pid);
  const stdoutCapture = new BoundedFileCapture(options.stdoutLimit, options.stdoutExistingBytes ?? 0, true);
  const stderrCapture = new BoundedFileCapture(LOG_LIMIT, options.stderrExistingBytes ?? 0, false);
  const controller = new AbortController();
  let timeoutHandle: NodeJS.Timeout | undefined;
  let failure: Error | undefined;
  let cleanupDeadline: number | undefined;
  let cleanupStarted = false;
  const stickyFailure = (error: unknown) => {
    failure ??= asError(error);
    cleanupDeadline ??= Date.now() + CLEANUP_WINDOW_MS;
    cleanupStarted = true;
    if (!controller.signal.aborted) controller.abort(failure);
  };
  const onPipelineFailure = (error: unknown) => {
    stickyFailure(error);
    return Promise.reject(error);
  };
  const onCancel = () => stickyFailure(options.cancelSignal?.reason instanceof Error ? options.cancelSignal.reason : new RunError("OWNER_CANCELLED"));
  const stdoutDone = pipeline(child.stdout, stdoutCapture, stdoutFile).catch(onPipelineFailure);
  const stderrDone = pipeline(child.stderr, stderrCapture, stderrFile).catch(onPipelineFailure);
  void stdoutDone.catch(() => undefined);
  void stderrDone.catch(() => undefined);
  if (!identity) {
    failure = new RunError("CHILD_IDENTITY_UNAVAILABLE");
    child.stdout.destroy(failure);
    child.stderr.destroy(failure);
    const settled = await settleStreams([stdoutDone, stderrDone], [child.stdout, child.stderr, stdoutFile, stderrFile], Date.now() + CLEANUP_WINDOW_MS);
    for (const result of settled.results) if (result.status === "rejected") failure ??= asError(result.reason);
    const finishedMs = Date.now();
    return {
      phase: { startedAt: new Date(startedMs).toISOString(), finishedAt: new Date(finishedMs).toISOString(), wallMs: finishedMs - startedMs, exitCode: child.exitCode, signal: child.signalCode, stdoutBytes: stdoutCapture.bytes, stderrBytes: stderrCapture.bytes, lifecycleSettled: false },
      stdout: stdoutCapture.text(), lifecycleSettled: false, error: errorCode(failure),
    };
  }
  if (options.cancelSignal?.aborted) onCancel();
  else options.cancelSignal?.addEventListener("abort", onCancel, { once: true });
  const wait = waitForOwnedProcessGroupExit(child, {
    signal: controller.signal,
    expectedProcessIdentity: identity,
    readProcessIdentity: readIdentity,
    terminateGraceMs: TERMINATION_GRACE_MS,
    verifyGraceMs: VERIFY_GRACE_MS,
  });
  timeoutHandle = setTimeout(() => stickyFailure(new RunError("NATIVE_TIMEOUT")), Math.max(1, options.deadlineAt - Date.now()));
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  try {
    exitCode = await wait;
  } catch (error) {
    failure ??= asError(error);
    cleanupDeadline ??= Date.now() + CLEANUP_WINDOW_MS;
    if (!controller.signal.aborted) controller.abort(failure);
    await wait.catch((waitError) => { failure ??= asError(waitError); });
  }
  clearTimeout(timeoutHandle);
  const settled = await settleStreams(
    [stdoutDone, stderrDone],
    [child.stdout, child.stderr, stdoutFile, stderrFile],
    cleanupDeadline ?? Date.now() + STREAM_SETTLEMENT_GRACE_MS,
  );
  for (const result of settled.results) if (result.status === "rejected") failure ??= asError(result.reason);
  options.cancelSignal?.removeEventListener("abort", onCancel);
  signal = child.signalCode;
  let groupSettled = false;
  try {
    groupSettled = await waitForGroupAbsent(pid, VERIFY_GRACE_MS);
    const cleanupRemaining = cleanupDeadline === undefined ? Number.POSITIVE_INFINITY : cleanupDeadline - Date.now();
    if (!groupSettled && !cleanupStarted && cleanupRemaining > 4_750 && sameIdentity(identity, readIdentity(pid))) {
      cleanupStarted = true;
      await stopOwnedProcessGroup(child, {
        expectedProcessIdentity: identity,
        readProcessIdentity: readIdentity,
        terminateGraceMs: TERMINATION_GRACE_MS,
        verifyGraceMs: VERIFY_GRACE_MS,
      });
      groupSettled = await waitForGroupAbsent(pid, VERIFY_GRACE_MS);
    }
  } catch (error) {
    failure ??= asError(error);
  }
  if (!groupSettled) failure ??= new RunError("CHILD_GROUP_UNSETTLED");
  if (settled.timedOut) failure ??= new RunError("STREAM_SETTLEMENT_TIMEOUT");
  const finishedMs = Date.now();
  const phase: PhaseObservation = {
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    wallMs: finishedMs - startedMs,
    exitCode,
    signal,
    stdoutBytes: stdoutCapture.bytes,
    stderrBytes: stderrCapture.bytes,
    lifecycleSettled: groupSettled && settled.closed && !settled.timedOut,
  };
  return { phase, stdout: stdoutCapture.text(), lifecycleSettled: phase.lifecycleSettled, error: failure ? errorCode(failure) : null };
}

function openOwnedAppend(file: string): ReturnType<typeof createWriteStream> {
  const stat = checkRegularFile(file, LOG_LIMIT, 0o600);
  const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    const uid = process.getuid?.();
    if (!opened.isFile() || opened.nlink !== 1 || (uid !== undefined && opened.uid !== uid) || (opened.mode & 0o777) !== 0o600 || opened.ino !== stat.ino || opened.dev !== stat.dev) fail("UNSAFE_FILE");
  } catch (error) {
    try { closeSync(fd); } catch { /* preserve the original failure */ }
    throw error;
  }
  return createWriteStream(file, { fd, autoClose: true, emitClose: true });
}

async function settleStreams(
  promises: Promise<unknown>[],
  streams: Array<{ destroy(error?: Error): void; closed?: boolean; writableFinished?: boolean }>,
  deadlineAt: number,
): Promise<StreamSettlement> {
  const all = Promise.allSettled(promises);
  const remaining = Math.max(1, deadlineAt - Date.now());
  const result = await Promise.race([
    all.then((results) => ({ results, timedOut: false as const })),
    new Promise<{ results: PromiseSettledResult<unknown>[]; timedOut: true; closed: false }>((resolve) => setTimeout(() => resolve({ results: [], closed: false, timedOut: true }), remaining)),
  ]);
  if (!result.timedOut) return { results: result.results, closed: streams.every((stream) => isClosed(stream)), timedOut: false };
  const reason = new RunError("STREAM_SETTLEMENT_TIMEOUT");
  streams.forEach((stream) => stream.destroy(reason));
  const settled = await Promise.race([
    all,
    new Promise<PromiseSettledResult<unknown>[]>((resolve) => setTimeout(() => resolve([]), STREAM_SETTLEMENT_GRACE_MS)),
  ]);
  return { results: settled, closed: streams.every((stream) => isClosed(stream)), timedOut: true };
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

export function writeAtomicRecord(runDirectory: string, value: RunRecord): void {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, "utf8") > RECORD_LIMIT) fail("RECORD_TOO_LARGE");
  const temporary = path.join(runDirectory, `${RECORD_NAME}.${process.pid}.tmp`);
  const final = path.join(runDirectory, RECORD_NAME);
  ensurePathAncestors(ROOT, runDirectory);
  const ancestors = captureDirectoryIdentities(ROOT, runDirectory);
  verifyDirectoryIdentities(ancestors);
  const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeFileSync(fd, `${json}\n`, "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  const temporaryStat = checkRegularFile(temporary, RECORD_LIMIT, 0o600);
  verifyDirectoryIdentities(ancestors);
  linkSync(temporary, final);
  const linkedStat = checkRegularFile(final, RECORD_LIMIT, 0o600);
  if (linkedStat.dev !== temporaryStat.dev || linkedStat.ino !== temporaryStat.ino || linkedStat.nlink !== 2) fail("RECORD_PUBLICATION");
  unlinkSync(temporary);
  const publishedStat = checkRegularFile(final, RECORD_LIMIT, 0o600);
  if (publishedStat.dev !== temporaryStat.dev || publishedStat.ino !== temporaryStat.ino || publishedStat.nlink !== 1) fail("RECORD_PUBLICATION");
  verifyDirectoryIdentities(ancestors);
}

type RunStorage = {
  runId: string;
  directory: string;
  nativeReport: string;
  stdout: string;
  stderr: string;
  lockPath: string;
  lockFd: number;
  lockStat: Stats;
  lockText: string;
  directories: DirectoryObservation[];
};

export function disposeOwnedLock(lockPath: string, lockFd: number, original: Stats, expectedText: string): boolean {
  let removed = false;
  try {
    const current = lstatSync(lockPath);
    const uid = process.getuid?.();
    const owned = current.isFile() && !current.isSymbolicLink() && current.nlink === 1
      && (current.mode & 0o777) === 0o600 && (uid === undefined || current.uid === uid)
      && current.dev === original.dev && current.ino === original.ino
      && readFileSync(lockPath, "utf8") === expectedText;
    if (owned) {
      unlinkSync(lockPath);
      removed = true;
    }
  } catch { /* retain the lock whenever its ownership or replacement is uncertain */ }
  try { closeSync(lockFd); } catch { /* the descriptor may already be closed */ }
  return removed;
}

function createStorage(task: TaskId): RunStorage {
  const workDirectory = path.join(ROOT, "work");
  ensureDirectory(workDirectory, 0o755);
  ensureDirectory(RUNS_DIRECTORY, 0o755);
  const directories = observeDirectories([[ROOT, 0o755], [workDirectory, 0o755], [RUNS_DIRECTORY, 0o755]]);
  const lockPath = path.join(RUNS_DIRECTORY, LOCK_NAMES[task]);
  if (!fixedProcessIdentity(process.pid)) fail("OWNER_IDENTITY_UNAVAILABLE");
  let lockFd: number;
  try {
    lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("TASK_LOCK_BUSY");
    fail("TASK_LOCK_UNAVAILABLE");
  }
  let lockStat: Stats;
  try { lockStat = fstatSync(lockFd); }
  catch (error) {
    try { closeSync(lockFd); } catch { /* retain the lock when descriptor state is uncertain */ }
    throw error;
  }
  let expectedLockText = "";
  let runId: string;
  let directory: string;
  for (;;) {
    runId = randomUUID();
    if (!RUN_ID.test(runId)) continue;
    directory = path.join(RUNS_DIRECTORY, runId);
    try { mkdirSync(directory, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        disposeOwnedLock(lockPath, lockFd, lockStat, expectedLockText);
        fail("RUN_DIRECTORY_UNAVAILABLE");
      }
    }
  }
  let runObservation: DirectoryObservation;
  try { runObservation = observeDirectory(directory, 0o700); }
  catch (error) {
    disposeOwnedLock(lockPath, lockFd, lockStat, expectedLockText);
    throw error;
  }
  const identity = fixedProcessIdentity(process.pid);
  if (!identity) {
    disposeOwnedLock(lockPath, lockFd, lockStat, expectedLockText);
    fail("OWNER_IDENTITY_UNAVAILABLE");
  }
  const text = JSON.stringify({ schemaVersion: 1, taskId: task, pid: process.pid, runId, identity });
  try {
    writeFileSync(lockFd, text, "utf8");
    fsyncSync(lockFd);
    expectedLockText = text;
    for (const name of [STDOUT_NAME, STDERR_NAME, NATIVE_REPORT_NAME]) createOwnedEmptyFile(path.join(directory, name));
    return { runId, directory, nativeReport: path.join(directory, NATIVE_REPORT_NAME), stdout: path.join(directory, STDOUT_NAME), stderr: path.join(directory, STDERR_NAME), lockPath, lockFd, lockStat, lockText: text, directories: [...directories, runObservation] };
  } catch (error) {
    disposeOwnedLock(lockPath, lockFd, lockStat, expectedLockText);
    throw error;
  }
}

function releaseStorage(storage: RunStorage): boolean {
  return disposeOwnedLock(storage.lockPath, storage.lockFd, storage.lockStat, storage.lockText);
}

function fileHash(file: string, maxBytes: number): { sha256: string; bytes: number } {
  const stat = checkRegularFile(file, maxBytes, 0o600);
  const value = Buffer.from(readFileSync(file, "utf8"), "utf8");
  if (value.length !== stat.size) fail("FILE_CHANGED");
  return { sha256: digest(value), bytes: value.length };
}

export function parseDiscovery(text: string, files: string[]): string[] {
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
  const discoveryArgv = buildFreshArgv(spec, "discovery", files, vitest);
  const storage = createStorage(spec.id);
  const startedAt = new Date().toISOString();
  const tempDirectory = path.join(storage.directory, "tmp");
  let env: NodeJS.ProcessEnv;
  let mode: "mock" | "api";
  try {
    mkdirSync(tempDirectory, { mode: 0o700 });
    storage.directories.push(observeDirectory(tempDirectory, 0o700));
    ({ env, mode } = childEnvironment(spec, tempDirectory));
  } catch (error) {
    releaseStorage(storage);
    throw error;
  }
  const runArgv = buildFreshArgv(spec, "execution", files, vitest, storage.nativeReport);
  const record = newRecord({ runId: storage.runId, task: spec, preview, sources, dependencies, mode, discoveryArgv, runArgv, startedAt, budgetMs: spec.budgetMs });
  let lifecycleSettled = true;
  const ownerCancellation = new AbortController();
  const onOwnerSignal = () => ownerCancellation.abort(new RunError("OWNER_CANCELLED"));
  process.once("SIGINT", onOwnerSignal);
  process.once("SIGTERM", onOwnerSignal);
  try {
    if (ownerCancellation.signal.aborted) throw ownerCancellation.signal.reason;
    const workspaceErrors = await validateWorkspaceLinks(ROOT);
    if (workspaceErrors.length > 0) throw new RunError("WORKSPACE_LINKS_INVALID");
    const deadlineAt = Date.now() + spec.budgetMs;
    verifyDirectories(storage.directories);
    const discovery = await runNative({ argv: discoveryArgv, env, cwd: ROOT, stdoutPath: storage.stdout, stderrPath: storage.stderr, stdoutLimit: DISCOVERY_LIMIT, stdoutExistingBytes: 0, stderrExistingBytes: 0, deadlineAt, cancelSignal: ownerCancellation.signal });
    applyPhase(record, "discovery", discovery.phase);
    lifecycleSettled &&= discovery.lifecycleSettled;
    if (discovery.error) throw new RunError(discovery.error);
    if (discovery.phase.exitCode !== 0 || discovery.phase.signal) throw new RunError("DISCOVERY_CHILD_FAILED");
    record.native.discoveredFiles = parseDiscovery(discovery.stdout, files);
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0) throw new RunError("NATIVE_TIMEOUT");
    if (ownerCancellation.signal.aborted) throw ownerCancellation.signal.reason;
    const stdoutExistingBytes = lstatSync(storage.stdout).size;
    const stderrExistingBytes = lstatSync(storage.stderr).size;
    verifyDirectories(storage.directories);
    const execution = await runNative({ argv: runArgv, env, cwd: ROOT, stdoutPath: storage.stdout, stderrPath: storage.stderr, stdoutLimit: LOG_LIMIT, stdoutExistingBytes, stderrExistingBytes, deadlineAt, cancelSignal: ownerCancellation.signal });
    applyPhase(record, "execution", execution.phase);
    lifecycleSettled &&= execution.lifecycleSettled;
    if (execution.error) throw new RunError(execution.error);
    let nativeBytes: Buffer;
    try {
      verifyDirectories(storage.directories);
      nativeBytes = readOwnedBytes(storage.nativeReport, NATIVE_REPORT_LIMIT, 0o600);
    } catch { throw new RunError("NATIVE_REPORT_UNAVAILABLE"); }
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
    const afterDependencies = dependencyObservation();
    verifyDirectories(storage.directories);
    if (!isDeepStrictEqual(preview, afterPreview) || !isDeepStrictEqual(sources, afterSources) || !isDeepStrictEqual(dependencies, afterDependencies)) throw new RunError("SOURCE_DRIFT");
    record.claimedStatus = "passed";
  } catch (error) {
    const code = errorCode(asError(error));
    record.error = code;
    record.claimedStatus = "failed";
  }
  process.removeListener("SIGINT", onOwnerSignal);
  process.removeListener("SIGTERM", onOwnerSignal);
  const finishedAt = new Date().toISOString();
  record.finishedAt = finishedAt;
  record.wallMs = Date.parse(finishedAt) - Date.parse(record.startedAt);
  try {
    verifyDirectories(storage.directories);
    const stdout = fileHash(storage.stdout, LOG_LIMIT);
    const stderr = fileHash(storage.stderr, LOG_LIMIT);
    record.logs = { stdoutSha256: stdout.sha256, stderrSha256: stderr.sha256, stdoutBytes: stdout.bytes, stderrBytes: stderr.bytes };
  } catch (error) {
    record.error ??= errorCode(asError(error));
    record.claimedStatus = "failed";
    lifecycleSettled = false;
  }
  const canComplete = (record.claimedStatus === "passed" && record.native.reportSha256 !== null && lifecycleSettled)
    || (record.error !== null && record.native.reportSha256 !== null && lifecycleSettled);
  record.complete = canComplete;
  if (record.complete && !releaseStorage(storage)) {
    record.complete = false;
    record.claimedStatus = "failed";
    record.error = "LOCK_DISPOSITION_FAILED";
  } else if (!record.complete && lifecycleSettled) {
    releaseStorage(storage);
  }
  try { writeAtomicRecord(storage.directory, record); }
  catch (error) { record.complete = false; record.claimedStatus = "failed"; record.error = errorCode(asError(error)); }
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
