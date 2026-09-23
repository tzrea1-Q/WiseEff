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
  applyReviewedSourceWorkflowConsumerRelocation, sourceWorkflowConsumerRelocationRecordPath,
  applyReviewedIssue911Relocation, issue911RelocationRecordPath,
  verifyHistoricalSourceWorkflowRelocation, verifyHistoricalSourceWorkflowConsumerRelocation } from "./sourceWorkflowRelocation";
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
const issue911Record: RuntimeTopologyRelocationRecord = JSON.parse(await readFile(join(repoRoot, issue911RelocationRecordPath), "utf8"));
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const issue900Retirement = JSON.parse(await readFile(join(
  repoRoot, "scripts/fixtures/parameter-catalog-allowlist/issue-900-dashboard-retirement.json",
), "utf8")) as { retiredAllowlistEntries: Array<{ id: string }> };
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];
beforeAll(async () => { discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha); }, 60_000);
afterAll(async () => { await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true }))); });

function issue911Observations() {
  const currentIds = new Set(issue911Record.files.flatMap((section) => section.pairs.map((pair) => pair.new.id)));
  return discovered.filter((entry) => currentIds.has(entry.id));
}

function issue911FileObservations() {
  const files = new Set(issue911Record.files.map((section) => section.file));
  return discovered.filter((entry) => files.has(entry.file));
}

