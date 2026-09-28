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
import { issue913StaleRetiredSourceIds } from "./issue913StaleSuccessorRelocation";
import { issue913T14RetiredSourceIds } from "./issue913T14Relocation";
import * as historicalExports from "./runtimeTopologyRelocation";

const repoRoot = process.cwd();
const record: RuntimeTopologyRelocationRecord = JSON.parse(await readFile(join(repoRoot, sourceWorkflowRelocationRecordPath), "utf8"));
const consumerRecord: RuntimeTopologyRelocationRecord = JSON.parse(await readFile(join(repoRoot, sourceWorkflowConsumerRelocationRecordPath), "utf8"));
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];
const issue913RetiredSourceIds = [...issue913StaleRetiredSourceIds, ...issue913T14RetiredSourceIds];
const issue913RetiredSourceIdSet = new Set<string>(issue913RetiredSourceIds);

function expectCurrentRemovedPartition(removed: readonly BoundaryViolation[]) {
  expect(issue913StaleRetiredSourceIds).toHaveLength(17);
  expect(issue913T14RetiredSourceIds).toHaveLength(4);
  expect(issue913RetiredSourceIdSet.size).toBe(21);
  expect(fixture.violations.filter((entry) => issue913RetiredSourceIdSet.has(entry.id))).toHaveLength(21);
  expect(removed).toHaveLength(28 + 17 + 4);
  expect(removed.filter((entry) => issue913RetiredSourceIdSet.has(entry.id)).map((entry) => entry.id).sort())
    .toEqual([...issue913RetiredSourceIdSet].sort());
  expect(removed.filter((entry) => !issue913RetiredSourceIdSet.has(entry.id))).toHaveLength(28);
}

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
  it.each([
    ["s12-cgh.json", [
      "S12-CGH:legacy-catalog-raw-read:f896e7f3eb92d74a:1c2152d581a399d4",
      "S12-CGH:legacy-catalog-raw-read:f896e7f3eb92d74a:bc98c8531e5a7912",
      "S12-CGH:legacy-catalog-raw-read:32c7c282fc86d595:a9020488f6a3f702",
      "S12-CGH:legacy-catalog-raw-read:e8460da769e6f7bc:295a9b23da0d2686",
      "S12-CGH:legacy-catalog-raw-read:1ecb6a19a8008bf3:00837e997d4ebf04",
      "S12-CGH:legacy-catalog-raw-read:10573cc33cfa7a59:ecde0b88b0c1ff7f",
      "S12-CGH:legacy-catalog-raw-read:f89031bd1c4f16f1:f24a24eed95bd88b",
      "S12-CGH:legacy-catalog-raw-read:f89031bd1c4f16f1:75286f5fbe8f462c",
      "S12-CGH:legacy-catalog-raw-read:20d92886e18a86a3:54c0178542c4bf9b",
      "S12-CGH:legacy-catalog-raw-read:20d92886e18a86a3:b31292a51ecbd11f",
    ], []],
    ["s12-prj.json", ["S12-PRJ:unresolved-boundary-expression:cc362bf31617ab18:e6547c8da21e8b6b"], [
      "S12-PRJ:legacy-catalog-raw-read:613007d0d70a4003:0a30c88b9f209be9",
      "S12-PRJ:unresolved-boundary-expression:64a8d2cbafc6a08a:347f2ea33343631c",
    ]],
  ] as const)("retires exactly the reviewed vanished slices in %s", async (name, historicalRetiredIds, issue913ShardRetiredIds) => {
    const shardPath = `scripts/parameter-catalog-allowlist/shards/${name}`;
    const previous = JSON.parse(execFileSync("git", [
      "show", `5355f973bfb42dbc4bf47bfac25d56204bf550a9:${shardPath}`,
    ], { cwd: repoRoot, encoding: "utf8" })) as { entries: typeof allowances };
    const historicalRetired = new Set<string>(historicalRetiredIds);
    const issue913ShardRetired = new Set<string>(issue913ShardRetiredIds);
    const retired = new Set<string>([...historicalRetired, ...issue913ShardRetired]);
    expect(previous.entries.filter((entry) => historicalRetired.has(entry.id))).toHaveLength(historicalRetired.size);
    expect(previous.entries.filter((entry) => issue913ShardRetired.has(entry.id)).map((entry) => entry.id).sort())
      .toEqual([...issue913ShardRetired].sort());
    if (name === "s12-prj.json") {
      expect(issue913StaleRetiredSourceIds.filter((id) => id.startsWith("S12-PRJ:")).sort())
        .toEqual([...issue913ShardRetired].sort());
      expect(issue913T14RetiredSourceIds.filter((id) => id.startsWith("S12-PRJ:"))).toEqual([]);
    }
    expect(JSON.parse(await readFile(join(repoRoot, shardPath), "utf8"))).toEqual({
      ...previous, entries: previous.entries.filter((entry) => !retired.has(entry.id)),
    });
  });

  it("retires only the vanished topology allowance and retains both same-anchor successors", async () => {
    const shardPath = "scripts/parameter-catalog-allowlist/shards/s12-top.json";
    const previous = JSON.parse(execFileSync("git", [
      "show", `5355f973bfb42dbc4bf47bfac25d56204bf550a9:${shardPath}`,
    ], { cwd: repoRoot, encoding: "utf8" })) as { entries: typeof allowances };
    const current = JSON.parse(await readFile(join(repoRoot, shardPath), "utf8"));
    const retiredId = "S12-TOP:legacy-effective-governance-contract:76423aea8d138544:77688cbfd1ad3992";
    expect(previous.entries.filter((entry) => entry.id === retiredId)).toHaveLength(1);
    expect(current).toEqual({ ...previous, entries: previous.entries.filter((entry) => entry.id !== retiredId) });
    const anchor = retiredId.split(":").slice(0, 3).join(":");
    const survivors = consumerRecord.files.flatMap((section) => section.pairs)
      .filter((pair) => pair.old.id.split(":").slice(0, 3).join(":") === anchor);
    expect(survivors).toHaveLength(2);
    expect(new Set(survivors.flatMap((pair) => [pair.old.id, pair.new.id])).size).toBe(4);
    expect(survivors.some((pair) => pair.old.id === retiredId)).toBe(false);
    for (const pair of survivors) {
      expect(discovered.find((entry) => entry.id === pair.new.id)).toEqual(pair.new);
    }
  });

  it("binds 237 current consumer observations without conflating shared-range evidence", async () => {
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    const result = await applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, first.violations, first.relocations);
    expect(result.relocations).toHaveLength(237);
    expect(consumerRecord.files.map((section) => section.pairs.length)).toEqual([2, 2, 82, 14, 1, 16, 29, 1, 22, 32, 2, 2, 30, 2]);
    const ends = [...first.relocations, ...result.relocations].flatMap((entry) => [entry.id, entry.observed.id]);
    expect(new Set(ends).size).toBe(638);
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
    expectCurrentRemovedPartition(removed);
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
    expectCurrentRemovedPartition(removed);
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
