import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createPreview } from "./plan";

const roots: string[] = [];
function fixture() {
  const cwd = mkdtempSync(`${tmpdir()}/git-preview-`);
  roots.push(cwd);
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q"); git("config", "user.name", "preview"); git("config", "user.email", "preview@example.invalid");
  writeFileSync(`${cwd}/README.md`, "preview\n"); git("add", "."); git("commit", "-qm", "fixture");
  return { cwd, base: git("rev-parse", "HEAD") };
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

it("runs the bounded plan CLI in an owned fixture", () => {
  const { cwd, base } = fixture();
  const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/verify.ts"), "plan", "--base", base], { cwd, encoding: "utf8" });
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output).toMatchObject({ executable: false, acceptancePending: true, environment: "unobserved" });
  expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThan(64 * 1024);
});
