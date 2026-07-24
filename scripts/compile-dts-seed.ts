import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { synthesizeDanglingAnchorStub } from "../server/modules/dts/danglingAnchorStub";
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
import { mergePrimaryDtsBoard, primaryBoardFileName } from "./merge-primary-dts";
import type { DtsPowerSeedProjectFile, DtsPowerSeedProjectId } from "./dts-power-seed";

/**
 * Labels referenced via `&name` that are not defined in the same source.
 * Used only to build an ephemeral L2 compile companion — never persisted.
 */
export function missingReferencedLabels(source: string): string[] {
  const defined = new Set<string>();
  for (const match of source.matchAll(/(?:^|[\s;{])([A-Za-z_][A-Za-z0-9_]*):/gm)) {
    defined.add(match[1]!);
  }
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const match of source.matchAll(/&([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const label = match[1]!;
    if (defined.has(label) || seen.has(label)) continue;
    seen.add(label);
    missing.push(label);
  }
  return missing;
}

/**
 * Prepend an ephemeral empty-node stub for dangling `&label` / phandle targets so
 * advisory `dtc` can compile overlay-only project-primary boards. The stub is a
 * throwaway compile companion (see danglingAnchorStub module doc).
 */
export function withEphemeralDanglingAnchorStub(source: string): string {
  const stub = synthesizeDanglingAnchorStub(missingReferencedLabels(source));
  if (!stub) return source;
  return mergePrimaryDtsBoard(stub, source);
}

export async function compileDtsSeedFiles(
  files: readonly DtsPowerSeedProjectFile[],
  validator: DtcValidator = createSubprocessDtcValidator()
): Promise<DtcValidationResult> {
  const result = await validator.validate(
    files.map((file) => ({
      name: file.artifactFileName,
      content: withEphemeralDanglingAnchorStub(file.source)
    })),
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
    const compileSource = withEphemeralDanglingAnchorStub(primary.source);
    const result = await runner.validate(
      {
        entryFile: primary.artifactFileName,
        includeSearchPaths: [],
        overlayOrder: [],
        files: new Map([[primary.artifactFileName, { content: compileSource }]])
      },
      {
        // Seed boards may be overlay-only (dangling `&label`); L2 advisory uses an
        // ephemeral stub companion. Vendor bindings currently describe properties,
        // not every child node — keep schema advisory here.
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
