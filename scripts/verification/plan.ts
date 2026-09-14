import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import {
  feedbackModuleIds,
  requiredGroups,
  requiredTasks,
  selectModules,
  type Changed,
  type RegistryModule,
  type Selection,
} from "./selection";

export const registryPath = "scripts/verification/registry.json";
const OUTPUT_LIMIT = 64 * 1024;
const GIT_LIMIT = 8 * 1024 * 1024;
const GIT_TIMEOUT = 15_000;

export class PreviewError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function fail(code: string): never { throw new PreviewError(code); }

type GitResult = { status: number | null; stdout: Buffer; error: Error | undefined };
type ConfigEntry = { key: string; value: string };
type Snapshot = { head: string; tree: string; status: string };
type RepositoryMetadata = Pick<Snapshot, "head" | "tree">;
type RegistryRead = { modules: RegistryModule[]; complete: boolean } | null;

const gitBase = [
  "--no-pager", "--no-replace-objects", "--no-optional-locks",
  "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "credential.helper=",
];
const gitConfigBase = ["--no-pager", "--no-replace-objects", "--no-optional-locks"];

function gitEnv(): NodeJS.ProcessEnv {
  return {
    PATH: "/usr/bin:/bin", HOME: "/", LANG: "C.UTF-8", LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", GIT_PAGER: "cat", PAGER: "cat",
  };
}

function gitRaw(cwd: string, args: string[], inspectConfig = false): GitResult {
  const command = !inspectConfig && args[0] === "diff" ? [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)] : args;
  const result = spawnSync("/usr/bin/git", [...(inspectConfig ? gitConfigBase : gitBase), ...command], {
    cwd, env: gitEnv(), encoding: "buffer", timeout: GIT_TIMEOUT, maxBuffer: GIT_LIMIT,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return { status: result.status, stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0), error: result.error };
}

function gitChecked(cwd: string, args: string[], inspectConfig = false): Buffer {
  const result = gitRaw(cwd, args, inspectConfig);
  if (result.error || result.status !== 0) return fail("GIT_FACTS_UNAVAILABLE");
  return result.stdout;
}

function decode(bytes: Buffer, code = "INVALID_UTF8"): string {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return fail(code);
  return text;
}

function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function validSha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{40}$/.test(value); }

function strictConfig(cwd: string): void {
  const text = decode(gitChecked(cwd, ["config", "--null", "--list"], true));
  const entries: ConfigEntry[] = text.split("\0").filter(Boolean).map(entry => {
    const split = entry.indexOf("\n");
    return split < 0 ? { key: entry.toLowerCase(), value: "" } : { key: entry.slice(0, split).toLowerCase(), value: entry.slice(split + 1) };
  });
  for (const { key, value } of entries) {
    if (key.startsWith("filter.") || key.startsWith("alias.") || key === "core.attributesfile"
      || key === "core.fsmonitor" || key === "core.hookspath" || key === "core.sshcommand" || key === "core.gitproxy"
      || key === "diff.external" || key.endsWith(".textconv") || key.endsWith(".helper") && key.startsWith("credential.")
      || key.endsWith(".insteadof") && key.startsWith("url.")) return fail("GIT_CONFIG_UNSAFE");
    if (key === "extensions.partialclone" || key.endsWith(".promisor") && key.startsWith("remote.") || key === "remote.origin.partialclonefilter") return fail("PARTIAL_REPOSITORY");
    if (key === "extensions.objectformat" && value !== "sha1") return fail("UNSUPPORTED_OBJECT_FORMAT");
    if ((key === "core.sparsecheckout" || key === "index.sparse") && /^(?:true|yes|on|1)$/i.test(value)) return fail("SPARSE_INDEX_UNSUPPORTED");
  }
}

function nulRecords(text: string, code: string): string[] {
  if (!text) return [];
  if (!text.endsWith("\0")) return fail(code);
  const body = text.slice(0, -1);
  if (!body) return fail(code);
  const records = body.split("\0");
  if (records.some(record => !record)) return fail(code);
  return records;
}

