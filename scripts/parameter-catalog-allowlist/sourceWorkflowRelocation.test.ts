import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import { compareBoundaryInventory } from "./deterministicOutput";
import { applyReviewedSourceWorkflowRelocation, sourceWorkflowRelocationRecordPath,
  applyReviewedSourceWorkflowConsumerRelocation, sourceWorkflowConsumerRelocationRecordPath } from "./sourceWorkflowRelocation";
import {
  runReviewedRelocationRecord, verifyHistoricalRuntimeTopologyRelocation, runtimeTopologyRelocationRecordPath,
  type RuntimeTopologyRelocationRecord, type RelocationConfig,
} from "./runtimeTopologyRelocation";
import { verifyHistoricalEditServiceVersionIndexRelocation, editServiceVersionIndexRelocationRecordPath } from "./editServiceVersionIndexRelocation";
import type { BoundaryViolation } from "./schema";
import * as historicalExports from "./runtimeTopologyRelocation";

const repoRoot = process.cwd();
const record: RuntimeTopologyRelocationRecord = JSON.parse(await readFile(join(repoRoot, sourceWorkflowRelocationRecordPath), "utf8"));
const consumerRecord: RuntimeTopologyRelocationRecord = JSON.parse(await readFile(join(repoRoot, sourceWorkflowConsumerRelocationRecordPath), "utf8"));
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];
beforeAll(async () => { discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha); }, 60_000);
afterAll(async () => { await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))); });

async function copyProofFixture(withHistory = true) {
  const root = await mkdtemp(join(tmpdir(), "source-workflow-identity-"));
  temporaryRoots.push(root);
  for (const file of [sourceWorkflowRelocationRecordPath, runtimeTopologyRelocationRecordPath,
    editServiceVersionIndexRelocationRecordPath, sourceWorkflowConsumerRelocationRecordPath,
    ...record.files.map((section) => section.file), ...consumerRecord.files.map((section) => section.file)]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), await readFile(join(repoRoot, file)));
  }
  if (withHistory) {
    // Read-only Git object access; all mutation probes target the disposable files.
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: repoRoot, encoding: "utf8" }).trim();
    await writeFile(join(root, ".git"), `gitdir: ${gitDir}\n`);
  } else execFileSync("git", ["init", "--quiet", root]);
  return root;
}

