import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  implementationRoot,
  SOURCE_PATHS,
  taskSpec,
  type RunRecord,
  type SourceFileObservation,
  type TaskId,
} from "./run";

const ROOT = implementationRoot;
const RUNS_DIRECTORY = path.join(ROOT, "work", "verification-runs");
const RECORD_NAME = "record.json";
const NATIVE_REPORT_NAME = "native-report.json";
const STDOUT_NAME = "stdout.log";
const STDERR_NAME = "stderr.log";
const RECORD_LIMIT = 64 * 1024;
const LOG_LIMIT = 16 * 1024 * 1024;
const NATIVE_REPORT_LIMIT = 32 * 1024 * 1024;
const FULL_SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const TASK_IDS = ["ci-changed-paths", "feedback-frontend-client"] as const;
const SIGNALS = new Set<NodeJS.Signals>(["SIGABRT", "SIGALRM", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGIO", "SIGIOT", "SIGKILL", "SIGPIPE", "SIGPOLL", "SIGPROF", "SIGPWR", "SIGQUIT", "SIGSEGV", "SIGSTKFLT", "SIGSTOP", "SIGSYS", "SIGTERM", "SIGTRAP", "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG", "SIGUSR1", "SIGUSR2", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGWINCH"]);

export type RecordedReport = {
  version: 1;
  status: "record-readable";
  scope: "recorded-local-data";
  freshness: "unverified";
  acceptancePending: true;
  memo: "disabled";
  tokenUsage: null;
  runId: string;
  taskId: TaskId;
  claimedStatus: "passed" | "failed";
  sourceSha: string;
  tree: string;
  sourceDigest: string;
  native: { files: number; passed: number; skipped: number };
  observed: { startedAt: string; finishedAt: string; wallMs: number; exitCode: number | null; signal: NodeJS.Signals | null };
};

export class ReportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function fail(code: string): never {
  throw new ReportError(code);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code = "RECORD_SCHEMA"): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail(code);
}

function record(value: unknown, code = "RECORD_SCHEMA"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || (pattern && !pattern.test(value))) fail("RECORD_SCHEMA");
  return value;
}

function integerValue(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) fail("RECORD_SCHEMA");
  return Number(value);
}

function ensureRoot(): void {
  try {
    if (path.resolve(process.cwd()) !== ROOT || requireRealpath(process.cwd()) !== ROOT || requireRealpath(ROOT) !== ROOT) fail("NON_ROOT_CWD");
  } catch (error) {
    if (error instanceof ReportError) throw error;
    fail("ROOT_UNAVAILABLE");
  }
  ensureAncestors(ROOT, ROOT);
}

function requireRealpath(file: string): string { return realpathSync(file); }

function ensureAncestors(root: string, target: string): void {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(target);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("FOREIGN_PATH");
  let current = absoluteRoot;
  let rootStat: Stats;
  try { rootStat = lstatSync(absoluteRoot); } catch { fail("PATH_UNAVAILABLE"); }
  const uid = process.getuid?.();
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory() || (uid !== undefined && rootStat.uid !== uid)) fail("RUN_DIRECTORY");
  const parts = relative ? relative.split(path.sep) : [];
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); } catch { fail("PATH_UNAVAILABLE"); }
    if (stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (index < parts.length - 1 && !stat.isDirectory())) fail("RUN_DIRECTORY");
  }
}

type DirectoryObservation = { path: string; dev: number; ino: number; uid: number; mode: number };