function inspectIndex(cwd: string): void {
  const records = nulRecords(decode(gitChecked(cwd, ["ls-files", "--stage", "--full-name", "-z"])), "INVALID_INDEX");
  for (const record of records) {
    const tab = record.indexOf("\t");
    const left = tab < 0 ? "" : record.slice(0, tab);
    const file = tab < 0 ? "" : record.slice(tab + 1);
    const fields = left.split(" ");
    if (fields.length !== 3 || !/^(?:100644|100755|120000|160000)$/.test(fields[0])
      || !/^[a-f0-9]{40}$/.test(fields[1]) || fields[1] === "0".repeat(40) || !/^[0-3]$/.test(fields[2]) || !file) return fail("INVALID_INDEX");
    if (fields[0] === "160000") return fail("GITLINK_UNSUPPORTED");
    if (fields[2] !== "0") return fail("UNMERGED_INDEX");
  }
}

function inspectHeadTree(cwd: string, head: string): void {
  const records = nulRecords(decode(gitChecked(cwd, ["ls-tree", "-r", "--full-tree", "-z", head])), "AMBIGUOUS_TREE");
  for (const record of records) {
    const tab = record.indexOf("\t");
    const left = tab < 0 ? "" : record.slice(0, tab);
    const file = tab < 0 ? "" : record.slice(tab + 1);
    const fields = left.split(" ");
    if (fields.length !== 3 || !/^(?:100644|100755|120000|160000)$/.test(fields[0])
      || fields[1] !== (fields[0] === "160000" ? "commit" : "blob") || !/^[a-f0-9]{40}$/.test(fields[2]) || !file) return fail("AMBIGUOUS_TREE");
    if (fields[0] === "160000") return fail("GITLINK_UNSUPPORTED");
  }
}