describe("source workflow exact identity successor", () => {
  it("binds 202 current consumer observations without conflating shared-range evidence", async () => {
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    const result = await applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, first.violations, first.relocations);
    expect(result.relocations).toHaveLength(202);
    expect(consumerRecord.files.map((section) => section.pairs.length)).toEqual([2, 2, 83, 14, 1, 16, 29, 1, 22, 32]);
    const ends = [...first.relocations, ...result.relocations].flatMap((entry) => [entry.id, entry.observed.id]);
    expect(new Set(ends).size).toBe(568);
    const pairs = consumerRecord.files.find((section) => section.file.endsWith("importBatchRepository.ts"))!.pairs;
    const shared = pairs.filter((pair) => pairs.some((other) => other.old.byteStart === pair.old.byteStart
      && other.old.byteEnd === pair.old.byteEnd && other.old.evidence !== pair.old.evidence
      && other.old.id.split(":").slice(0, 3).join(":") === pair.old.id.split(":").slice(0, 3).join(":")));
    expect(shared.length).toBeGreaterThan(0);
    for (const pair of shared) {
      expect(result.violations.find((entry) => entry.id === pair.old.id)).toEqual(pair.old);
      expect(result.relocations.find((entry) => entry.id === pair.old.id)?.observed).toEqual(pair.new);
    }
  });

  it("rejects missing or self-resigned consumer record", async () => {
    const root = await copyProofFixture();
    await writeFile(join(root, sourceWorkflowConsumerRelocationRecordPath), "{}\n");
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, discovered)).rejects.toThrow("reviewed record integrity");
    await rm(join(root, sourceWorkflowConsumerRelocationRecordPath));
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, discovered)).rejects.toThrow("ENOENT");
  });

  it.each(consumerRecord.files.map((section) => section.file))("rejects consumer whole-file drift: %s", async (file) => {
    const root = await copyProofFixture();
    await writeFile(join(root, file), Buffer.concat([await readFile(join(root, file)), Buffer.from("\n// future edit\n")]));
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, discovered)).rejects.toThrow("destination whole-file blob");
  });

  it.each(["missing", "duplicate", "already bound", "cross-record"])("rejects %s consumer endpoint", async (kind) => {
    const pair = consumerRecord.files[0]!.pairs[0]!;
    const observations = kind === "missing" ? discovered.filter((entry) => entry.id !== pair.new.id)
      : kind === "duplicate" ? [...discovered, pair.new] : kind === "already bound" ? [...discovered, pair.old] : discovered;
    const prior = kind === "cross-record" ? [{ id: pair.old.id, observed: pair.new }] : [];
    await expect(applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, observations, prior)).rejects.toThrow();
  });

  it("rejects consumer allowance growth and leaves restored or new debt unallowed", async () => {
    const pair = consumerRecord.files[0]!.pairs[0]!;
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, [...allowances, extra], discovered)).rejects.toThrow("allowance growth");
    const removed = fixture.violations.filter((entry) => !allowances.some((allowance) => allowance.id === entry.id));
    expect(removed).toHaveLength(16);
    const unrelated = { ...pair.new, id: pair.new.id.slice(0, -16) + "e".repeat(16) };
    const result = await applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, [...discovered, unrelated, ...removed]);
    expect(compareBoundaryInventory(result.violations, allowances, fixture.violations).unallowlisted).toEqual(expect.arrayContaining([unrelated, ...removed]));
  });

  it("exposes only fixed historical proof entry points", () => {
    expect(historicalExports).not.toHaveProperty("verifyHistoricalRelocationRecord");
    expect(historicalExports.verifyHistoricalRuntimeTopologyRelocation).toBeTypeOf("function");
    expect(historicalExports.verifyHistoricalEditServiceVersionIndexRelocation).toBeTypeOf("function");
  });
  it("proves history separately and binds all 82 actual current observations", async () => {
    const runtime = await verifyHistoricalRuntimeTopologyRelocation(repoRoot, fixture, allowances);
    const edit = await verifyHistoricalEditServiceVersionIndexRelocation(repoRoot, fixture, allowances);
    expect(runtime.pairs).toHaveLength(16);
    expect(edit.pairs).toHaveLength(59);
    expect(runtime).not.toHaveProperty("relocations");
    expect(edit).not.toHaveProperty("relocations");
    const result = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    expect(result.relocations).toHaveLength(82);
    const ids = new Set(result.relocations.map((entry) => entry.id));
    expect(ids.size).toBe(82);
    const historic = [...runtime.pairs, ...edit.pairs];
    expect(historic.every((pair) => ids.has(pair.old.id))).toBe(true);
    expect(result.relocations.filter((entry) => !historic.some((pair) => pair.old.id === entry.id))).toHaveLength(7);
    expect(record.files.map((section) => section.pairs.length)).toEqual([20, 3, 26, 28, 5]);
    for (const pair of record.files.flatMap((section) => section.pairs)) {
      expect(pair.new.id.split(":").slice(0, 3)).toEqual(pair.old.id.split(":").slice(0, 3));
    }
  });

  it.each([runtimeTopologyRelocationRecordPath, editServiceVersionIndexRelocationRecordPath, sourceWorkflowRelocationRecordPath])(
    "rejects a missing or changed record: %s", async (path) => {
      const root = await copyProofFixture();
      await writeFile(join(root, path), "{}\n");
      await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("reviewed record integrity");
      await rm(join(root, path));
      await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("ENOENT");
    },
  );

  it("rejects missing historical Git objects", async () => {
    const root = await copyProofFixture(false);
    await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow();
  });

  it.each(record.files.map((section) => section.file))("rejects current whole-file drift, including untouched file: %s", async (file) => {
    const root = await copyProofFixture();
    await writeFile(join(root, file), Buffer.concat([await readFile(join(root, file)), Buffer.from("\n// future edit\n")]));
    await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("destination whole-file blob");
  });

  it("does not fall back to the historical destination", async () => {
    const root = await copyProofFixture();
    const file = record.files[0]!.file;
    await writeFile(join(root, file), execFileSync("git", ["show", `e31226b6cc06c2278230b810bb1becd8dbc1f32a:${file}`], { cwd: repoRoot }));
    await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("destination whole-file blob");
  });

  it.each(["missing", "duplicate", "already bound", "cross-record"])("rejects %s current endpoint", async (kind) => {
    const pair = record.files[0]!.pairs[0]!;
    const observations = kind === "missing" ? discovered.filter((entry) => entry.id !== pair.new.id)
      : kind === "duplicate" ? [...discovered, pair.new] : kind === "already bound" ? [...discovered, pair.old] : discovered;
    const prior = kind === "cross-record" ? [{ id: pair.old.id, observed: pair.new }] : [];
    await expect(applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, observations, prior)).rejects.toThrow();
  });

  it("rejects allowance growth and leaves unrelated/removed debt unallowed", async () => {
    const pair = record.files[0]!.pairs[0]!;
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(applyReviewedSourceWorkflowRelocation(repoRoot, fixture, [...allowances, extra], discovered)).rejects.toThrow("allowance growth");
    const removed = fixture.violations.filter((entry) => !allowances.some((allowance) => allowance.id === entry.id));
    expect(removed).toHaveLength(16);
    const unrelated = { ...pair.new, id: pair.new.id.slice(0, -16) + "f".repeat(16) };
    const result = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, [...discovered, unrelated, ...removed]);
    expect(compareBoundaryInventory(result.violations, allowances, fixture.violations).unallowlisted).toEqual(expect.arrayContaining([unrelated, ...removed]));
  });

  it("rejects same-anchor same-slice swaps even with a test-only re-signed config", async () => {
    const root = await copyProofFixture();
    const altered = structuredClone(record);
    const pairs = altered.files[0]!.pairs;
    const left = pairs.findIndex((pair, index) => pairs.some((other, otherIndex) => otherIndex > index
      && other.old.id.split(":").slice(0, 3).join(":") === pair.old.id.split(":").slice(0, 3).join(":")));
    expect(left).toBeGreaterThanOrEqual(0);
    const right = pairs.findIndex((pair, index) => index > left && pair.old.id.split(":").slice(0, 3).join(":") === pairs[left]!.old.id.split(":").slice(0, 3).join(":"));
    [pairs[left]!.new, pairs[right]!.new] = [pairs[right]!.new, pairs[left]!.new];
    const bytes = `${JSON.stringify(altered, null, 2)}\n`;
    await writeFile(join(root, sourceWorkflowRelocationRecordPath), bytes);
    const testConfig: RelocationConfig = {
      recordPath: sourceWorkflowRelocationRecordPath, recordSha256: createHash("sha256").update(bytes).digest("hex"),
      files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })), totalPairs: 82,
      rejectAllowanceGrowth: true, requireStableStructuralAnchor: true, requireStableByteOrder: true,
    };
    await expect(runReviewedRelocationRecord(root, fixture, allowances, discovered, [], testConfig)).rejects.toThrow("stable anchor byte order");
    // The production entry point still rejects self-signing before granting aliases.
    await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("reviewed record integrity");
  });
});
