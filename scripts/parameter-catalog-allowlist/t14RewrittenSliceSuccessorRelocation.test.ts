import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RuntimeTopologyRelocationRecord,
} from "./runtimeTopologyRelocation";
import {
  t14RewrittenSliceSuccessorRelocationConfig,
  t14RewrittenSliceSuccessorRelocationRecordPath,
} from "./t14RewrittenSliceSuccessorRelocation";
import type { BoundaryViolation } from "./schema";

const repoRoot = process.cwd();
const record: RuntimeTopologyRelocationRecord = JSON.parse(
  await readFile(join(repoRoot, t14RewrittenSliceSuccessorRelocationRecordPath), "utf8"),
);
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const temporaryRoots: string[] = [];
const changedFiles = new Set([
  "server/modules/parameter-modules/repository.ts",
  "server/modules/parameter-modules/service.test.ts",
  "server/modules/debugging/repository.ts",
  "server/modules/dts-reload/behaviouralVerify.ts",
  "server/modules/dts-reload/repository.ts",
  "server/modules/parameter-topology/writeLock.ts",
]);
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
}, 60_000);

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function copyProofFixture() {
  const root = await mkdtemp(join(tmpdir(), "t14-rewritten-slice-"));
  temporaryRoots.push(root);
  for (const file of [
    t14RewrittenSliceSuccessorRelocationRecordPath,
    ...record.files.map((section) => section.file),
  ]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(join(repoRoot, file)));
  }
  const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  return root;
}

function rewrittenSliceConfig(path: string, sha256: string): RelocationConfig {
  return {
    ...t14RewrittenSliceSuccessorRelocationConfig,
    recordPath: path,
    recordSha256: sha256,
    activeFiles: record.files
      .map((section) => section.file)
      .filter((file) => !changedFiles.has(file)),
  };
}

describe("T1.4 rewritten-slice current successor", () => {
  it("keeps 23 unchanged-file destinations active while reserving changed files", async () => {
    const result = await runReviewedRelocationRecord(
      repoRoot,
      fixture,
      allowances,
      discovered,
      [],
      rewrittenSliceConfig(
        t14RewrittenSliceSuccessorRelocationRecordPath,
        "56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7",
      ),
    );
    expect(result.relocations).toHaveLength(23);
    expect(new Set(result.relocations.map((entry) => entry.id)).size).toBe(23);
    expect(new Set(result.relocations.map((entry) => entry.observed.id)).size).toBe(23);
    const pairs = record.files.flatMap((section) => section.pairs);
    expect(pairs.every((pair) => pair.sourceSliceSha256 && pair.sliceSha256)).toBe(true);
    expect(
      pairs.some(
        (pair) => pair.old.evidence !== pair.new.evidence || pair.sourceSliceSha256 !== pair.sliceSha256,
      ),
    ).toBe(true);
    expect(record.files.map((section) => section.pairs.length)).toEqual([2, 1, 3, 14, 9, 5, 4, 3, 7, 5, 4]);
  });

  it("rejects a different-position dest swap under the B2 key even with a re-signed record", async () => {
    const root = await copyProofFixture();
    const altered = structuredClone(record);
    const section = altered.files.find((entry) => entry.file.endsWith("parameterReferences.ts"));
    expect(section).toBeDefined();
    const pairs = section!.pairs;
    const left = pairs.findIndex((pair, index) =>
      pairs.some(
        (other, otherIndex) =>
          otherIndex > index
          && other.old.id.split(":").slice(0, 3).join(":") === pair.old.id.split(":").slice(0, 3).join(":")
          && other.old.token === pair.old.token
          && other.new.byteStart !== pair.new.byteStart,
      ),
    );
    expect(left).toBeGreaterThanOrEqual(0);
    const right = pairs.findIndex(
      (pair, index) =>
        index > left
        && pair.old.id.split(":").slice(0, 3).join(":") === pairs[left]!.old.id.split(":").slice(0, 3).join(":")
        && pair.old.token === pairs[left]!.old.token
        && pair.new.byteStart !== pairs[left]!.new.byteStart,
    );
    expect(right).toBeGreaterThan(left);
    expect(pairs[left]!.new.byteStart).not.toBe(pairs[right]!.new.byteStart);
    [pairs[left]!.new, pairs[right]!.new] = [pairs[right]!.new, pairs[left]!.new];
    [pairs[left]!.sliceSha256, pairs[right]!.sliceSha256] = [
      pairs[right]!.sliceSha256,
      pairs[left]!.sliceSha256,
    ];
    const bytes = `${JSON.stringify(altered, null, 2)}\n`;
    await writeFile(join(root, t14RewrittenSliceSuccessorRelocationRecordPath), bytes);
    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        rewrittenSliceConfig(t14RewrittenSliceSuccessorRelocationRecordPath, createHash("sha256").update(bytes).digest("hex")),
      ),
    ).rejects.toThrow("stable anchor byte order");
    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        rewrittenSliceConfig(
          t14RewrittenSliceSuccessorRelocationRecordPath,
          "56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7",
        ),
      ),
    ).rejects.toThrow("reviewed record integrity");
  });

  it.each(["missing", "duplicate", "already bound", "cross-record"] as const)(
    "rejects %s rewritten-slice endpoint",
    async (kind) => {
      const pair = record.files[0]!.pairs[0]!;
      const observations =
        kind === "missing"
          ? discovered.filter((entry) => entry.id !== pair.new.id)
          : kind === "duplicate"
            ? [...discovered, pair.new]
            : kind === "already bound"
              ? [...discovered, pair.old]
              : discovered;
      const prior = kind === "cross-record" ? [{ id: pair.old.id, observed: pair.new }] : [];
      await expect(runReviewedRelocationRecord(
        repoRoot,
        fixture,
        allowances,
        observations,
        prior,
        rewrittenSliceConfig(
          t14RewrittenSliceSuccessorRelocationRecordPath,
          "56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7",
        ),
      )).rejects.toThrow();
    },
  );

  it("rejects allowance growth", async () => {
    const pair = record.files[0]!.pairs[0]!;
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(
      runReviewedRelocationRecord(
        repoRoot,
        fixture,
        [...allowances, extra],
        discovered,
        [],
        rewrittenSliceConfig(
          t14RewrittenSliceSuccessorRelocationRecordPath,
          "56216b0d2463f74a764159e86caf5fa3ab50d3f0e957b66362a840d2294b86a7",
        ),
      ),
    ).rejects.toThrow("allowance growth");
  });

  it("rejects rewritten slices when identical-slice stays the historical default", async () => {
    const root = await copyProofFixture();
    const bytes = `${JSON.stringify(record, null, 2)}\n`;
    const historicalSliceDefault: RelocationConfig = {
      recordPath: t14RewrittenSliceSuccessorRelocationRecordPath,
      recordSha256: createHash("sha256").update(bytes).digest("hex"),
      files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
      totalPairs: 57,
      rejectAllowanceGrowth: true,
      requireStableStructuralAnchor: true,
      requireStableByteOrder: true,
      requireUnchangedEvidence: false,
      activeFiles: record.files
        .map((section) => section.file)
        .filter((file) =>
          file !== "server/modules/parameter-modules/repository.ts"
          && file !== "server/modules/parameter-modules/service.test.ts",
        ),
    };
    await expect(
      runReviewedRelocationRecord(root, fixture, allowances, discovered, [], historicalSliceDefault),
    ).rejects.toThrow("identical raw slice");
  });
});