function requireRepositoryMetadata(cwd: string): RepositoryMetadata {
  strictConfig(cwd);
  if (decode(gitChecked(cwd, ["rev-parse", "--is-inside-work-tree"])).trim() !== "true"
    || decode(gitChecked(cwd, ["rev-parse", "--is-shallow-repository"])).trim() !== "false"
    || decode(gitChecked(cwd, ["rev-parse", "--show-object-format"])).trim() !== "sha1") return fail("UNCONFIRMED_REPOSITORY");
  if (decode(gitChecked(cwd, ["rev-parse", "--show-prefix"])) !== "\n") return fail("NON_ROOT_CWD");
  for (const relative of ["shallow", "info/grafts", "objects/info/alternates", "info/sparse-checkout"]) {
    const file = path.resolve(cwd, decode(gitChecked(cwd, ["rev-parse", "--path-format=absolute", "--git-path", relative])).trim());
    if (existsSync(file)) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return fail("UNCONFIRMED_REPOSITORY");
      return fail("UNCONFIRMED_REPOSITORY");
    }
  }
  const files = decode(gitChecked(cwd, ["ls-files", "-v", "-z"])).split("\0").filter(Boolean);
  if (files.some(entry => /^[a-zS] /.test(entry))) return fail("INDEX_STATE_UNSUPPORTED");
  const head = decode(gitChecked(cwd, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const tree = decode(gitChecked(cwd, ["rev-parse", "--verify", "HEAD^{tree}"])).trim();
  if (!validSha(head) || !validSha(tree)) return fail("UNCONFIRMED_GIT_STATE");
  inspectIndex(cwd);
  inspectHeadTree(cwd, head);
  return { head, tree };
}

function snapshot(cwd: string): Snapshot {
  const { head, tree } = requireRepositoryMetadata(cwd);
  const status = decode(gitChecked(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=none"]));
  return { head, tree, status };
}

function committedObject(cwd: string, value: string): string {
  const resolved = decode(gitChecked(cwd, ["rev-parse", "--verify", "--end-of-options", `${value}^{commit}`])).trim();
  if (resolved !== value) return fail("AMBIGUOUS_OBJECT");
  return resolved;
}

function treeFor(cwd: string, value: string): string {
  const tree = decode(gitChecked(cwd, ["rev-parse", "--verify", "--end-of-options", `${value}^{tree}`])).trim();
  if (!validSha(tree)) return fail("AMBIGUOUS_OBJECT");
  return tree;
}

function mergeBase(cwd: string, base: string, head: string): string {
  const bases = decode(gitChecked(cwd, ["merge-base", "--all", base, head])).trim().split(/\r?\n/).filter(Boolean);
  if (bases.length !== 1 || !validSha(bases[0])) return fail("AMBIGUOUS_MERGE_BASE");
  return bases[0];
}

function logicalHead(cwd: string, actual: string, base: string, requested: string | undefined): string {
  if (requested === undefined) return actual;
  if (!validSha(requested)) return fail("INVALID_HEAD");
  if (requested === actual) return requested;
  const parents = decode(gitChecked(cwd, ["rev-list", "--parents", "-n", "1", actual])).trim().split(" ");
  if (parents.length !== 3 || parents[0] !== actual || parents[1] !== base || parents[2] !== requested) return fail("HEAD_BINDING_INVALID");
  return requested;
}

function parseDiff(cwd: string, base: string, head: string): Changed[] {
  const fields = decode(gitChecked(cwd, ["diff", "--name-status", "--find-renames", "-z", base, head, "--"])).split("\0");
  if (fields.pop() !== "") return fail("INVALID_GIT_DIFF");
  const changed: Changed[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    const rename = /^[RC]/.test(status);
    if (!/^(?:[ACDMRTUXB]|[RC][0-9]+)$/.test(status)) return fail("INVALID_GIT_DIFF");
    const count = rename ? 2 : 1;
    const paths = fields.slice(index, index + count);
    index += count;
    if (paths.length !== count || paths.some(file => !file || file.includes("\0"))) return fail("INVALID_GIT_DIFF");
    changed.push({ status, paths });
  }
  return changed;
}

function verifyChangedModes(cwd: string, base: string, head: string, changed: Changed[]): void {
  for (const change of changed) {
    for (const [index, file] of change.paths.entries()) {
      const commit = change.status === "D" || (change.status.startsWith("R") && index === 0) ? base : head;
      if (treeEntries(cwd, commit, file).some(entry => entry.mode === "120000" || entry.mode === "160000")) return fail("AMBIGUOUS_TREE");
    }
  }
}

function record(value: unknown, code = "INVALID_REGISTRY"): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return fail(code);
  return value as Record<string, unknown>;
}

function sourcePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.includes("\\") || value.includes("\0")) return false;
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  return normalized.length > 0 && !normalized.split("/").some(part => part === "" || part === "." || part === "..");
}

function pathList(value: unknown, allowEmpty = false): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || new Set(value).size !== value.length || value.some(item => !sourcePath(item))) return fail("INVALID_REGISTRY");
  return value as string[];
}

function validateRegistryShape(value: unknown): RegistryModule[] {
  const root = record(value);
  if (root.schemaVersion !== 1 || !Array.isArray(root.modules) || root.modules.length === 0) return fail("INVALID_REGISTRY");
  const ids = new Set<string>();
  const modules = root.modules.map(raw => {
    const item = record(raw);
    const keys = Object.keys(item).sort().join(",");
    if (keys !== "browser,consumers,dependencies,id,paths,risk,status,tasks" || typeof item.id !== "string"
      || !/^[a-z][a-z0-9-]{0,63}$/.test(item.id) || ids.has(item.id) || !feedbackModuleIds.includes(item.id as typeof feedbackModuleIds[number])
      || item.status !== "observation-pending" || (item.risk !== "R2" && item.risk !== "R3")) return fail("INVALID_REGISTRY");
    ids.add(item.id);
    const paths = pathList(item.paths);
    const consumers = pathList(item.consumers);
    const dependencies = pathList(item.dependencies, true);
    const tasksRecord = record(item.tasks);
    const tasks: Record<string, string[]> = {};
    for (const [task, files] of Object.entries(tasksRecord)) {
      if (!(requiredTasks as readonly string[]).includes(task)) return fail("INVALID_REGISTRY");
      tasks[task] = pathList(files);
    }
    const browser = record(item.browser);
    if (Object.keys(browser).sort().join(",") !== "environment,flows,pages,roles,spec" || !sourcePath(browser.spec)
      || !Array.isArray(browser.pages) || !browser.pages.length || browser.pages.some(page => typeof page !== "string" || !page)
      || !Array.isArray(browser.roles) || !browser.roles.length || browser.roles.some(role => typeof role !== "string" || !role)
      || !Array.isArray(browser.flows) || !browser.flows.length || browser.flows.some(flow => typeof flow !== "string" || !flow)
      || browser.environment !== "owned-postgres-browser") return fail("INVALID_REGISTRY");
    return { id: item.id, status: "observation-pending", risk: item.risk as "R2" | "R3", paths, dependencies, consumers, tasks, browser: browser as RegistryModule["browser"] } as RegistryModule;
  });
  if (modules.some(module => module.dependencies.some(id => !ids.has(id)))) return fail("INVALID_REGISTRY");
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) return fail("REGISTRY_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id); modules.find(module => module.id === id)!.dependencies.forEach(visit); visiting.delete(id); visited.add(id);
  };
  modules.forEach(module => visit(module.id));
  return modules;
}

