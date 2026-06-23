import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);

const VERSION = "0.1.0";
const PLATFORM = "windows";
const ARCH = "amd64";
const ZIP_FILENAME = `wiseeff-bridge_${VERSION}_${PLATFORM}_${ARCH}.zip`;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const entryPoint = path.join(rootDir, "packages", "device-bridge", "src", "cli.ts");
const bundleDir = path.join(rootDir, "packages", "device-bridge", "dist");
const bundlePath = path.join(bundleDir, "cli.js");
const artifactDir = path.join(rootDir, "ops", "self-hosted", "bridge-artifacts", VERSION, PLATFORM, ARCH);
const artifactPath = path.join(artifactDir, ZIP_FILENAME);

await mkdir(bundleDir, { recursive: true });
await mkdir(artifactDir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  banner: {
    js: "#!/usr/bin/env node"
  }
});

await rm(artifactPath, { force: true });
await execFileAsync("zip", ["-j", artifactPath, bundlePath]);

console.log(`Built device bridge bundle: ${bundlePath}`);
console.log(`Created artifact: ${artifactPath}`);
