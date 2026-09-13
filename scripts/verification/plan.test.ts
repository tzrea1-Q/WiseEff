import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { assertCiMergeIdentity, createPreview } from "./plan";

const roots: string[] = [];
function fixture() {
  const cwd = mkdtempSync(`${tmpdir()}/git-preview-`);
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "preview"); git("config", "user.email", "preview@example.invalid");
  writeFileSync(`${cwd}/README.md`, "preview\n"); git("add", "."); git("commit", "-qm", "fixture");
  return { cwd, base: git("rev-parse", "HEAD") };
}

function submoduleFixture(dirty = true) {
  const cwd = mkdtempSync(`${tmpdir()}/git-preview-submodule-`);
  roots.push(cwd);
  const git = (repo: string, ...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const child = path.join(cwd, "module");
  mkdirSync(child);
  git(cwd, "init", "-q"); git(cwd, "config", "user.name", "preview"); git(cwd, "config", "user.email", "preview@example.invalid");
  git(child, "init", "-q"); git(child, "config", "user.name", "preview"); git(child, "config", "user.email", "preview@example.invalid");
  writeFileSync(path.join(child, ".gitattributes"), "tracked.txt filter=fixture\n");
  writeFileSync(path.join(child, "tracked.txt"), "original\n"); git(child, "add", "."); git(child, "commit", "-qm", "child fixture");
  writeFileSync(path.join(cwd, ".gitmodules"), "[submodule \"module\"]\n\tpath = module\n\turl = ./module\n");
  writeFileSync(path.join(cwd, "root.txt"), "root\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "parent fixture");
  const base = git(cwd, "rev-parse", "HEAD");
  const marker = path.join(child, ".git", "preview-filter-marker");
  git(child, "config", "filter.fixture.clean", `printf executed > '${marker}'; cat`);
  if (dirty) writeFileSync(path.join(child, "tracked.txt"), "modified\n");
  return { cwd, child, base, marker };
}

function fixedPolicyDigest() {
  const digest = createHash("sha256");
  const updateFrame = (value: Buffer) => {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(value.length));
    digest.update(length).update(value);
  };
  for (const [name, source] of [
    ["plan.ts", new URL("./plan.ts", import.meta.url)],
    ["selection.ts", new URL("./selection.ts", import.meta.url)],
    ["verify.ts", new URL("../verify.ts", import.meta.url)],
  ] as const) {
    updateFrame(Buffer.from(name, "utf8"));
    updateFrame(Buffer.from(readFileSync(fileURLToPath(source), "latin1"), "latin1"));
  }
  return digest.digest("hex");
}

afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

it("publishes a non-executable, acceptance-pending preview", () => {
  const { cwd, base: head } = fixture();
  const preview = createPreview({ cwd, base: head });
  expect(preview).toMatchObject({ executable: false, acceptancePending: true, environment: "unobserved", effectiveMode: "shadow", activation: "observation-pending", memo: "disabled", runId: null, attempt: null });
  expect(preview.head).toBe(head);
});

it("refuses obsolete execution options through the CLI parser", async () => {
  const { main } = await import("../verify");
  expect(() => main(["plan", "--base", "0".repeat(40), "--mode", "shadow"])).toThrow("INVALID_ARGUMENTS");
});

it("refuses dirty tracked, staged, and untracked inputs", () => {
  for (const kind of ["tracked", "staged", "untracked"]) {
    const { cwd, base } = fixture();
    writeFileSync(path.join(cwd, "README.md"), `${kind}\n`);
    if (kind === "staged") execFileSync("git", ["add", "README.md"], { cwd });
    if (kind === "untracked") writeFileSync(path.join(cwd, "untracked.txt"), "untracked\n");
    expect(() => createPreview({ cwd, base })).toThrow("DIRTY_WORKTREE");
  }
});

it("refuses a dirty gitlink before recursive status can run child filters", () => {
  const { cwd, base, marker } = submoduleFixture();
  let previewResult: string | null = null;
  try { createPreview({ cwd, base }); } catch (error) { previewResult = error instanceof Error ? error.message : "UNKNOWN"; }
  console.log(JSON.stringify({ previewResult, filterMarkerExists: existsSync(marker) }));
  expect(previewResult).toBe("GITLINK_UNSUPPORTED");
  expect(existsSync(marker)).toBe(false);
});

it("refuses an unchanged initialized gitlink before status", () => {
  const { cwd, base, marker } = submoduleFixture(false);
  expect(() => createPreview({ cwd, base })).toThrow("GITLINK_UNSUPPORTED");
  expect(existsSync(marker)).toBe(false);
});

it("refuses a staged gitlink from the complete index inventory", () => {
  const { cwd, child, base, marker } = submoduleFixture(false);
  writeFileSync(path.join(child, "new.txt"), "new\n");
  execFileSync("git", ["add", "new.txt"], { cwd: child });
  execFileSync("git", ["commit", "-qm", "child update"], { cwd: child });
  execFileSync("git", ["add", "module"], { cwd });
  rmSync(marker, { force: true });
  expect(() => createPreview({ cwd, base })).toThrow("GITLINK_UNSUPPORTED");
  expect(existsSync(marker)).toBe(false);
});

it("refuses a staged deletion when HEAD still contains a gitlink", () => {
  const { cwd, base, marker } = submoduleFixture(false);
  execFileSync("git", ["rm", "-q", "--cached", "module"], { cwd });
  expect(() => createPreview({ cwd, base })).toThrow("GITLINK_UNSUPPORTED");
  expect(existsSync(marker)).toBe(false);
});

it("refuses unmerged index stages before status", () => {
  const { cwd, base } = fixture();
  const trunk = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8" }).trim();
  execFileSync("git", ["checkout", "-qb", "conflict-side"], { cwd });
  writeFileSync(path.join(cwd, "README.md"), "side\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-qm", "side"], { cwd });
  execFileSync("git", ["checkout", "-q", trunk], { cwd });
  writeFileSync(path.join(cwd, "README.md"), "trunk\n");
  execFileSync("git", ["add", "README.md"], { cwd });
  execFileSync("git", ["commit", "-qm", "trunk"], { cwd });
  spawnSync("git", ["merge", "conflict-side"], { cwd, stdio: "ignore" });
  expect(() => createPreview({ cwd, base })).toThrow("UNMERGED_INDEX");
});

