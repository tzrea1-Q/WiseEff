import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { buildCachedToolInvocation } from "./run-cached-tool";

describe("writable tool caches", () => {
  it("preserves default developer commands", () => {
    expect(buildCachedToolInvocation("tsc", {}).args).toEqual(["-b"]);
    expect(buildCachedToolInvocation("eslint", {}).args).toEqual(["src", "--cache", "--cache-location", "node_modules/.cache/eslint/"]);
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
      expect(buildCachedToolInvocation("eslint", { WISEEFF_TOOL_CACHE_DIR: cache }).args).toEqual(["src", "--cache", "--cache-location", path.join(cache, "eslint") + path.sep]);
    } finally { rmSync(cache, { recursive: true, force: true }); }
  });

  it("routes lint, typecheck and the TypeScript build phase through the cache-aware runner", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(scripts.lint).toBe("tsx scripts/run-cached-tool.ts eslint");
    expect(scripts.typecheck).toContain("tsx scripts/run-cached-tool.ts tsc");
    expect(scripts.build).toContain("tsx scripts/run-cached-tool.ts tsc &&");
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
