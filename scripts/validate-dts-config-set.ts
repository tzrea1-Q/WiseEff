import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createDtsToolchainRunner,
  type DtsToolchainConfigSet,
  type DtsToolchainResult
} from "../server/modules/parameter-files/dtsToolchain";

export type ValidateDtsConfigSetArgs = {
  entryFile: string;
  overlayOrder: string[];
  files: Array<{ name: string; path: string }>;
  mode?: "release" | "warn" | "off";
};

export async function validateDtsConfigSetFromPaths(
  input: ValidateDtsConfigSetArgs
): Promise<DtsToolchainResult> {
  const files = new Map<string, { content: string }>();
  for (const file of input.files) {
    files.set(file.name, { content: await readFile(file.path, "utf8") });
  }

  const configSet: DtsToolchainConfigSet = {
    entryFile: input.entryFile,
    includeSearchPaths: [],
    overlayOrder: input.overlayOrder,
    files
  };

  const runner = createDtsToolchainRunner();
  return runner.validate(configSet, { mode: input.mode ?? "release" });
}

function parseArgs(argv: string[]) {
  const entryFile = argv.find((arg) => arg.startsWith("--entry="))?.slice("--entry=".length);
  const overlaysRaw = argv.find((arg) => arg.startsWith("--overlays="))?.slice("--overlays=".length) ?? "";
  const modeRaw = argv.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) ?? "release";
  const fileArgs = argv.filter((arg) => arg.startsWith("--file=")).map((arg) => arg.slice("--file=".length));

  if (!entryFile) {
    throw new Error(
      "Usage: tsx scripts/validate-dts-config-set.ts --entry=board.dts [--overlays=a.dtso,b.dtso] --file=board.dts=/path/board.dts [--mode=release|warn|off]"
    );
  }

  const files = fileArgs.map((spec) => {
    const eq = spec.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Invalid --file spec (expected name=path): ${spec}`);
    }
    return { name: spec.slice(0, eq), path: spec.slice(eq + 1) };
  });

  const mode: NonNullable<ValidateDtsConfigSetArgs["mode"]> =
    modeRaw === "warn" || modeRaw === "off" || modeRaw === "release" ? modeRaw : "release";
  const overlayOrder = overlaysRaw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return { entryFile, overlayOrder, files, mode } satisfies ValidateDtsConfigSetArgs;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length === 0) {
    // Convenience: when run with no --file, validate the committed power seed base+overlay.
    const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    const seedDir = path.join(rootDir, "src/config/dts-seed");
    const result = await validateDtsConfigSetFromPaths({
      entryFile: "aurora-board.dts",
      overlayOrder: [],
      files: [
        {
          name: "aurora-board.dts",
          path: path.join(seedDir, "aurora-board.dts")
        }
      ],
      mode: args.mode
    });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
    return;
  }

  const result = await validateDtsConfigSetFromPaths(args);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
