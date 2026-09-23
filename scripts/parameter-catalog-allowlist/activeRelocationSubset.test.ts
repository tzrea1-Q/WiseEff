import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  runReviewedRelocationRecord,
  runtimeTopologyRelocationRecordPath,
  verifyHistoricalRelocationProof,
  type RuntimeTopologyRelocationRecord,
  type RelocationConfig,
} from "./runtimeTopologyRelocation";

const repoRoot = process.cwd();
const recordBytes = await readFile(join(repoRoot, runtimeTopologyRelocationRecordPath));
const record = JSON.parse(recordBytes.toString("utf8")) as RuntimeTopologyRelocationRecord;
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const temporaryRoots: string[] = [];
afterAll(async () => Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))));

function config(activeFiles: readonly string[]): RelocationConfig {
  return {
    recordPath: runtimeTopologyRelocationRecordPath,
    recordSha256: "7c99527e2473aac06b64fc3e3db892d1b866843a8092bf39c058bdc5e81afaa2",
    files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
    totalPairs: 16,
    activeFiles,
  };
}

function historyConfig(activeFiles: readonly string[] = [record.files[0]!.file]): RelocationConfig {
  return {
    recordPath: runtimeTopologyRelocationRecordPath,
    recordSha256: "7c99527e2473aac06b64fc3e3db892d1b866843a8092bf39c058bdc5e81afaa2",
    files: [
      { file: "server/modules/parameter-topology/ingestService.ts", pairs: 15 },
      { file: "server/modules/parameter-topology/schemas.ts", pairs: 1 },
    ],
    totalPairs: 16,
    activeFiles,
  };
}

const historyProvenance = {
  commit: "e31226b6cc06c2278230b810bb1becd8dbc1f32a",
  tree: "d55df1260ea99a60fa38a3101a5e9f5af7c29fc8",
};

async function proofRoot(tamperInactiveFile = false) {
  const root = await mkdtemp(join(tmpdir(), "active-relocation-subset-"));
  temporaryRoots.push(root);
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
  await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  const recordPath = join(root, runtimeTopologyRelocationRecordPath);
  await mkdir(dirname(recordPath), { recursive: true });
  await writeFile(recordPath, recordBytes);
  for (const section of record.files) {
    const filePath = join(root, section.file);
    await mkdir(dirname(filePath), { recursive: true });
    let bytes = execFileSync("git", ["show", `e31226b6cc06c2278230b810bb1becd8dbc1f32a:${section.file}`], { cwd: repoRoot });
    if (tamperInactiveFile && section.file.endsWith("schemas.ts")) bytes = Buffer.concat([bytes, Buffer.from("\n// inactive drift\n")]);
    await writeFile(filePath, bytes);
  }
  return root;
}

describe("fixed relocation record active-file subsets", () => {
  it("keeps the full fixed record inventory while validating aliases only for selected current files", async () => {
    const root = await proofRoot(true);
    const result = await runReviewedRelocationRecord(
      root,
      fixture,
      allowances,
      record.files[0]!.pairs.map((pair) => pair.new),
      [],
      config([record.files[0]!.file]),
    );

    expect(result.relocations).toHaveLength(15);
    expect(result.relocations.map((entry) => entry.observed.file)).toEqual(
      Array(15).fill(record.files[0]!.file),
    );
  });

  it.each([
    ["unknown", ["server/modules/parameter-topology/not-in-record.ts"]],
    ["duplicate", [record.files[0]!.file, record.files[0]!.file]],
    ["empty", []],
  ] as const)("rejects an %s active-file inventory", async (_kind, activeFiles) => {
    await expect(runReviewedRelocationRecord(
      repoRoot,
      fixture,
      allowances,
      [],
      [],
      config(activeFiles),
    )).rejects.toThrow("active file inventory");
  });

  it("rejects a missing active observation", async () => {
    const root = await proofRoot();
    await expect(runReviewedRelocationRecord(
      root,
      fixture,
      allowances,
      record.files[0]!.pairs.slice(1).map((pair) => pair.new),
      [],
      config([record.files[0]!.file]),
    )).rejects.toThrow("exact destination occurrence");
  });

  it("proves every fixed historical file and pair even when the config selects a current subset", async () => {
    const proof = await verifyHistoricalRelocationProof(
      repoRoot, fixture, allowances, historyConfig(), historyProvenance,
    );
    expect(proof.pairs).toHaveLength(16);
    expect(proof).not.toHaveProperty("relocations");
    await expect(verifyHistoricalRelocationProof(
      repoRoot,
      fixture,
      allowances,
      historyConfig(),
      { ...historyProvenance, tree: "0".repeat(40) },
    )).rejects.toThrow("historical tree identity");
  });

  it("rejects a re-signed record with a destination blob outside the pinned historical tree", async () => {
    const root = await proofRoot();
    const altered = structuredClone(record);
    altered.files[1]!.destinationBlobOid = "0".repeat(40);
    const bytes = `${JSON.stringify(altered, null, 2)}\n`;
    await writeFile(join(root, runtimeTopologyRelocationRecordPath), bytes);
    await expect(verifyHistoricalRelocationProof(
      root,
      fixture,
      allowances,
      { ...historyConfig(), recordSha256: createHash("sha256").update(bytes).digest("hex") },
      historyProvenance,
    )).rejects.toThrow("destination whole-file blob");
  });
});
