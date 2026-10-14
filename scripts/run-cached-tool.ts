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
  const invocation = buildCachedToolInvocation(tool);
  const result = spawnSync(process.execPath, [invocation.bin, ...invocation.args, ...process.argv.slice(3)], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
