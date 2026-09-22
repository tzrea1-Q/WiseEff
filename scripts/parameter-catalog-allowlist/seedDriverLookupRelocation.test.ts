import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { applyReviewedSeedDriverLookupRelocation, seedDriverPositionRecordPath, seedDriverQueryRecordPath } from "./seedDriverLookupRelocation";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const ownerFile = "server/modules/parameter-specs/repository.ts";
const paths = [seedDriverPositionRecordPath, seedDriverQueryRecordPath];
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];
beforeAll(async () => { discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha); }, 60_000);
afterAll(async () => { await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))); });

async function copyProof() {
  const root = await mkdtemp(join(tmpdir(), "seed-driver-identity-"));
  temporaryRoots.push(root);
  for (const file of [...paths, ownerFile]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(join(repoRoot, file)));
  }
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
  await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  return root;
}

describe("seed driver owner exact identity decision", () => {
  it("binds 50 unchanged slices and 11 rewritten observations without adding allowances", async () => {
    const result = await applyReviewedSeedDriverLookupRelocation(repoRoot, fixture, allowances, discovered);
    expect(result.relocations).toHaveLength(61);
    expect(new Set(result.relocations.flatMap((pair) => [pair.id, pair.observed.id])).size).toBe(122);
    for (const pair of result.relocations) {
      expect(allowances.some((entry) => entry.id === pair.id)).toBe(true);
      expect(result.violations.find((entry) => entry.id === pair.id)).toEqual(fixture.violations.find((entry) => entry.id === pair.id));
    }
  });

  it.each(paths)("rejects altered proof bytes: %s", async (file) => {
    const root = await copyProof();
    await writeFile(join(root, file), `${await readFile(join(root, file), "utf8")} `);
    await expect(applyReviewedSeedDriverLookupRelocation(root, fixture, allowances, discovered)).rejects.toThrow("reviewed record integrity");
  });

  it("rejects whole-file changes outside the approved query", async () => {
    const root = await copyProof();
    await writeFile(join(root, ownerFile), `${await readFile(join(root, ownerFile), "utf8")}\n`);
    await expect(applyReviewedSeedDriverLookupRelocation(root, fixture, allowances, discovered)).rejects.toThrow("destination whole-file blob");
  });

  it("rejects missing observations and cross-record identity reuse", async () => {
    const result = await applyReviewedSeedDriverLookupRelocation(repoRoot, fixture, allowances, discovered);
    const pair = result.relocations[0]!;
    await expect(applyReviewedSeedDriverLookupRelocation(repoRoot, fixture, allowances,
      discovered.filter((entry) => entry.id !== pair.observed.id))).rejects.toThrow();
    await expect(applyReviewedSeedDriverLookupRelocation(repoRoot, fixture, allowances, discovered, [pair])).rejects.toThrow();
  });
});
