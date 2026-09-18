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
  applyReviewedT14RewrittenSliceSuccessorRelocation,
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
    recordPath: path,
    recordSha256: sha256,
    files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
    totalPairs: 51,
    rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true,
    requireStableByteOrder: true,
    requireIdenticalSlice: false,
    requireUnchangedEvidence: false,
  };
}

describe("T1.4 rewritten-slice current successor", () => {
  it("binds 51 destinations whose evidence or raw slice may change", async () => {
    const result = await applyReviewedT14RewrittenSliceSuccessorRelocation(
      repoRoot,
      fixture,
      allowances,
      discovered,
    );
    expect(result.relocations).toHaveLength(51);
    expect(new Set(result.relocations.map((entry) => entry.id)).size).toBe(51);
    expect(new Set(result.relocations.map((entry) => entry.observed.id)).size).toBe(51);
    const pairs = record.files.flatMap((section) => section.pairs);
    expect(pairs.every((pair) => pair.sourceSliceSha256 && pair.sliceSha256)).toBe(true);
    expect(
      pairs.some(
        (pair) => pair.old.evidence !== pair.new.evidence || pair.sourceSliceSha256 !== pair.sliceSha256,
      ),
    ).toBe(true);
    expect(record.files.map((section) => section.pairs.length)).toEqual([1, 3, 14, 9, 5, 4, 3, 7, 5]);
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
      applyReviewedT14RewrittenSliceSuccessorRelocation(root, fixture, allowances, discovered),
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
      await expect(
        applyReviewedT14RewrittenSliceSuccessorRelocation(repoRoot, fixture, allowances, observations, prior),
      ).rejects.toThrow();
    },
  );

  it("rejects allowance growth", async () => {
    const pair = record.files[0]!.pairs[0]!;
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(
      applyReviewedT14RewrittenSliceSuccessorRelocation(repoRoot, fixture, [...allowances, extra], discovered),
    ).rejects.toThrow("allowance growth");
  });

  it("rejects rewritten slices when identical-slice stays the historical default", async () => {
    const root = await copyProofFixture();
    const bytes = `${JSON.stringify(record, null, 2)}\n`;
    const historicalSliceDefault: RelocationConfig = {
      recordPath: t14RewrittenSliceSuccessorRelocationRecordPath,
      recordSha256: createHash("sha256").update(bytes).digest("hex"),
      files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
      totalPairs: 51,
      rejectAllowanceGrowth: true,
      requireStableStructuralAnchor: true,
      requireStableByteOrder: true,
      requireUnchangedEvidence: false,
    };
    await expect(
      runReviewedRelocationRecord(root, fixture, allowances, discovered, [], historicalSliceDefault),
    ).rejects.toThrow("identical raw slice");
  });
});
