import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ts from "typescript";
import { inspectStaticCoverage, readStaticChanges } from "./check-static-coverage";

let root: string;
function write(file: string, source: string) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "wiseeff-static-coverage-"));
  write("package.json", '{"type":"module"}');
  write("eslint.config.js", `import parser from ${JSON.stringify(createRequire(import.meta.url).resolve("@typescript-eslint/parser"))};
export default [{ files: ["{src,server,scripts,ops,e2e,packages}/**/*.{ts,tsx}"], languageOptions: { parser }, rules: { "no-unreachable": "error" } }];`);
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ["ES2023"], target: "ES2023", module: "ESNext", moduleResolution: "Bundler" };
  for (const [name, include, exclude] of [
    ["app", ["src/**/*.ts"], ["**/*.test.ts"]],
    ["node", ["server/**/*.ts", "scripts/**/*.ts"], ["**/*.test.ts"]],
    ["tests.node", ["server/**/*.ts", "scripts/**/*.ts", "ops/**/*.ts", "packages/**/*.ts"], []],
    ["tests.browser", ["src/**/*.ts", "e2e/**/*.ts"], []],
  ] as const) write(`tsconfig.${name}.json`, JSON.stringify({ compilerOptions: { ...options, ...(name.endsWith("browser") ? { lib: ["ES2023", "DOM"] } : {}) }, include, exclude }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("semantically checks a changed server test that the ordinary build excludes", async () => {
  write("server/example.test.ts", "export const count: number = 1;");
  const good = await inspectStaticCoverage(["server/example.test.ts"], root, { execute: true });
  expect(good.status, good.problems.join("\n")).toBe("passed");
  expect(good.files[0]).toMatchObject({
    path: "server/example.test.ts", lint: { status: "checked" },
    typecheck: { project: "tsconfig.tests.node.json", status: "checked" },
  });
  write("server/example.test.ts", 'export const count: number = "wrong";');
  const bad = await inspectStaticCoverage(["server/example.test.ts"], root, { execute: true });
  expect(bad.status).toBe("failed");
  expect(bad.problems.join("\n")).toContain("TS2322");
});

it("reports real repository test projects without pretending selection executed them", async () => {
  const repository = fileURLToPath(new URL("../", import.meta.url));
  const selected = await inspectStaticCoverage([
    "src/components/common/SelectControl.test.tsx", "server/testing/testDatabase.test.ts",
    "e2e/acceptance/runtime-warmup.spec.ts", "ops/self-hosted/scripts/check-self-hosted-config.ts",
  ], repository);
  expect(selected.status, selected.problems.join("\n")).toBe("selected");
  expect(selected.files.map((file) => file.typecheck.project)).toEqual([
    "tsconfig.tests.browser.json", "tsconfig.tests.node.json", "tsconfig.tests.node.json", "tsconfig.tests.browser.json",
  ]);
  expect(selected.files.every((file) => file.lint.status === "configured" && file.typecheck.status === "configured")).toBe(true);
  expect(selected.testExecution).toBe("not-run");
});

it("uses browser globals only in the browser test environment", async () => {
  write("e2e/example.spec.ts", 'export const label = document.title;');
  write("server/example.test.ts", 'export const label = document.title;');
  write("src/example.ts", 'export const label = document.title;');
  write("tsconfig.app.json", JSON.stringify({ compilerOptions: { target: "ES2023", lib: ["ES2023", "DOM"], types: [], strict: true, noEmit: true }, include: ["src/**/*.ts"] }));
  const node = await inspectStaticCoverage(["e2e/example.spec.ts", "server/example.test.ts", "src/example.ts"], root, { execute: true });
  expect(node.status).toBe("failed");
  expect(node.problems.join("\n")).toContain("document");
  expect(node.problems.every((problem) => problem.startsWith("server/example.test.ts:"))).toBe(true);
});

it("reads shared inputs once per check while retaining each project's module rules", async () => {
  write("src/shared.ts", "const collision = 1;");
  write("server/example.test.ts", '/// <reference path="../src/shared.ts" />\nconst collision = "node";');
  write("src/example.test.ts", '/// <reference path="./shared.ts" />\nconst collision = "browser";');
  for (const [name, moduleDetection] of [["tests.node", "force"], ["tests.browser", "legacy"]]) {
    const config = JSON.parse(readFileSync(join(root, `tsconfig.${name}.json`), "utf8"));
    write(`tsconfig.${name}.json`, JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, moduleDetection } }));
  }
  const read = vi.spyOn(ts.sys, "readFile");
  try {
    const result = await inspectStaticCoverage(["server/example.test.ts", "src/example.test.ts"], root, { execute: true });
    expect(result.status).toBe("failed");
    expect(result.problems.some((problem) => problem.startsWith("src/example.test.ts:") && problem.includes("TS2451"))).toBe(true);
    expect(result.problems.some((problem) => problem.startsWith("server/example.test.ts:"))).toBe(false);
    expect(read.mock.calls.filter(([file]) => file === realpathSync(join(root, "src/shared.ts")))).toHaveLength(1);
  } finally {
    read.mockRestore();
  }
});

