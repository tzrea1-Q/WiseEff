import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const nativeProjects = ["tsconfig.app.json", "tsconfig.node.json"];
function nativeCheckout(root: string) {
  try {
    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    if (git("status", "--porcelain", "--untracked-files=all")) return;
    const config = JSON.parse(readFileSync(path.join(root, "tsconfig.json"), "utf8"));
    const projects = config.references?.map((reference: { path: string }) => reference.path.replace(/^\.\//, "")).sort();
    if (JSON.stringify(projects) !== JSON.stringify(nativeProjects)) return;
    return git("rev-parse", "HEAD");
  } catch { return; } // Missing/changed checkout facts require normal selected-file checks.
}

export function readNativeTypecheckProjects(root: string, env: NodeJS.ProcessEnv) {
  if (env.CI !== "true" || env.GITHUB_ACTIONS !== "true" || env.WISEEFF_NATIVE_BUILD_OUTCOME !== "success"
    || !/^[0-9a-f]{40}$/.test(env.WISEEFF_NATIVE_TYPECHECK_SHA ?? "")) return [];
  return nativeCheckout(root) === env.WISEEFF_NATIVE_TYPECHECK_SHA ? [...nativeProjects] : [];
}

export function buildCachedToolInvocation(tool: "tsc" | "eslint", env: NodeJS.ProcessEnv = process.env) {
  const cache = env.WISEEFF_TOOL_CACHE_DIR?.trim();
  if (tool === "eslint") {
    return {
      bin: path.resolve("node_modules/eslint/bin/eslint.js"),
      args: ["src", "scripts/**/*.{test,spec}.{ts,tsx}", "--cache", "--cache-location", cache ? path.resolve(cache, "eslint") + path.sep : "node_modules/.cache/eslint/"]
    };
  }
  const args = ["-b"];
  if (cache) {
    const configDirectory = path.resolve(cache, "configs");
    mkdirSync(configDirectory, { recursive: true });
    for (const name of ["app", "node"]) {
      const config = path.join(configDirectory, `tsconfig.${name}.json`);
      writeFileSync(config, JSON.stringify({
        extends: path.resolve(`tsconfig.${name}.json`),
        compilerOptions: { tsBuildInfoFile: path.resolve(cache, `tsconfig.${name}.tsbuildinfo`) }
      }) + "\n");
      args.push(config);
    }
  }
  return { bin: path.resolve("node_modules/typescript/bin/tsc"), args };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tool = process.argv[2];
  if (tool !== "tsc" && tool !== "eslint") throw new Error("Expected tsc or eslint.");
  const extra = process.argv.slice(3);
  let base = process.env.WISEEFF_STATIC_BASE || "HEAD";
  const baseIndex = extra.indexOf("--base");
  if (tool === "eslint" && baseIndex >= 0) {
    if (!extra[baseIndex + 1] || extra[baseIndex + 1].startsWith("--") || extra.lastIndexOf("--base") !== baseIndex) throw new Error("Expected one --base <commit>.");
    base = extra[baseIndex + 1];
    extra.splice(baseIndex, 2);
  }
  const invocation = buildCachedToolInvocation(tool);
  const checkedSha = tool === "tsc" && extra.length === 0 && process.env.CI === "true"
    && process.env.GITHUB_ACTIONS === "true" && process.env.GITHUB_OUTPUT ? nativeCheckout(process.cwd()) : undefined;
  const result = spawnSync(process.execPath, [invocation.bin, ...invocation.args, ...extra], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status === 0 && checkedSha && nativeCheckout(process.cwd()) === checkedSha && process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `native_typecheck_sha=${checkedSha}\n`);
  }
  if (tool === "eslint" && result.status === 0) {
    const { inspectStaticCoverage, readStaticChanges } = await import("./check-static-coverage");
    const changes = readStaticChanges(process.cwd(), base);
    if (changes.paths.length) {
      const coverage = await inspectStaticCoverage(changes.paths, process.cwd(), { execute: true, deletedPaths: changes.deletedPaths,
        nativeLintPassed: extra.every((arg) => arg === "--no-cache") && process.env.ESLINT_USE_FLAT_CONFIG !== "false",
        nativeTypecheckProjects: readNativeTypecheckProjects(process.cwd(), process.env) });
      console.log(JSON.stringify({ base: changes.base, staticCoverage: coverage }, null, 2));
      process.exit(coverage.status === "failed" ? 1 : 0);
    }
    console.log("No changed files: additional static coverage is not applicable; no changed-file acceptance claimed.");
  }
  process.exit(result.status ?? 1);
}