export function captureDirectoryIdentities(root: string, targetDirectory: string, expectedModes = new Map<string, number>()): DirectoryObservation[] {
  const absoluteRoot = path.resolve(root);
  const absoluteTarget = path.resolve(targetDirectory);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail("FOREIGN_PATH");
  const observations: DirectoryObservation[] = [];
  let current = absoluteRoot;
  for (const part of ["", ...(relative ? relative.split(path.sep) : [])]) {
    if (part) current = path.join(current, part);
    let stat: Stats;
    try { stat = lstatSync(current); } catch { fail("REPORT_FILE"); }
    const uid = process.getuid?.();
    const mode = stat.mode & 0o777;
    const expectedMode = expectedModes.get(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid)
      || (expectedMode !== undefined && mode !== expectedMode)) fail("REPORT_FILE");
    observations.push({ path: current, dev: stat.dev, ino: stat.ino, uid: stat.uid, mode });
  }
  return observations;
}

export function verifyDirectoryIdentities(observations: DirectoryObservation[]): void {
  for (const expected of observations) {
    let stat: Stats;
    try { stat = lstatSync(expected.path); } catch { fail("REPORT_CHANGED"); }
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== expected.dev || stat.ino !== expected.ino
      || stat.uid !== expected.uid || (stat.mode & 0o777) !== expected.mode) fail("REPORT_CHANGED");
  }
}

export function readOwned(file: string, limit: number, mode = 0o600, minimum = 1): Buffer {
  const ancestors = captureDirectoryIdentities(ROOT, path.dirname(file));
  ensureAncestors(ROOT, path.dirname(file));
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); } catch { fail("REPORT_FILE"); }
  try {
    const stat = fstatSync(fd);
    let leafBefore: Stats;
    try { leafBefore = lstatSync(file); } catch { fail("REPORT_FILE"); }
    const uid = process.getuid?.();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)
      || (stat.mode & 0o777) !== mode || stat.size < minimum || stat.size > limit
      || !leafBefore.isFile() || leafBefore.isSymbolicLink() || leafBefore.dev !== stat.dev || leafBefore.ino !== stat.ino
      || leafBefore.uid !== stat.uid || leafBefore.nlink !== stat.nlink || (leafBefore.mode & 0o777) !== mode) fail("REPORT_FILE");
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const bytes = readSync(fd, data, offset, data.length - offset, offset);
      if (bytes <= 0) fail("REPORT_CHANGED");
      offset += bytes;
    }
    const after = fstatSync(fd);
    let leafAfter: Stats;
    try { leafAfter = lstatSync(file); } catch { fail("REPORT_CHANGED"); }
    if (data.length !== stat.size || !after.isFile() || after.isSymbolicLink() || after.nlink !== stat.nlink
      || after.uid !== stat.uid || after.dev !== stat.dev || after.ino !== stat.ino || after.size !== stat.size
      || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || (after.mode & 0o777) !== mode
      || !leafAfter.isFile() || leafAfter.isSymbolicLink() || leafAfter.dev !== stat.dev || leafAfter.ino !== stat.ino
      || leafAfter.uid !== stat.uid || leafAfter.nlink !== stat.nlink || (leafAfter.mode & 0o777) !== mode) fail("REPORT_CHANGED");
    verifyDirectoryIdentities(ancestors);
    return data;
  } finally { closeSync(fd); }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function framedDigest(entries: Array<[string, Buffer]>): string {
  const digest = createHash("sha256");
  for (const [name, data] of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(nameBytes.length));
    digest.update(length).update(nameBytes);
    length.writeBigUInt64BE(BigInt(data.length));
    digest.update(length).update(data);
  }
  return digest.digest("hex");
}

function inspectCurrentSources(): { sourceDigest: string; sourceFiles: SourceFileObservation[] } {
  const entries: Array<[string, Buffer]> = [];
  const sourceFiles: SourceFileObservation[] = [];
  for (const relative of SOURCE_PATHS) {
    const file = path.join(ROOT, relative);
    ensureAncestors(ROOT, file);
    let stat: Stats;
    try { stat = lstatSync(file); } catch { fail("SOURCE_UNAVAILABLE"); }
    const uid = process.getuid?.();
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (uid !== undefined && stat.uid !== uid)) fail("SOURCE_UNAVAILABLE");
    const data = readOwned(file, 8 * 1024 * 1024, stat.mode & 0o777);
    sourceFiles.push({ path: relative, bytes: data.length, sha256: hash(data) });
    entries.push([relative, data]);
  }
  return { sourceDigest: framedDigest(entries), sourceFiles };
}