it("reuses native production project coverage while still checking excluded tests", async () => {
  write("src/example.ts", "export const value: number = 1;");
  write("server/example.ts", "export const value: number = 1;");
  write("src/example.test.ts", 'export const value: number = "wrong";');
  write("server/example.test.ts", 'export const value: number = "wrong";');
  const result = await inspectStaticCoverage([
    "src/example.ts", "server/example.ts", "src/example.test.ts", "server/example.test.ts"
  ], root, { execute: true, nativeTypecheckProjects: ["tsconfig.app.json", "tsconfig.node.json", "tsconfig.tests.node.json"] });
  expect(result.status).toBe("failed");
  expect(result.problems.filter((problem) => problem.includes("TS2322"))).toHaveLength(2);
  expect(result.files.filter((file) => file.typecheck.reason?.includes("successful native TypeScript build")).map((file) => file.path))
    .toEqual(["server/example.ts", "src/example.ts"]);
  expect(result.files.every((file) => file.typecheck.status === "checked")).toBe(true);
});

it("rejects ignored, missing, unsupported and misconfigured changes instead of empty success", async () => {
  write("server/ignored.test.ts", "export const good = true;");
  write("eslint.config.js", 'export default [{ ignores: ["**/*"] }];');
  const ignored = await inspectStaticCoverage(["server/ignored.test.ts"], root, { execute: true });
  expect(ignored.status).toBe("failed");
  expect(ignored.problems.join("\n")).toContain("ESLint");
  const missing = await inspectStaticCoverage(["server/missing.ts"], root);
  expect(missing.status).toBe("failed");
  write("tools/unknown.ts", "export const good = true;");
  expect((await inspectStaticCoverage(["tools/unknown.ts"], root)).status).toBe("failed");
  write("tsconfig.tests.node.json", '{"compilerOptions":{"target":"not-a-target"},"include":["server/**/*.ts"]}');
  const invalid = await inspectStaticCoverage(["server/ignored.test.ts"], root);
  expect(invalid.problems.join("\n")).toContain("target");
  expect((await inspectStaticCoverage(["tsconfig.tests.node.json"], root)).status).toBe("failed");
  write("tsconfig.tests.node.json", '{"compilerOptions":{"types":["wiseeff-missing-types"]},"include":["server/**/*.ts"]}');
  const missingTypes = await inspectStaticCoverage(["tsconfig.tests.node.json"], root, { execute: true });
  expect(missingTypes.status).toBe("failed");
  expect(missingTypes.problems.join("\n")).toContain("wiseeff-missing-types");
  await expect(inspectStaticCoverage([], root)).rejects.toThrow(/empty/i);
  await expect(inspectStaticCoverage(["../outside.ts"], root)).rejects.toThrow(/invalid/i);
  write("README.md", "# Docs");
  expect((await inspectStaticCoverage(["README.md"], root, { execute: true })).status).toBe("not-applicable");
});

it("makes the ordinary lint entry point fail on an untracked semantically broken server test", async () => {
  write(".gitignore", "node_modules\nwork\n");
  write("src/original.ts", "export const original = 1;");
  write("scripts/original.test.ts", "export const original = 1;");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("add", ".");
  git("-c", "user.name=Static fixture", "-c", "user.email=static@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  const repository = fileURLToPath(new URL("../", import.meta.url));
  symlinkSync(join(repository, "node_modules"), join(root, "node_modules"));
  write("server/example.test.ts", 'export const count: number = "wrong";');
  const child = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), join(repository, "scripts/run-cached-tool.ts"), "eslint"], {
    cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", WISEEFF_STATIC_BASE: "HEAD", WISEEFF_TOOL_CACHE_DIR: join(root, "work/cache") },
  });
  expect(child.status, child.stderr).toBe(1);
  expect(child.stdout + child.stderr).toContain("TS2322");
  const changes = readStaticChanges(root);
  expect(changes.paths).toEqual(["server/example.test.ts"]);
  write("server/example.test.ts", "export const count: number = 1;");
  write("src/original.ts", "export const original = 2;");
  const valid = spawnSync(process.execPath, ["--import", createRequire(import.meta.url).resolve("tsx"), join(repository, "scripts/run-cached-tool.ts"), "eslint", "--base", "HEAD", "--no-cache"], {
    cwd: root, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", WISEEFF_STATIC_BASE: "not-a-commit", WISEEFF_TOOL_CACHE_DIR: join(root, "work/cache") },
  });
  expect(valid.status, valid.stderr).toBe(0);
  expect(valid.stdout).toContain('"status": "passed"');
  expect(valid.stdout).toContain("Checked by the successful original ESLint src/scripts-test pass in this invocation.");
  rmSync(join(root, "src/original.ts"));
  const removed = readStaticChanges(root);
  expect(removed.deletedPaths).toEqual(["src/original.ts"]);
  const coverage = await inspectStaticCoverage(removed.paths, root, { deletedPaths: removed.deletedPaths });
  expect(coverage.status, coverage.problems.join("\n")).toBe("selected");
  expect(coverage.files.find((file) => file.path === "src/original.ts")?.typecheck).toMatchObject({ status: "excluded", reason: expect.stringContaining("deletion") });
});
