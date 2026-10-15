import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
  const result = spawnSync(process.execPath, [invocation.bin, ...invocation.args, ...extra], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (tool === "eslint" && result.status === 0) {
    const { inspectStaticCoverage, readStaticChanges } = await import("./check-static-coverage");
    const changes = readStaticChanges(process.cwd(), base);
    if (changes.paths.length) {
      const coverage = await inspectStaticCoverage(changes.paths, process.cwd(), { execute: true, deletedPaths: changes.deletedPaths, nativeLintPassed: extra.length === 0 && process.env.ESLINT_USE_FLAT_CONFIG !== "false" });
      console.log(JSON.stringify({ base: changes.base, staticCoverage: coverage }, null, 2));
      process.exit(coverage.status === "failed" ? 1 : 0);
    }
    console.log("No changed files: additional static coverage is not applicable; no changed-file acceptance claimed.");
  }
  process.exit(result.status ?? 1);
}