export function parseRunRecord(value: unknown, runId: string): RunRecord {
  const item = record(value);
  exactKeys(item, [
    "schemaVersion", "complete", "scope", "runId", "root", "taskId", "acceptedBase", "head", "tree", "executedSha", "headTree", "sourceDigest", "sourceFiles", "policyDigest", "nodeVersion", "dependencies", "childEnvRuntimeMode", "testConfigRuntimeMode", "discoveryArgv", "runArgv", "discovery", "execution", "startedAt", "finishedAt", "wallMs", "activityBudgetMs", "exitCode", "signal", "native", "logs", "claimedStatus", "error", "memo", "acceptancePending", "tokenUsage",
  ]);
  if (item.schemaVersion !== 1 || item.complete !== true || item.scope !== "fresh-local-feedback" || item.runId !== runId || item.root !== ROOT
    || !TASK_IDS.includes(item.taskId as TaskId) || !FULL_SHA.test(String(item.acceptedBase)) || !FULL_SHA.test(String(item.head))
    || !FULL_SHA.test(String(item.tree)) || !FULL_SHA.test(String(item.executedSha)) || !FULL_SHA.test(String(item.headTree))
    || !SHA256.test(String(item.sourceDigest)) || !SHA256.test(String(item.policyDigest)) || typeof item.nodeVersion !== "string"
    || (item.childEnvRuntimeMode !== "mock" && item.childEnvRuntimeMode !== "api")
    || (item.testConfigRuntimeMode !== null && item.testConfigRuntimeMode !== "mock")
    || item.claimedStatus !== "passed" && item.claimedStatus !== "failed" || item.memo !== "disabled"
    || item.acceptancePending !== true || item.tokenUsage !== null) fail("RECORD_SCHEMA");
  const sourceFilesRaw = item.sourceFiles;
  if (!Array.isArray(sourceFilesRaw) || sourceFilesRaw.length !== SOURCE_PATHS.length) fail("RECORD_SCHEMA");
  const sourceFiles = sourceFilesRaw.map((raw) => {
    const entry = record(raw);
    exactKeys(entry, ["path", "bytes", "sha256"]);
    return { path: stringValue(entry.path), bytes: integerValue(entry.bytes), sha256: stringValue(entry.sha256, SHA256) };
  });
  if (sourceFiles.map((entry) => entry.path).join("\0") !== SOURCE_PATHS.join("\0")) fail("RECORD_SOURCE");
  const dependencies = record(item.dependencies);
  exactKeys(dependencies, ["packageVersion", "vitestVersion", "packageJsonSha256", "vitestPackageSha256", "vitestEntrySha256"]);
  stringValue(dependencies.packageVersion); stringValue(dependencies.vitestVersion);
  stringValue(dependencies.packageJsonSha256, SHA256); stringValue(dependencies.vitestPackageSha256, SHA256); stringValue(dependencies.vitestEntrySha256, SHA256);
  const argv = (value: unknown): string[] => {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.includes("\0"))) fail("RECORD_SCHEMA");
    return value as string[];
  };
  const phase = (value: unknown): RunRecord["discovery"] => {
    if (value === null) return null;
    const entry = record(value);
    exactKeys(entry, ["startedAt", "finishedAt", "wallMs", "exitCode", "signal", "stdoutBytes", "stderrBytes", "lifecycleSettled"]);
    stringValue(entry.startedAt); stringValue(entry.finishedAt); integerValue(entry.wallMs);
    if (entry.exitCode !== null) integerValue(entry.exitCode);
    if (entry.signal !== null && (typeof entry.signal !== "string" || !SIGNALS.has(entry.signal as NodeJS.Signals))) fail("RECORD_SCHEMA");
    integerValue(entry.stdoutBytes); integerValue(entry.stderrBytes);
    if (typeof entry.lifecycleSettled !== "boolean") fail("RECORD_SCHEMA");
    return entry as unknown as RunRecord["discovery"];
  };
  item.discoveryArgv = argv(item.discoveryArgv);
  item.runArgv = argv(item.runArgv);
  item.discovery = phase(item.discovery);
  item.execution = phase(item.execution);
  const native = record(item.native);
  exactKeys(native, ["discoveredFiles", "files", "passed", "skipped", "reportSha256"]);
  if (!Array.isArray(native.discoveredFiles) || native.discoveredFiles.some((entry) => typeof entry !== "string") || integerValue(native.files) < 0 || integerValue(native.passed) < 0 || integerValue(native.skipped) < 0
    || (native.reportSha256 !== null && !SHA256.test(String(native.reportSha256)))) fail("RECORD_SCHEMA");
  const logs = record(item.logs);
  exactKeys(logs, ["stdoutSha256", "stderrSha256", "stdoutBytes", "stderrBytes"]);
  stringValue(logs.stdoutSha256, SHA256); stringValue(logs.stderrSha256, SHA256); integerValue(logs.stdoutBytes); integerValue(logs.stderrBytes);
  if (typeof item.startedAt !== "string" || typeof item.finishedAt !== "string" || integerValue(item.wallMs) < 0 || integerValue(item.activityBudgetMs, 1) < 1
    || (item.exitCode !== null && !Number.isSafeInteger(item.exitCode)) || (item.signal !== null && (typeof item.signal !== "string" || !SIGNALS.has(item.signal as NodeJS.Signals)))
    || (item.error !== null && typeof item.error !== "string")) fail("RECORD_SCHEMA");
  return item as unknown as RunRecord;
}

