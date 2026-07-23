import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createSubprocessDtcValidator,
  type DtcValidationResult,
  type DtcValidator
} from "../server/modules/parameter-files/dtcValidator";
import {
  createDtsToolchainRunner,
  type DtsToolchainResult,
  type DtsToolchainRunner
} from "../server/modules/parameter-files/dtsToolchain";
import { primaryBoardFileName } from "./merge-primary-dts";
import type { DtsPowerSeedProjectFile, DtsPowerSeedProjectId } from "./dts-power-seed";

export async function compileDtsSeedFiles(
  files: readonly DtsPowerSeedProjectFile[],
  validator: DtcValidator = createSubprocessDtcValidator()
): Promise<DtcValidationResult> {
  const result = await validator.validate(
    files.map((file) => ({ name: file.artifactFileName, content: file.source })),
    { mode: "block" }
  );
  if (!result.ok || result.compiler === "unavailable") {
    const details = result.diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n");
    throw new Error(`Full DTS seed compilation failed.\n${details}`);
  }
  return result;
}

export async function loadCommittedDtsSeedFiles(rootDir: string): Promise<DtsPowerSeedProjectFile[]> {
  return Promise.all(
    (["aurora", "nebula", "atlas"] as DtsPowerSeedProjectId[]).map(async (projectId) => {
      const fileName = primaryBoardFileName(projectId);
      return {
        projectId,
        fileName,
        artifactFileName: fileName,
        source: await readFile(path.join(rootDir, "src", "config", "dts-seed", fileName), "utf8")
      };
    })
  );
}

export async function compileDtsSeedEffectiveTrees(
  rootDir: string,
  runner: DtsToolchainRunner = createDtsToolchainRunner()
): Promise<Array<{ projectId: DtsPowerSeedProjectId; result: DtsToolchainResult }>> {
  const primaries = await loadCommittedDtsSeedFiles(rootDir);
  const results: Array<{ projectId: DtsPowerSeedProjectId; result: DtsToolchainResult }> = [];

  for (const primary of primaries) {
    const result = await runner.validate(
      {
        entryFile: primary.artifactFileName,
        includeSearchPaths: [],
        overlayOrder: [],
        files: new Map([[primary.artifactFileName, { content: primary.source }]])
      },
      {
        // Seed boards are self-contained and may emit expected ranges_format warnings
        // without an external SoC base. Vendor bindings currently describe properties,
        // not every child node in the golden tree — keep schema advisory here.
        mode: "warn",
        failOnSchema: false
      }
    );

    if (!result.ok || !result.artifacts.effectiveDtbSha256) {
      const details = result.diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n");
      throw new Error(`Seed effective DTB failed for ${primary.projectId}.\n${details}`);
    }

    results.push({ projectId: primary.projectId, result });
  }

  return results;
}

async function main() {
  const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const primaries = await loadCommittedDtsSeedFiles(rootDir);
  const result = await compileDtsSeedFiles(primaries);
  const effective = await compileDtsSeedEffectiveTrees(rootDir);

  console.log(
    JSON.stringify(
      {
        ok: result.ok && effective.every((item) => item.result.ok),
        compiler: result.compiler,
        mode: result.mode,
        effectiveTrees: effective.map((item) => ({
          projectId: item.projectId,
          ok: item.result.ok,
          compiler: item.result.compiler,
          effectiveDtbSha256: item.result.artifacts.effectiveDtbSha256
        })),
        diagnostics: [...result.diagnostics, ...effective.flatMap((item) => item.result.diagnostics)]
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