async function copyProofFixture(withHistory = true) {
  const root = await mkdtemp(join(tmpdir(), "source-workflow-identity-"));
  temporaryRoots.push(root);
  for (const file of [sourceWorkflowRelocationRecordPath, runtimeTopologyRelocationRecordPath,
    editServiceVersionIndexRelocationRecordPath, sourceWorkflowConsumerRelocationRecordPath,
    issue911RelocationRecordPath,
    ...record.files.map((section) => section.file), ...consumerRecord.files.map((section) => section.file),
    ...issue911Record.files.map((section) => section.file)]) {
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
    ]],
    ["s12-prj.json", ["S12-PRJ:unresolved-boundary-expression:cc362bf31617ab18:e6547c8da21e8b6b"]],
  ] as const)("retires exactly the reviewed vanished slices in %s", async (name, retiredIds) => {
    const shardPath = `scripts/parameter-catalog-allowlist/shards/${name}`;
    const previous = JSON.parse(execFileSync("git", [
      "show", `5355f973bfb42dbc4bf47bfac25d56204bf550a9:${shardPath}`,
    ], { cwd: repoRoot, encoding: "utf8" })) as { entries: typeof allowances };
    const retiredByWorkflow = new Set<string>(retiredIds);
    expect(previous.entries.filter((entry) => retiredByWorkflow.has(entry.id))).toHaveLength(retiredByWorkflow.size);
    const retiredByIssue900 = new Set(name === "s12-prj.json"
      ? issue900Retirement.retiredAllowlistEntries.map((entry) => entry.id)
      : []);
    if (retiredByIssue900.size > 0) {
      expect(previous.entries.filter((entry) => retiredByIssue900.has(entry.id))).toHaveLength(retiredByIssue900.size);
    }
    const retired = new Set([...retiredByWorkflow, ...retiredByIssue900]);
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

  it("binds unchanged consumer observations without conflating shared-range evidence", async () => {
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    const result = await applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, first.violations, first.relocations);
    expect(first.relocations).toHaveLength(212);
    expect(first.relocations.filter((entry) => entry.observed.file === "server/modules/parameter-topology/schemas.ts")).toHaveLength(3);
    expect(first.relocations.filter((entry) => entry.observed.file === "src/infrastructure/http/parameterTopologyClient.test.ts")).toHaveLength(24);
    expect(first.relocations.filter((entry) => entry.observed.file === "src/infrastructure/http/parameterTopologyClient.ts")).toHaveLength(32);
    expect(result.relocations).toHaveLength(183);
    expect(consumerRecord.files.map((section) => section.pairs.length)).toEqual([2, 2, 82, 14, 1, 16, 29, 1, 22, 32, 2, 2, 30, 2]);
    const ends = [...first.relocations, ...result.relocations].flatMap((entry) => [entry.id, entry.observed.id]);
    expect(new Set(ends).size).toBe(790);
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
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, first.violations, first.relocations)).rejects.toThrow("reviewed record integrity");
    await rm(join(root, sourceWorkflowConsumerRelocationRecordPath));
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, first.violations, first.relocations)).rejects.toThrow("ENOENT");
  });

  it.each(consumerRecord.files
    .filter((section) => section.file !== "src/infrastructure/http/parameterTopologyClient.test.ts"
      && section.file !== "src/infrastructure/http/parameterTopologyClient.ts")
    .map((section) => section.file))("rejects unchanged consumer whole-file drift: %s", async (file) => {
    const root = await copyProofFixture();
    await writeFile(join(root, file), Buffer.concat([await readFile(join(root, file)), Buffer.from("\n// future edit\n")]));
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    await expect(applyReviewedSourceWorkflowConsumerRelocation(root, fixture, allowances, first.violations, first.relocations)).rejects.toThrow("destination whole-file blob");
  });

  it.each(["missing", "duplicate", "already bound", "cross-record"])("rejects %s consumer endpoint", async (kind) => {
    const pair = consumerRecord.files[0]!.pairs[0]!;
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    const observations = kind === "missing" ? first.violations.filter((entry) => entry.id !== pair.new.id)
      : kind === "duplicate" ? [...first.violations, pair.new] : kind === "already bound" ? [...first.violations, pair.old] : first.violations;
    const prior = kind === "cross-record" ? [...first.relocations, { id: pair.old.id, observed: pair.new }] : first.relocations;
    await expect(applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, observations, prior)).rejects.toThrow();
  });

  it("rejects consumer allowance growth and leaves restored or new debt unallowed", async () => {
    const pair = consumerRecord.files[0]!.pairs[0]!;
    const first = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, [...allowances, extra], first.violations, first.relocations)).rejects.toThrow("allowance growth");
    const removed = fixture.violations.filter((entry) => !allowances.some((allowance) => allowance.id === entry.id));
    expect(removed).toHaveLength(41);
    const unrelated = { ...pair.new, id: pair.new.id.slice(0, -16) + "e".repeat(16) };
    const result = await applyReviewedSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances, [...first.violations, unrelated, ...removed], first.relocations);
    expect(compareBoundaryInventory(result.violations, allowances, fixture.violations).unallowlisted).toEqual(expect.arrayContaining([unrelated, ...removed]));
  });

  it("exposes only fixed historical proof entry points", () => {
    expect(historicalExports).not.toHaveProperty("verifyHistoricalRelocationRecord");
    expect(historicalExports.verifyHistoricalRuntimeTopologyRelocation).toBeTypeOf("function");
    expect(historicalExports.verifyHistoricalEditServiceVersionIndexRelocation).toBeTypeOf("function");
    expect(historicalExports.verifyHistoricalRelocationProof).toBeTypeOf("function");
  });
  it("proves immutable history separately and binds all 133 Issue 911 observations", async () => {
    const runtime = await verifyHistoricalRuntimeTopologyRelocation(repoRoot, fixture, allowances);
    const edit = await verifyHistoricalEditServiceVersionIndexRelocation(repoRoot, fixture, allowances);
    const workflow = await verifyHistoricalSourceWorkflowRelocation(repoRoot, fixture, allowances);
    const consumer = await verifyHistoricalSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances);
    expect(runtime.pairs).toHaveLength(16);
    expect(edit.pairs).toHaveLength(59);
    expect(workflow.pairs).toHaveLength(82);
    expect(consumer.pairs).toHaveLength(237);
    expect(runtime).not.toHaveProperty("relocations");
    expect(edit).not.toHaveProperty("relocations");
    expect(workflow).not.toHaveProperty("relocations");
    expect(consumer).not.toHaveProperty("relocations");
    const result = await applyReviewedSourceWorkflowRelocation(repoRoot, fixture, allowances, discovered);
    expect(result.relocations).toHaveLength(212);
    const ids = new Set(result.relocations.map((entry) => entry.id));
    expect(ids.size).toBe(212);
    const historic = [...runtime.pairs, ...edit.pairs, ...workflow.pairs];
    expect(historic.every((pair) => ids.has(pair.old.id))).toBe(true);
    expect(result.relocations.filter((entry) => !historic.some((pair) => pair.old.id === entry.id))).toHaveLength(130);
    expect(record.files.map((section) => section.pairs.length)).toEqual([20, 3, 26, 28, 5]);
    expect(issue911Record.files.map((section) => section.pairs.length)).toEqual([3, 24, 32, 58, 14, 2]);
    const current = issue911Observations();
    expect(current).toHaveLength(133);
    expect(new Set(current.map((entry) => entry.id))).toEqual(new Set(issue911Record.files.flatMap((section) => section.pairs.map((pair) => pair.new.id))));
    const successorIds = new Set(current.map((entry) => entry.id));
    const stableResidual = issue911FileObservations().filter((entry) => !successorIds.has(entry.id));
    expect(stableResidual).toHaveLength(3);
    const expectedStableResidual = [
      {
        id: "S12-TOP:legacy-catalog-module-import:9fe2f253db6ef7b6:fcf7bdb948a16395",
        baselineId: "S12-TOP:legacy-catalog-module-import:9fe2f253db6ef7b6:e97ed51d236d790d",
        line: 12,
        token: "../parameter-specs/repository",
        reason: "Consumer code still imports the legacy parameter-specs module.",
      },
      {
        id: "S12-TOP:legacy-catalog-module-import:f6ec763946ca6d62:1cf7c86efeec7a9f",
        baselineId: "S12-TOP:legacy-catalog-module-import:f6ec763946ca6d62:a5a7e1ac3d12d9e7",
        line: 16,
        token: "../parameter-specs/definitionVerification",
        reason: "Consumer code still imports the legacy parameter-specs module.",
      },
      {
        id: "S12-TOP:legacy-effective-governance-contract:cff09e6ddc0a2c50:1af9bee86461eb97",
        baselineId: "S12-TOP:legacy-effective-governance-contract:cff09e6ddc0a2c50:fe23371930b85334",
        line: 16,
        token: "verifyEffectiveDriverParameterDefinitions",
        reason: "Legacy Effective or Governance catalog projection remains in a consumer contract.",
      },
    ];
    expect(stableResidual.map(({ id, file, line, rule, token, reason }) => ({ id, file, line, rule, token, reason })).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(expectedStableResidual.map(({ id, line, token, reason }) => ({
        id,
        file: "server/modules/parameter-topology/service.ts",
        line,
        rule: id.split(":")[1],
        token,
        reason,
      })).sort((a, b) => a.id.localeCompare(b.id)));
    for (const entry of stableResidual) {
      const expected = expectedStableResidual.find((candidate) => candidate.id === entry.id)!;
      const baseline = fixture.violations.find((candidate) => candidate.id === expected.baselineId);
      expect(baseline).toBeDefined();
      expect([
        baseline!.family,
        baseline!.rule,
        baseline!.file,
        String(baseline!.byteStart),
        String(baseline!.byteEnd),
        baseline!.token,
        baseline!.evidence,
      ].join("\0")).toBe([
        entry.family,
        entry.rule,
        entry.file,
        String(entry.byteStart),
        String(entry.byteEnd),
        entry.token,
        entry.evidence,
      ].join("\0"));
      expect(allowances.find((allowance) => allowance.id === baseline!.id)).toEqual({
        id: baseline!.id,
        file: baseline!.file,
        rule: baseline!.rule,
        reason: baseline!.reason,
      });
    }
    for (const pair of issue911Record.files.flatMap((section) => section.pairs)) {
      expect(discovered.find((entry) => entry.id === pair.new.id)).toEqual(pair.new);
    }
    for (const pair of record.files.flatMap((section) => section.pairs)) {
      expect(pair.new.id.split(":").slice(0, 3)).toEqual(pair.old.id.split(":").slice(0, 3));
    }
  });

  it("binds all 133 scanner records with exact metadata, anchors, order, and raw slices", async () => {
    const observations = issue911Observations();
    const result = await applyReviewedIssue911Relocation(repoRoot, fixture, allowances, observations);
    const sourceWorkflowOldIds = new Set(record.files.flatMap((section) => section.pairs.map((pair) => pair.old.id)));
    const consumerOldIds = new Set(consumerRecord.files.flatMap((section) => section.pairs.map((pair) => pair.old.id)));
    const successorPairs = issue911Record.files.flatMap((section) => section.pairs);
    const successorOldIds = successorPairs.map((pair) => pair.old.id);
    const successorNewIds = successorPairs.map((pair) => pair.new.id);
    const sourceByFile = new Map(issue911Record.files.map((section) => [
      section.file,
      execFileSync("git", ["show", `${fixture.trustedBaseSha}:${section.file}`], { cwd: repoRoot }),
    ]));

    expect(issue911Record.files.map(({ file, pairs }) => [file, pairs.length])).toEqual([
      ["server/modules/parameter-topology/schemas.ts", 3],
      ["src/infrastructure/http/parameterTopologyClient.test.ts", 24],
      ["src/infrastructure/http/parameterTopologyClient.ts", 32],
      ["server/modules/parameter-topology/bindingService.ts", 58],
      ["server/modules/parameter-topology/service.ts", 14],
      ["server/modules/parameter-topology/service.test.ts", 2],
    ]);
    expect(observations).toHaveLength(133);
    expect(new Set(successorOldIds).size).toBe(133);
    expect(new Set(successorNewIds).size).toBe(133);
    expect(successorOldIds.filter((id) => sourceWorkflowOldIds.has(id))).toHaveLength(3);
    expect(successorOldIds.filter((id) => consumerOldIds.has(id))).toHaveLength(54);
    const unrecordedPairs = successorPairs.filter((pair) =>
      !sourceWorkflowOldIds.has(pair.old.id) && !consumerOldIds.has(pair.old.id));
    expect(unrecordedPairs).toHaveLength(76);
    expect(unrecordedPairs.filter((pair) => ![
      "server/modules/parameter-topology/bindingService.ts",
      "server/modules/parameter-topology/service.ts",
      "server/modules/parameter-topology/service.test.ts",
    ].includes(pair.old.file)).map((pair) => pair.old.id).sort()).toEqual([
      "S12-TOP:legacy-parameter-spec-identifier:2f10fffcedb520cb:a7946cfaf2b74e70",
      "S12-TOP:legacy-parameter-spec-identifier:4c7221a2d9f1a7bc:cd5b4f01bf89b99f",
    ]);
    expect(result.relocations).toEqual(issue911Record.files.flatMap((section) => section.pairs.map((pair) => ({
      id: pair.old.id,
      observed: pair.new,
    }))));

    for (const section of issue911Record.files) {
      expect(execFileSync("git", ["rev-parse", `${fixture.trustedBaseSha}:${section.file}`], { cwd: repoRoot, encoding: "utf8" }).trim())
        .toBe(section.sourceBlobOid);
      expect(execFileSync("git", ["rev-parse", `683297cfc4d66bd474446c346dbc212d28d7c1a8:${section.file}`], { cwd: repoRoot, encoding: "utf8" }).trim())
        .toBe(section.destinationBlobOid);
      const current = observations.filter((entry) => entry.file === section.file);
      const source = sourceByFile.get(section.file)!;
      const destination = await readFile(join(repoRoot, section.file));
      expect(execFileSync("git", ["hash-object", section.file], { cwd: repoRoot, encoding: "utf8" }).trim())
        .toBe(section.destinationBlobOid);
      expect(new Set(current.map((entry) => entry.id)).size).toBe(section.pairs.length);
      expect(current.map((entry) => entry.id).sort()).toEqual(section.pairs.map((pair) => pair.new.id).sort());
      const currentById = new Map(current.map((entry) => [entry.id, entry]));

      const previousDestinationByAnchor = new Map<string, number>();
      for (const pair of section.pairs) {
        expect(currentById.get(pair.new.id)).toEqual(pair.new);
        const anchor = pair.old.id.split(":").slice(0, 3).join(":");
        expect(pair.new.id.split(":").slice(0, 3).join(":")).toBe(anchor);
        const sourceSlice = source.subarray(pair.old.byteStart, pair.old.byteEnd);
        expect(sourceSlice).toEqual(destination.subarray(pair.new.byteStart, pair.new.byteEnd));
        expect(createHash("sha256").update(sourceSlice).digest("hex")).toBe(pair.sliceSha256);

        const orderKey = JSON.stringify([anchor, pair.old.token, pair.old.evidence, pair.old.column]);
        const previousDestination = previousDestinationByAnchor.get(orderKey);
        if (previousDestination !== undefined) expect(pair.new.byteStart).toBeGreaterThan(previousDestination);
        previousDestinationByAnchor.set(orderKey, pair.new.byteStart);
      }
    }
  });

  it.each(["missing", "duplicate", "already bound", "cross-record"])("rejects %s Issue 911 successor endpoint", async (kind) => {
    const pair = issue911Record.files[0]!.pairs[0]!;
    const observations = kind === "missing" ? issue911Observations().filter((entry) => entry.id !== pair.new.id)
      : kind === "duplicate" ? [...issue911Observations(), pair.new]
        : kind === "already bound" ? [...issue911Observations(), pair.old]
          : issue911Observations();
    const prior = kind === "cross-record" ? [{ id: pair.old.id, observed: pair.new }] : [];
    await expect(applyReviewedIssue911Relocation(repoRoot, fixture, allowances, observations, prior)).rejects.toThrow();
  });

  it.each([
    "S12-TOP:legacy-parameter-spec-identifier:2f10fffcedb520cb:a7946cfaf2b74e70",
    "S12-TOP:legacy-parameter-spec-identifier:4c7221a2d9f1a7bc:cd5b4f01bf89b99f",
  ])("requires each fixture-origin successor endpoint: %s", async (oldId) => {
    const pair = issue911Record.files.flatMap((section) => section.pairs).find((entry) => entry.old.id === oldId);
    expect(pair).toBeDefined();
    await expect(applyReviewedIssue911Relocation(
      repoRoot, fixture, allowances, issue911Observations().filter((entry) => entry.id !== pair!.new.id),
    )).rejects.toThrow("exact destination occurrence");
  });

  it("rejects Issue 911 allowance growth and keeps added debt unallowed", async () => {
    const pair = issue911Record.files[0]!.pairs[0]!;
    const extra = { id: pair.new.id, file: pair.new.file, rule: pair.new.rule, reason: pair.new.reason };
    await expect(applyReviewedIssue911Relocation(repoRoot, fixture, [...allowances, extra], issue911Observations()))
      .rejects.toThrow("allowance growth");

    const removed = fixture.violations.filter((entry) => !allowances.some((allowance) => allowance.id === entry.id));
    const issue900RetiredIds = new Set(issue900Retirement.retiredAllowlistEntries.map((entry) => entry.id));
    expect(removed.filter((entry) => issue900RetiredIds.has(entry.id))).toHaveLength(13);
    expect(removed.filter((entry) => !issue900RetiredIds.has(entry.id))).toHaveLength(28);
    const unrelated = { ...pair.new, id: `${pair.new.id.slice(0, -16)}${"e".repeat(16)}` };
    const result = await applyReviewedIssue911Relocation(
      repoRoot, fixture, allowances, [...issue911Observations(), unrelated, ...removed],
    );
    expect(compareBoundaryInventory(result.violations, allowances, fixture.violations).unallowlisted)
      .toEqual(expect.arrayContaining([unrelated, ...removed]));
  });

  it("rejects a changed Issue 911 endpoint even when a test-only config re-signs it", async () => {
    const root = await copyProofFixture();
    const altered = structuredClone(issue911Record);
    altered.files[0]!.pairs[0]!.new.line += 1;
    const bytes = `${JSON.stringify(altered, null, 2)}\n`;
    await writeFile(join(root, issue911RelocationRecordPath), bytes);
    const testConfig: RelocationConfig = {
      recordPath: issue911RelocationRecordPath,
      recordSha256: createHash("sha256").update(bytes).digest("hex"),
      files: issue911Record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
      totalPairs: 133,
      rejectAllowanceGrowth: true,
      requireStableStructuralAnchor: true,
      requireStableByteOrder: true,
    };
    await expect(runReviewedRelocationRecord(root, fixture, allowances, issue911Observations(), [], testConfig))
      .rejects.toThrow("exact destination occurrence");
    await expect(applyReviewedIssue911Relocation(root, fixture, allowances, issue911Observations()))
      .rejects.toThrow("reviewed record integrity");
  });

  it("rejects a same-anchor successor swap even when a test-only config re-signs it", async () => {
    const root = await copyProofFixture();
    const altered = structuredClone(issue911Record);
    let swapped = false;
    for (const section of altered.files) {
      const groups = new Map<string, number[]>();
      section.pairs.forEach((pair, index) => {
        const anchor = JSON.stringify([
          pair.old.id.split(":").slice(0, 3).join(":"),
          pair.old.token,
          pair.old.evidence,
          pair.old.column,
        ]);
        groups.set(anchor, [...(groups.get(anchor) ?? []), index]);
      });
      const group = [...groups.values()].find((indices) => indices.length > 1);
      if (group) {
        const ordered = group.sort((left, right) => section.pairs[left]!.old.byteStart - section.pairs[right]!.old.byteStart);
        [section.pairs[ordered[0]!]!.new, section.pairs[ordered[1]!]!.new] = [
          section.pairs[ordered[1]!]!.new,
          section.pairs[ordered[0]!]!.new,
        ];
        swapped = true;
        break;
      }
    }
    expect(swapped).toBe(true);
    const bytes = `${JSON.stringify(altered, null, 2)}\n`;
    await writeFile(join(root, issue911RelocationRecordPath), bytes);
    const testConfig: RelocationConfig = {
      recordPath: issue911RelocationRecordPath,
      recordSha256: createHash("sha256").update(bytes).digest("hex"),
      files: issue911Record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
      totalPairs: 133,
      rejectAllowanceGrowth: true,
      requireStableStructuralAnchor: true,
      requireStableByteOrder: true,
    };
    await expect(runReviewedRelocationRecord(root, fixture, allowances, issue911Observations(), [], testConfig))
      .rejects.toThrow("unchanged stable anchor byte order");
    await expect(applyReviewedIssue911Relocation(root, fixture, allowances, issue911Observations()))
      .rejects.toThrow("reviewed record integrity");
  });

  it.each([runtimeTopologyRelocationRecordPath, editServiceVersionIndexRelocationRecordPath,
    sourceWorkflowRelocationRecordPath, issue911RelocationRecordPath])(
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

  it.each([...new Set([...record.files, ...issue911Record.files].map((section) => section.file))])(
    "rejects current whole-file drift, including each active successor destination: %s", async (file) => {
    const root = await copyProofFixture();
    await writeFile(join(root, file), Buffer.concat([await readFile(join(root, file)), Buffer.from("\n// future edit\n")]));
    await expect(applyReviewedSourceWorkflowRelocation(root, fixture, allowances, discovered)).rejects.toThrow("destination whole-file blob");
    },
  );

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
    expect(removed).toHaveLength(41);
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