function runDirectory(runId: string): string {
  if (!RUN_ID.test(runId)) fail("INVALID_RUN_ID");
  ensureRoot();
  const directory = path.join(RUNS_DIRECTORY, runId);
  ensureAncestors(ROOT, directory);
  let stat: Stats;
  try { stat = lstatSync(directory); } catch { fail("RUN_UNAVAILABLE"); }
  const uid = process.getuid?.();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== undefined && stat.uid !== uid) || (stat.mode & 0o777) !== 0o700) fail("RUN_DIRECTORY");
  return directory;
}

export function readRecordedReport(runId: string): RecordedReport {
  const directory = runDirectory(runId);
  const expectedModes = new Map([
    [ROOT, 0o755],
    [path.join(ROOT, "work"), 0o755],
    [RUNS_DIRECTORY, 0o755],
    [directory, 0o700],
  ]);
  const directories = captureDirectoryIdentities(ROOT, directory, expectedModes);
  const recordBytes = readOwned(path.join(directory, RECORD_NAME), RECORD_LIMIT);
  let parsed: unknown;
  try { parsed = JSON.parse(recordBytes.toString("utf8")); } catch { fail("RECORD_JSON"); }
  const item = parseRunRecord(parsed, runId);
  const spec = taskSpec(item.taskId);
  const expectedFiles = spec.files.map((file) => path.join(ROOT, file));
  if (item.native.discoveredFiles.length !== expectedFiles.length || item.native.discoveredFiles.some((file, index) => file !== expectedFiles[index])) fail("RECORD_NATIVE_FILES");
  const expectedCommon = ["--config", path.join(ROOT, spec.config), ...expectedFiles];
  const nodeFlags = spec.testConfigRuntimeMode === "mock" ? ["--max-old-space-size=768"] : [];
  const expectedDiscovery = [...nodeFlags, path.join(ROOT, "node_modules/vitest/vitest.mjs"), "list", "--filesOnly", "--json", ...expectedCommon];
  const expectedRun = [...nodeFlags, path.join(ROOT, "node_modules/vitest/vitest.mjs"), "run", ...expectedCommon, "--reporter=default", "--reporter=json", `--outputFile=${path.join(directory, NATIVE_REPORT_NAME)}`];
  if (JSON.stringify(item.discoveryArgv) !== JSON.stringify(expectedDiscovery) || JSON.stringify(item.runArgv) !== JSON.stringify(expectedRun)) fail("RECORD_ARGV");
  if (!item.discovery || !item.execution || !item.discovery.lifecycleSettled || !item.execution.lifecycleSettled) fail("RECORD_LIFECYCLE");
  const source = inspectCurrentSources();
  if (source.sourceDigest !== item.sourceDigest || JSON.stringify(source.sourceFiles) !== JSON.stringify(item.sourceFiles)) fail("SOURCE_DRIFT");
  const stdout = readOwned(path.join(directory, STDOUT_NAME), LOG_LIMIT, 0o600, 0);
  const stderr = readOwned(path.join(directory, STDERR_NAME), LOG_LIMIT, 0o600, 0);
  if (hash(stdout) !== item.logs.stdoutSha256 || hash(stderr) !== item.logs.stderrSha256 || stdout.length !== item.logs.stdoutBytes || stderr.length !== item.logs.stderrBytes) fail("LOG_HASH");
  if (!item.native.reportSha256) fail("NATIVE_REPORT_UNAVAILABLE");
  const nativePath = path.join(directory, NATIVE_REPORT_NAME);
  const nativeBytes = readOwned(nativePath, NATIVE_REPORT_LIMIT, 0o600);
  if (nativeBytes.length > NATIVE_REPORT_LIMIT || hash(nativeBytes) !== item.native.reportSha256) fail("NATIVE_REPORT_HASH");
  verifyDirectoryIdentities(directories);
  return {
    version: 1,
    status: "record-readable",
    scope: "recorded-local-data",
    freshness: "unverified",
    acceptancePending: true,
    memo: "disabled",
    tokenUsage: null,
    runId: item.runId,
    taskId: item.taskId,
    claimedStatus: item.claimedStatus,
    sourceSha: item.executedSha,
    tree: item.tree,
    sourceDigest: item.sourceDigest,
    native: { files: item.native.files, passed: item.native.passed, skipped: item.native.skipped },
    observed: { startedAt: item.startedAt, finishedAt: item.finishedAt, wallMs: item.wallMs, exitCode: item.exitCode, signal: item.signal },
  };
}