function treeEntries(cwd: string, commit: string, file: string): Array<{ mode: string; path: string }> {
  const text = decode(gitChecked(cwd, ["ls-tree", "-r", "-z", commit, "--", file]));
  return text.split("\0").filter(Boolean).map(entry => {
    const tab = entry.indexOf("\t");
    const left = tab < 0 ? "" : entry.slice(0, tab);
    const objectPath = tab < 0 ? "" : entry.slice(tab + 1);
    const fields = left.split(" ");
    if (fields.length !== 3 || !/^[0-7]{6}$/.test(fields[0]) || !objectPath) return fail("AMBIGUOUS_TREE");
    return { mode: fields[0], path: objectPath };
  });
}

function verifyDeclaredPaths(cwd: string, commit: string, modules: RegistryModule[]): boolean {
  let complete = true;
  for (const module of modules) {
    const paths = [...module.paths, ...module.consumers, ...Object.values(module.tasks).flat(), module.browser.spec];
    for (const declared of paths) {
      const entries = treeEntries(cwd, commit, declared);
      if (!entries.length) { complete = false; continue; }
      const directory = declared.endsWith("/");
      if (!directory && (entries.length !== 1 || entries[0].path !== declared)) { complete = false; continue; }
      if (entries.some(entry => entry.mode === "120000" || entry.mode === "160000")) return fail("AMBIGUOUS_TREE");
    }
  }
  return complete;
}

function readRegistry(cwd: string, commit: string): RegistryRead {
  const entries = treeEntries(cwd, commit, registryPath);
  if (!entries.length) return null;
  if (entries.length !== 1 || entries[0].path !== registryPath || entries[0].mode !== "100644") return fail("AMBIGUOUS_TREE");
  const result = gitRaw(cwd, ["show", `${commit}:${registryPath}`]);
  if (result.error || result.status !== 0) return fail("REGISTRY_UNAVAILABLE");
  let value: unknown;
  try { value = JSON.parse(decode(result.stdout)); } catch { return fail("INVALID_REGISTRY"); }
  const modules = validateRegistryShape(value);
  const idsComplete = modules.length === feedbackModuleIds.length && feedbackModuleIds.every(id => modules.some(module => module.id === id));
  return { modules, complete: idsComplete && verifyDeclaredPaths(cwd, commit, modules) };
}

function updateFrame(digest: ReturnType<typeof createHash>, value: Buffer): void {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(value.length));
  digest.update(length).update(value);
}

function policyDigest(): string {
  const sources = [
    ["plan.ts", new URL("./plan.ts", import.meta.url)],
    ["selection.ts", new URL("./selection.ts", import.meta.url)],
    ["verify.ts", new URL("../verify.ts", import.meta.url)],
  ] as const;
  const digest = createHash("sha256");
  try {
    for (const [name, source] of sources) {
      updateFrame(digest, Buffer.from(name, "utf8"));
      updateFrame(digest, Buffer.from(readFileSync(fileURLToPath(source), "latin1"), "latin1"));
    }
  } catch { return fail("POLICY_SOURCE_UNAVAILABLE"); }
  return digest.digest("hex");
}

