import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createSubprocessDtcValidator,
  type DtcValidationResult,
  type DtcValidator
} from "../server/modules/parameter-files/dtcValidator";
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
    (["aurora", "nebula", "atlas"] as DtsPowerSeedProjectId[]).map(async (projectId) => ({
      projectId,
      fileName: "wiseeff-power-overlay.dts",
      artifactFileName: `${projectId}-power-overlay.dts`,
      source: await readFile(
        path.join(rootDir, "src", "config", "dts-seed", `${projectId}-power-overlay.dts`),
        "utf8"
      )
    }))
  );
}

async function main() {
  const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const result = await compileDtsSeedFiles(await loadCommittedDtsSeedFiles(rootDir));
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        compiler: result.compiler,
        mode: result.mode,
        diagnostics: result.diagnostics
      },
      null,
      2
    )
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
