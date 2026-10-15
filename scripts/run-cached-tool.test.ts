import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { ESLint } from "eslint";
import { buildCachedToolInvocation, readNativeTypecheckProjects } from "./run-cached-tool";

describe("writable tool caches", () => {
  it("reuses only a successful unmodified CI native typecheck for this clean checkout", () => {
    const root = mkdtempSync(path.join(tmpdir(), "wiseeff-native-coverage-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    try {
      mkdirSync(path.join(root, "work"));
      writeFileSync(path.join(root, ".gitignore"), "node_modules\nwork\n*.tsbuildinfo\n");
      writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
      writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }] }));
      for (const name of ["app", "node"]) {
        writeFileSync(path.join(root, `${name}.ts`), "export const value: number = 1;");
        writeFileSync(path.join(root, `tsconfig.${name}.json`), JSON.stringify({ compilerOptions: { composite: true, noEmit: true, types: [], lib: ["ES2023"], target: "ES2023", skipLibCheck: true }, files: [`${name}.ts`] }));
      }
      symlinkSync(path.resolve("node_modules"), path.join(root, "node_modules"));
      git("init", "--initial-branch=main"); git("add", ".");
      git("-c", "user.name=Static fixture", "-c", "user.email=static@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
      const output = path.join(root, "work/output");
      const env = { ...process.env, CI: "true", GITHUB_ACTIONS: "true", GITHUB_OUTPUT: output, WISEEFF_TOOL_CACHE_DIR: "", NODE_OPTIONS: "" };
      const runner = path.resolve("scripts/run-cached-tool.ts");
      const run = (...args: string[]) => spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), runner, "tsc", ...args], { cwd: root, env, encoding: "utf8" });
      const passed = run();
      expect(passed.status, passed.stdout + passed.stderr).toBe(0);
      const sha = git("rev-parse", "HEAD");
      expect(readFileSync(output, "utf8")).toContain(`native_typecheck_sha=${sha}`);
      const fact = { ...env, WISEEFF_NATIVE_BUILD_OUTCOME: "success", WISEEFF_NATIVE_TYPECHECK_SHA: sha };
      expect(readNativeTypecheckProjects(root, fact)).toEqual(["tsconfig.app.json", "tsconfig.node.json"]);
      for (const invalid of [{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { WISEEFF_NATIVE_BUILD_OUTCOME: "failure" }, { WISEEFF_NATIVE_TYPECHECK_SHA: "0".repeat(40) }]) {
        expect(readNativeTypecheckProjects(root, { ...fact, ...invalid })).toEqual([]);
      }
      rmSync(output);
      expect(run("--help").status).toBe(0);
      expect(() => readFileSync(output)).toThrow();
      const changedConfig = JSON.parse(readFileSync(path.join(root, "tsconfig.app.json"), "utf8"));
      changedConfig.compilerOptions.noUnusedLocals = true;
      writeFileSync(path.join(root, "tsconfig.app.json"), JSON.stringify(changedConfig));
      expect(readNativeTypecheckProjects(root, fact)).toEqual([]);
      writeFileSync(path.join(root, "app.ts"), 'export const value: number = "wrong";');
      git("add", ".");
      git("-c", "user.name=Static fixture", "-c", "user.email=static@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "invalid fixture");
      expect(run().status).not.toBe(0);
      expect(() => readFileSync(output)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("preserves default developer commands", () => {
    expect(buildCachedToolInvocation("tsc", {}).args).toEqual(["-b"]);
    expect(buildCachedToolInvocation("eslint", {}).args).toEqual(["src", "scripts/**/*.{test,spec}.{ts,tsx}", "--cache", "--cache-location", "node_modules/.cache/eslint/"]);
  });

  it("redirects both build-info files and ESLint without changing TypeScript inputs", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "wiseeff-tool-cache-"));
    try {
      const invocation = buildCachedToolInvocation("tsc", { WISEEFF_TOOL_CACHE_DIR: cache });
      expect(invocation.args).toHaveLength(3);
      for (const [index, name] of ["app", "node"].entries()) {
        const generated = invocation.args[index + 1];
        const parsed = ts.getParsedCommandLineOfConfigFile(generated, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
        const original = ts.getParsedCommandLineOfConfigFile(path.resolve(`tsconfig.${name}.json`), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
        expect(parsed.errors).toEqual([]);
        expect(parsed.fileNames).toEqual(original.fileNames);
        expect(parsed.options).toEqual({ ...original.options, configFilePath: generated, tsBuildInfoFile: path.join(cache, `tsconfig.${name}.tsbuildinfo`) });
      }
      expect(buildCachedToolInvocation("eslint", { WISEEFF_TOOL_CACHE_DIR: cache }).args).toEqual(["src", "scripts/**/*.{test,spec}.{ts,tsx}", "--cache", "--cache-location", path.join(cache, "eslint") + path.sep]);
    } finally { rmSync(cache, { recursive: true, force: true }); }
  });

  it("routes lint, typecheck and the TypeScript build phase through the cache-aware runner", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(scripts.lint).toBe("tsx scripts/run-cached-tool.ts eslint");
    expect(scripts.typecheck).toContain("tsx scripts/run-cached-tool.ts tsc");
    expect(scripts.build).toContain("tsx scripts/run-cached-tool.ts tsc &&");
    const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
    const steps = workflow.jobs["l1-static"].steps;
    expect(steps.find((step: { id?: string }) => step.id === "build").run).toBe("npm run build");
    expect(steps.find((step: { id?: string }) => step.id === "lint").env).toMatchObject({
      WISEEFF_NATIVE_BUILD_OUTCOME: "${{ steps.build.outcome }}",
      WISEEFF_NATIVE_TYPECHECK_SHA: "${{ steps.build.outputs.native_typecheck_sha }}"
    });
  });

  it("enforces the configured CSS assertion rule in scripts tests included by lint", async () => {
    const [result] = await new ESLint().lintText('import { readFileSync } from "node:fs";\nconst css = readFileSync("src/app.css", "utf8");\nexpect(css).toContain("display: flex");\n', { filePath: "scripts/lint-regression.test.ts" });
    expect(result.messages.map(({ ruleId }) => ruleId)).toContain("wiseeff/no-raw-css-text-assertions");
    expect(result.errorCount).toBe(1);
  });

  it("checks Node and browser test code instead of accepting ignored-file warnings", async () => {
    const eslint = new ESLint();
    for (const filePath of ["server/coverage.test.ts", "e2e/coverage.spec.ts", "ops/coverage.ts"]) {
      const [result] = await eslint.lintText("export function value() { return 1; return 2; }", { filePath });
      expect(result.messages.map(({ ruleId }) => ruleId), filePath).toContain("no-unreachable");
      expect(result.errorCount).toBe(1);
    }
  });
});

it("provides an isolated local Postgres profile matching every CI Postgres image", () => {
  const compose = YAML.parse(readFileSync("compose.yaml", "utf8"));
  const local = compose.services["postgres-ci"];
  expect(local.profiles).toEqual(["ci"]);
  expect(local.ports).toEqual(["127.0.0.1:${WISEEFF_CI_POSTGRES_PORT:-55436}:5432"]);
  expect(local.volumes).toEqual(["wiseeff-postgres-ci-data:/var/lib/postgresql/data"]);
  const workflow = YAML.parse(readFileSync(".github/workflows/ci.yml", "utf8"));
  const images = Object.values(workflow.jobs).flatMap((job: unknown) => {
    const postgres = (job as { services?: { postgres?: { image: string } } }).services?.postgres;
    return postgres ? [postgres.image] : [];
  });
  expect(images.length).toBeGreaterThan(0);
  expect(new Set(images)).toEqual(new Set([local.image]));
  expect(local.image).toBe("pgvector/pgvector:pg16");
});