function ensureBoundedPreview(preview: Preview): Preview {
  if (Buffer.byteLength(JSON.stringify(preview), "utf8") > OUTPUT_LIMIT) return fail("OUTPUT_TOO_LARGE");
  return preview;
}

export type Preview = {
  schemaVersion: 1;
  scope: "local-git-preview";
  executable: false;
  acceptancePending: true;
  environment: "unobserved";
  effectiveMode: "shadow";
  activation: "observation-pending";
  memo: "disabled";
  runId: null;
  attempt: null;
  acceptedBase: string;
  head: string;
  headTree: string;
  executedSha: string;
  tree: string;
  diffBase: string;
  changed: Changed[];
  registryDigest: string;
  policyDigest: string;
  requiredTasks: string[];
  requiredGroups: string[];
  selection: Selection;
  impact: Selection;
};

export function createPreview(options: { cwd: string; base: string; head?: string }): Preview {
  const cwd = path.resolve(options.cwd);
  if (!validSha(options.base)) return fail("INVALID_BASE");
  const before = snapshot(cwd);
  if (before.status) return fail("DIRTY_WORKTREE");
  const base = committedObject(cwd, options.base);
  const actualHead = committedObject(cwd, before.head);
  const logical = logicalHead(cwd, actualHead, base, options.head);
  const logicalTree = treeFor(cwd, logical);
  const diffBase = mergeBase(cwd, base, logical);
  const changed = parseDiff(cwd, diffBase, logical);
  verifyChangedModes(cwd, diffBase, logical, changed);
  const baseRegistry = readRegistry(cwd, base);
  const headRegistry = readRegistry(cwd, logical);
  const selection = selectModules({ changed, base: baseRegistry?.modules ?? null, head: headRegistry?.modules ?? null, registryMissing: !baseRegistry || !headRegistry || !baseRegistry.complete || !headRegistry.complete });
  const after = snapshot(cwd);
  if (before.head !== after.head || before.tree !== after.tree || before.status !== after.status) return fail("CONCURRENT_DRIFT");
  const registryDigest = hash({ base: baseRegistry, head: headRegistry });
  const policyDigestValue = policyDigest();
  const preview: Preview = {
    schemaVersion: 1, scope: "local-git-preview", executable: false, acceptancePending: true, environment: "unobserved", effectiveMode: "shadow",
    activation: "observation-pending", memo: "disabled", runId: null, attempt: null, acceptedBase: base, head: logical, headTree: logicalTree,
    executedSha: actualHead, tree: before.tree, diffBase, changed, registryDigest, policyDigest: policyDigestValue, requiredTasks: [...requiredTasks], requiredGroups: [...requiredGroups],
    selection, impact: selection,
  };
  return ensureBoundedPreview(preview);
}

export const createPlan = createPreview;

export function assertCiMergeIdentity(options: {
  cwd: string; acceptedBase: string; prHead: string; executionSha: string; executionTree: string;
}): void {
  if (![options.acceptedBase, options.prHead, options.executionSha, options.executionTree].every(validSha)) return fail("CI_IDENTITY_MISMATCH");
  const metadata = requireRepositoryMetadata(options.cwd);
  if (metadata.head !== options.executionSha || metadata.tree !== options.executionTree) return fail("CI_IDENTITY_MISMATCH");
  committedObject(options.cwd, options.acceptedBase);
  committedObject(options.cwd, options.prHead);
  committedObject(options.cwd, options.executionSha);
  const parents = decode(gitChecked(options.cwd, ["rev-list", "--parents", "-n", "1", options.executionSha])).trim().split(" ");
  if (parents.length !== 3 || parents[0] !== options.executionSha || parents[1] !== options.acceptedBase || parents[2] !== options.prHead) return fail("CI_IDENTITY_MISMATCH");
}

export function isSameSelection(left: Selection, right: Selection): boolean { return isDeepStrictEqual(left, right); }