it("requires the canonical Git root before index or status inspection", () => {
  const { cwd, base } = fixture();
  const nested = path.join(cwd, "nested");
  mkdirSync(nested);
  expect(() => createPreview({ cwd: nested, base })).toThrow("NON_ROOT_CWD");
});

it("hashes the fixed implementation sources with independent framing", () => {
  const { cwd, base } = fixture();
  mkdirSync(path.join(cwd, "scripts/verification"), { recursive: true });
  writeFileSync(path.join(cwd, "scripts/verification/plan.ts"), "fake policy\n");
  writeFileSync(path.join(cwd, "scripts/verification/selection.ts"), "fake policy\n");
  writeFileSync(path.join(cwd, "scripts/verify.ts"), "fake policy\n");
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "lookalike policy files"], { cwd });
  const preview = createPreview({ cwd, base });
  expect(preview.policyDigest).toBe(fixedPolicyDigest());
});

it("uses only the fixed Git boundary under hostile PATH and startup variables", () => {
  const { cwd, base } = fixture();
  const fake = path.join(cwd, "fake-bin");
  mkdirSync(fake);
  const marker = path.join(cwd, "child-marker");
  writeFileSync(path.join(fake, "git"), ["#!/bin/sh", "touch " + marker, "exit 99", ""].join("\n"));
  chmodSync(path.join(fake, "git"), 0o755);
  writeFileSync(path.join(cwd, ".git/info/exclude"), "fake-bin/\nchild-marker\n");
  const previousPath = process.env.PATH;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  process.env.PATH = fake;
  process.env.NODE_OPTIONS = "--require=/definitely-not-loaded";
  try {
    expect(createPreview({ cwd, base }).executable).toBe(false);
  } finally {
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousNodeOptions;
  }
  expect(existsSync(marker)).toBe(false);
});