export function parseReportArgs(argv: string[]): { runId: string } {
  const seen = new Set<string>();
  for (const token of argv) {
    if (!token.startsWith("--") || token === "--") continue;
    const name = token.slice(2).split("=", 1)[0];
    if (seen.has(name)) fail("DUPLICATE_ARGUMENT");
    seen.add(name);
  }
  let values: { run?: string };
  try {
    ({ values } = parseArgs({ args: argv, strict: true, allowPositionals: false, options: { run: { type: "string" } } }));
  } catch { fail("INVALID_ARGUMENTS"); }
  if (typeof values.run !== "string" || !RUN_ID.test(values.run)) fail("INVALID_ARGUMENTS");
  return { runId: values.run };
}

export function renderRecordedReport(report: RecordedReport): string {
  const json = JSON.stringify(report);
  if (Buffer.byteLength(json, "utf8") > 4 * 1024) fail("OUTPUT_TOO_LARGE");
  return `${json}\n`;
}

export function reportCommand(argv: string[]): number {
  const report = readRecordedReport(parseReportArgs(argv).runId);
  process.stdout.write(renderRecordedReport(report));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = reportCommand(process.argv.slice(2)); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ version: 1, status: "record-unavailable", scope: "recorded-local-data", freshness: "unverified", error: error instanceof ReportError ? error.code : "REPORT_REJECTED", memo: "disabled", acceptancePending: true, tokenUsage: null })}\n`);
    process.exitCode = 1;
  }
}