it("rejects configured filters, sparse state, assume-unchanged, and partial metadata", () => {
  const filter = fixture();
  execFileSync("git", ["config", "filter.evil.process", "touch marker"], { cwd: filter.cwd });
  expect(() => createPreview({ cwd: filter.cwd, base: filter.base })).toThrow("GIT_CONFIG_UNSAFE");

  const sparse = fixture();
  execFileSync("git", ["config", "core.sparseCheckout", "true"], { cwd: sparse.cwd });
  expect(() => createPreview({ cwd: sparse.cwd, base: sparse.base })).toThrow("SPARSE_INDEX_UNSUPPORTED");

  const assumed = fixture();
  execFileSync("git", ["update-index", "--assume-unchanged", "README.md"], { cwd: assumed.cwd });
  expect(() => createPreview({ cwd: assumed.cwd, base: assumed.base })).toThrow("INDEX_STATE_UNSUPPORTED");

  const partial = fixture();
  mkdirSync(path.join(partial.cwd, ".git/objects/info"), { recursive: true });
  writeFileSync(path.join(partial.cwd, ".git/objects/info/alternates"), "/tmp/objects\n");
  expect(() => createPreview({ cwd: partial.cwd, base: partial.base })).toThrow("UNCONFIRMED_REPOSITORY");
});

it("preserves newline paths and treats deletion as a full fallback", () => {
  const { cwd, base } = fixture();
  const named = "line\nbreak.ts";
  writeFileSync(path.join(cwd, named), "new\n");
  execFileSync("git", ["add", named], { cwd });
  execFileSync("git", ["commit", "-qm", "newline"], { cwd });
  expect(createPreview({ cwd, base }).changed.some(item => item.paths.includes(named))).toBe(true);

  const deleted = fixture();
  execFileSync("git", ["rm", "-q", "README.md"], { cwd: deleted.cwd });
  execFileSync("git", ["commit", "-qm", "delete"], { cwd: deleted.cwd });
  const preview = createPreview({ cwd: deleted.cwd, base: deleted.base });
  expect(preview.changed.some(item => item.status === "D" && item.paths.includes("README.md"))).toBe(true);
  expect(preview.impact.fullFallback).toBe(true);
});

it("binds an explicit logical head to exact merge parents", () => {
  const { cwd, base } = fixture();
  writeFileSync(path.join(cwd, "logical.txt"), "logical\n");
  execFileSync("git", ["add", "logical.txt"], { cwd });
  execFileSync("git", ["commit", "-qm", "logical"], { cwd });
  const logical = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  execFileSync("git", ["checkout", "-q", "--detach", base], { cwd });
  execFileSync("git", ["merge", "--no-ff", "--no-edit", logical], { cwd, stdio: "ignore" });
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const preview = createPreview({ cwd, base, head: logical });
  expect(preview).toMatchObject({ head: logical, executedSha: actual });
  expect(() => createPreview({ cwd, base, head: base })).toThrow("HEAD_BINDING_INVALID");
});

it("requires CI execution to be the exact ordered base/PR-head merge", () => {
  const merged = fixture();
  writeFileSync(path.join(merged.cwd, "logical.txt"), "logical\n");
  execFileSync("git", ["add", "logical.txt"], { cwd: merged.cwd });
  execFileSync("git", ["commit", "-qm", "logical"], { cwd: merged.cwd });
  const prHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: merged.cwd, encoding: "utf8" }).trim();
  execFileSync("git", ["checkout", "-q", "--detach", merged.base], { cwd: merged.cwd });
  execFileSync("git", ["merge", "--no-ff", "--no-edit", prHead], { cwd: merged.cwd, stdio: "ignore" });
  const executionSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: merged.cwd, encoding: "utf8" }).trim();
  const executionTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: merged.cwd, encoding: "utf8" }).trim();
  const valid = { cwd: merged.cwd, acceptedBase: merged.base, prHead, executionSha, executionTree };
  expect(() => assertCiMergeIdentity(valid)).not.toThrow();
  expect(() => assertCiMergeIdentity({ ...valid, acceptedBase: prHead, prHead: merged.base })).toThrow();
  expect(() => assertCiMergeIdentity({ ...valid, executionTree: "0".repeat(40) })).toThrow();

  const oneParent = fixture();
  const oneParentSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: oneParent.cwd, encoding: "utf8" }).trim();
  const oneParentTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: oneParent.cwd, encoding: "utf8" }).trim();
  expect(() => assertCiMergeIdentity({ cwd: oneParent.cwd, acceptedBase: oneParent.base, prHead: oneParentSha, executionSha: oneParentSha, executionTree: oneParentTree })).toThrow();
  expect(() => assertCiMergeIdentity({ ...valid, executionSha: "0".repeat(40) })).toThrow();

  const shallowSource = fixture();
  const shallow = mkdtempSync(`${tmpdir()}/git-preview-shallow-`);
  roots.push(shallow);
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${shallowSource.cwd}`, shallow], { stdio: "ignore" });
  const shallowSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: shallow, encoding: "utf8" }).trim();
  const shallowTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: shallow, encoding: "utf8" }).trim();
  expect(() => assertCiMergeIdentity({ cwd: shallow, acceptedBase: shallowSha, prHead: shallowSha, executionSha: shallowSha, executionTree: shallowTree })).toThrow();
});

it("refuses a symlinked committed registry instead of following it", () => {
  const { cwd, base } = fixture();
  mkdirSync(path.join(cwd, "scripts/verification"), { recursive: true });
  symlinkSync("../../README.md", path.join(cwd, "scripts/verification/registry.json"));
  execFileSync("git", ["add", "scripts/verification/registry.json"], { cwd });
  execFileSync("git", ["commit", "-qm", "symlink-registry"], { cwd });
  expect(() => createPreview({ cwd, base })).toThrow("AMBIGUOUS_TREE");
});

it("refuses a changed symlink source", () => {
  const { cwd, base } = fixture();
  symlinkSync("README.md", path.join(cwd, "source.ts"));
  execFileSync("git", ["add", "source.ts"], { cwd });
  execFileSync("git", ["commit", "-qm", "symlink-source"], { cwd });
  expect(() => createPreview({ cwd, base })).toThrow("AMBIGUOUS_TREE");
});

it("refuses unknown committed registry modules", () => {
  const { cwd, base } = fixture();
  mkdirSync(path.join(cwd, "scripts/verification"), { recursive: true });
  writeFileSync(path.join(cwd, "scripts/verification/registry.json"), JSON.stringify({
    schemaVersion: 1,
    modules: [{
      id: "unknown-module", status: "observation-pending", risk: "R2", paths: ["src/unknown.ts"],
      dependencies: [], consumers: [], tasks: {},
      browser: { spec: "e2e/unknown.spec.ts", pages: ["unknown"], roles: ["unknown"], flows: ["unknown"], environment: "owned-postgres-browser" },
    }],
  }));
  execFileSync("git", ["add", "scripts/verification/registry.json"], { cwd });
  execFileSync("git", ["commit", "-qm", "unknown-registry"], { cwd });
  expect(() => createPreview({ cwd, base })).toThrow("INVALID_REGISTRY");
});

it("accepts shared dependencies in the fixed four-module registry", () => {
  const { cwd, base } = fixture();
  const registry = JSON.parse(readFileSync(new URL("./registry.json", import.meta.url), "utf8")) as { modules: Array<{ paths: string[]; consumers: string[]; tasks: Record<string, string[]>; browser: { spec: string } }> };
  for (const file of registry.modules.flatMap(module => [...module.paths, ...module.consumers, ...Object.values(module.tasks).flat(), module.browser.spec])) {
    const materialized = file.endsWith("/") ? `${file}fixture.ts` : file;
    mkdirSync(path.dirname(path.join(cwd, materialized)), { recursive: true });
    writeFileSync(path.join(cwd, materialized), "fixture\n");
  }
  mkdirSync(path.join(cwd, "scripts/verification"), { recursive: true });
  writeFileSync(path.join(cwd, "scripts/verification/registry.json"), readFileSync(new URL("./registry.json", import.meta.url)));
  execFileSync("git", ["add", "."], { cwd });
  execFileSync("git", ["commit", "-qm", "shared-dependencies"], { cwd });
  const preview = createPreview({ cwd, base });
  expect(preview.selection.fullFallback).toBe(true);
  expect(preview.selection.modules).toEqual(["feedback-client", "feedback-domain", "feedback-server", "feedback-ui"]);
});

it("runs the bounded plan CLI in an owned fixture", () => {
  const { cwd, base } = fixture();
  const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/verify.ts"), "plan", "--base", base], { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({ executable: false, acceptancePending: true, environment: "unobserved" });
  expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThan(64 * 1024);
});
