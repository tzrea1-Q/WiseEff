import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  scanParameterCatalogBoundaries,
} from "../check-parameter-catalog-boundaries";
import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import {
  runReviewedRelocationRecord,
  type RuntimeTopologyRelocationRecord,
} from "./runtimeTopologyRelocation";
import {
  applyReviewedIssue913T14Relocation,
  issue913T14ExpectedActiveRelocationCount,
  issue913T14RetiredSourceIds,
  issue913T14ServiceSuccessorRelocationConfig,
  issue913T14ServiceSuccessorRelocationRecordPath,
  issue913T14SuccessorPairCount,
  validateIssue913T14HistoricalPartition,
} from "./issue913T14Relocation";
import {
  applyReviewedIssue913StaleSuccessorRelocation,
  issue913StaleRetiredSourceIds,
  issue913StaleSuccessorPairCount,
  issue913StaleSuccessorRelocationConfig,
  issue913StaleSuccessorRelocationRecordPath,
  validateIssue913StaleHistoricalPartition,
} from "./issue913StaleSuccessorRelocation";
import type { BoundaryViolation } from "./schema";
import { registerIssue903904JointProof } from "./issue903904JointProof.proof";
import { registerT14RewrittenSliceSuccessorRelocationProof } from "./t14RewrittenSliceSuccessorRelocation.proof";
import { registerExactRelocationProof } from "./exactRelocation.proof";
import { registerIssue853CRelocationProof } from "./issue853CRelocation.proof";
import { registerIssue900DashboardRelocationProof } from "./issue900DashboardRelocation.proof";
import { registerRuntimeTopologyRelocationProof } from "./runtimeTopologyRelocation.proof";
import { registerSourceWorkflowRelocationProof } from "./sourceWorkflowRelocation.proof";
import { applyReviewedT14FamilySuccessorRelocation, verifyIssue1015KnowledgeSuccessor } from "./t14FamilySuccessorRelocation";
import { registerT14FamilySuccessorRelocationProof } from "./t14FamilySuccessorRelocation.proof";

const repoRoot = process.cwd();
const repositoryFile = "server/modules/parameter-modules/repository.ts";
const serviceTestFile = "server/modules/parameter-modules/service.test.ts";
const changedFiles = new Set([repositoryFile, serviceTestFile]);
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowances = (await loadAllowlistIndex(repoRoot)).entries;
const historicalRecords = await Promise.all([
  "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/t14-rewritten-slice-successor-relocation.json",
].map(async (path) => JSON.parse(await readFile(join(repoRoot, path), "utf8")) as RuntimeTopologyRelocationRecord));
const historicalChangedSourceIds = historicalRecords.flatMap((record) =>
  record.files.flatMap((section) =>
    changedFiles.has(section.file) ? section.pairs.map((pair) => pair.old.id) : [],
  ),
);
const temporaryRoots: string[] = [];
let discovered: BoundaryViolation[];

beforeAll(async () => {
  discovered = await scanParameterCatalogBoundaries(repoRoot, fixture.trustedBaseSha);
}, 60_000);

afterAll(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

registerT14RewrittenSliceSuccessorRelocationProof(() => discovered);
registerIssue903904JointProof(() => discovered);
registerExactRelocationProof(() => discovered);
registerIssue853CRelocationProof(() => discovered, fixture.trustedBaseSha);
registerIssue900DashboardRelocationProof(() => discovered, fixture.trustedBaseSha);
registerRuntimeTopologyRelocationProof(() => discovered, fixture.trustedBaseSha);
registerSourceWorkflowRelocationProof(() => discovered, fixture.trustedBaseSha);
registerT14FamilySuccessorRelocationProof(() => discovered, fixture.trustedBaseSha);

async function copyServiceProofFixture() {
  const root = await mkdtemp(join(tmpdir(), "issue913-t14-service-"));
  temporaryRoots.push(root);
  for (const file of [issue913T14ServiceSuccessorRelocationRecordPath, serviceTestFile]) {
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

async function copyStaleSuccessorProofFixture() {
  const root = await mkdtemp(join(tmpdir(), "issue913-stale-successor-"));
  temporaryRoots.push(root);
  for (const file of [
    issue913StaleSuccessorRelocationRecordPath,
    ...issue913StaleSuccessorRelocationConfig.files.map(({ file: path }) => path),
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

describe("Issue #913 T1.4 successor relocation", () => {
  it("#1015 retires only nine licensed test sources and preserves every current endpoint", async () => {
    const proof = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
    expect(proof.oldPairs).toHaveLength(13);
    expect(proof.currentPairs).toHaveLength(4);
    expect(proof.retired).toHaveLength(9);
    expect(new Set([...proof.currentPairs, ...proof.retired].map(({ old }) => old.id)))
      .toEqual(new Set(proof.oldPairs.map(({ old }) => old.id)));
    const file = "e2e/acceptance/knowledge.acceptance.spec.ts";
    const current = discovered.filter((entry) => entry.file === file);
    expect(current).toHaveLength(6);
    const activeFiles = [file];
    const apply = (raw: readonly BoundaryViolation[], permissions = allowances) =>
      applyReviewedT14FamilySuccessorRelocation(repoRoot, fixture, permissions, raw, [], activeFiles);
    expect((await apply(discovered)).relocations).toHaveLength(4);
    for (const retired of proof.retired) {
      const original = proof.historicalAllowances.find(({ id }) => id === retired.old.id)!;
      await expect(apply(discovered, [...allowances, original])).rejects.toThrow(/retired allowance revived/);
      await expect(apply([...discovered, retired.new])).rejects.toThrow(/complete six current/);
    }
    for (const changed of [
      discovered.filter(({ id }) => id !== current[0]!.id), [...discovered, current[0]!],
      [...discovered].reverse(),
      discovered.map((entry) => entry.id === current[0]!.id ? { ...entry, id: `${entry.id}-replaced` } : entry),
      discovered.map((entry) => entry.id === current[0]!.id ? { ...entry, byteStart: entry.byteStart + 1 } : entry),
      [...discovered, { ...current[0]!, id: `${current[0]!.id}-new` }],
    ]) await expect(apply(changed)).rejects.toThrow(/relocation rejected|Knowledge successor rejected/);
    for (const endpoint of current.filter((entry) => entry.line < 21)) {
      await expect(apply(discovered, [...allowances, {
        id: endpoint.id, file: endpoint.file, rule: endpoint.rule, reason: endpoint.reason,
      }])).rejects.toThrow(/unallowed GET/);
    }

    const root = await mkdtemp(join(tmpdir(), "issue1015-knowledge-proof-"));
    temporaryRoots.push(root);
    const paths = [file, "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json",
      "scripts/fixtures/parameter-catalog-allowlist/issue-1015-knowledge-current-relocation.json",
      "scripts/parameter-catalog-allowlist/shards/s12-knw.json",
      "e2e/acceptance/knowledge-canonical-definition.acceptance.spec.ts", "e2e/acceptance/requirements.ts",
      "e2e/acceptance/operationMatrix.ts", "server/testing/parameterCatalog/registryProjection.ts",
      "server/testing/parameterCatalog/knowledgeDefinitionLifecycle.test.ts"];
    for (const path of paths) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), await readFile(join(repoRoot, path)));
    }
    await writeFile(join(root, ".git"), `gitdir: ${execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
      cwd: repoRoot, encoding: "utf8",
    }).trim()}\n`);
    const source = await readFile(join(repoRoot, file));
    const old = execFileSync("git", ["show", `5d90785fea95ee436e4e2faccc2be0e0328d3c54:${file}`], { cwd: repoRoot });
    for (const changed of [Buffer.concat([source, old.subarray(7833, 9621)]),
      Buffer.concat([source, old.subarray(53764, 62932)]), Buffer.concat([source, Buffer.from("\n// outside slice\n")]),
      Buffer.from(source.toString().replace("where organization_id = $1 order by id limit 1", "where organization_id <> $1 order by id limit 1"))]) {
      expect(changed.equals(source)).toBe(false);
      await writeFile(join(root, file), changed);
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/whole-file source/);
    }
    await writeFile(join(root, file), source);
    const shardPath = paths[3]!;
    const shard = JSON.parse((await readFile(join(repoRoot, shardPath))).toString());
    for (const entries of [shard.entries.slice(1), [...shard.entries].reverse(),
      [...shard.entries, proof.historicalAllowances.find(({ id }) => id === proof.retired[0]!.old.id)],
      shard.entries.map((entry: { id: string }, index: number) => index === 0 ? { ...entry, id: `${entry.id}-changed` } : entry)]) {
      await writeFile(join(root, shardPath), JSON.stringify({ ...shard, entries }));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/exact shard revocations/);
    }
    await writeFile(join(root, shardPath), await readFile(join(repoRoot, shardPath)));
    for (const path of paths.slice(1, 3)) {
      const original = await readFile(join(repoRoot, path));
      await writeFile(join(root, path), Buffer.concat([original, Buffer.from("\n")]));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/frozen thirteen|pinned current four/);
      await writeFile(join(root, path), original);
    }
    for (const path of paths.slice(4)) {
      const original = await readFile(join(repoRoot, path));
      await writeFile(join(root, path), Buffer.concat([original, Buffer.from("\n// altered scope or lifecycle\n")]));
      await expect(verifyIssue1015KnowledgeSuccessor(root, fixture, allowances)).rejects.toThrow(/fixed canonical required replacement/);
      await writeFile(join(root, path), original);
    }
  });
  it("leaves unrelated synthetic fixtures unchanged", async () => {
    const unrelatedFixture = {
      ...fixture,
      violations: fixture.violations.filter((entry) =>
        !changedFiles.has(entry.file)
        && !issue913StaleSuccessorRelocationConfig.files.some(({ file }) => file === entry.file),
      ),
    };
    const result = await applyReviewedIssue913T14Relocation(
      repoRoot,
      unrelatedFixture,
      [],
      [],
    );
    expect(result).toEqual({ violations: [], relocations: [] });
    await expect(
      applyReviewedIssue913StaleSuccessorRelocation(repoRoot, unrelatedFixture, [], []),
    ).resolves.toEqual({ violations: [], relocations: [] });
  });

  it("activates only the exact 45 successor pairs after proving all old history", async () => {
    const serviceRecord = JSON.parse(
      await readFile(join(repoRoot, issue913T14ServiceSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    for (const pair of serviceRecord.files[0]!.pairs) {
      const candidates = discovered.filter((entry) =>
        entry.file === pair.new.file &&
        entry.line === pair.new.line &&
        entry.token === pair.new.token,
      );
      expect(candidates).toEqual([pair.new]);
    }

    const result = await applyReviewedIssue913T14Relocation(
      repoRoot,
      fixture,
      allowances,
      discovered,
    );
    const changedRelocations = result.relocations.filter((entry) => changedFiles.has(entry.observed.file));

    expect(issue913T14SuccessorPairCount).toBe(45);
    expect(issue913T14ExpectedActiveRelocationCount).toBe(252);
    const knowledge = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
    expect(result.relocations.length + knowledge.retired.length).toBe(252);
    expect(new Set(result.relocations.map((entry) => entry.id)).size + knowledge.retired.length).toBe(252);
    expect(new Set(result.relocations.map((entry) => entry.observed.id)).size + knowledge.retired.length).toBe(252);
    expect(changedRelocations).toHaveLength(45);
    expect(changedRelocations.filter((entry) => entry.observed.file === repositoryFile)).toHaveLength(20);
    expect(changedRelocations.filter((entry) => entry.observed.file === serviceTestFile)).toHaveLength(25);
    expect(issue913T14RetiredSourceIds.every((id) => !result.relocations.some((entry) => entry.id === id))).toBe(true);
    expect(changedRelocations.every((entry) => discovered.some((observation) => observation.id === entry.observed.id))).toBe(true);
  });

  it("rejects a missing retirement, a duplicate source, or an extra residual source", async () => {
    const retired = new Set<string>(issue913T14RetiredSourceIds);
    const activeIds = historicalChangedSourceIds.filter((id) => !retired.has(id));
    validateIssue913T14HistoricalPartition(historicalChangedSourceIds, activeIds);

    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds.filter((id) => id !== issue913T14RetiredSourceIds[0]),
        activeIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913T14HistoricalPartition(historicalChangedSourceIds, [...activeIds, activeIds[0]!]),
    ).toThrow("successor source inventory");
    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds,
        [...activeIds.slice(1), issue913T14RetiredSourceIds[0]!],
      ),
    ).toThrow("successor source partition");
    expect(() =>
      validateIssue913T14HistoricalPartition(
        historicalChangedSourceIds,
        [...activeIds.slice(1), "S12-MOD:unmapped-residual"],
      ),
    ).toThrow("successor source partition");
    const retiredBaseline = fixture.violations.find((entry) => entry.id === issue913T14RetiredSourceIds[0]);
    expect(retiredBaseline).toBeDefined();
    await expect(
      applyReviewedIssue913T14Relocation(
        repoRoot,
        fixture,
        [...allowances, {
          id: retiredBaseline!.id,
          rule: retiredBaseline!.rule,
          file: retiredBaseline!.file,
          reason: retiredBaseline!.reason,
        }],
        discovered,
      ),
    ).rejects.toThrow("retired sources remain allowlisted");
  });

  it("rejects swapping identical-text service endpoints under the fixed record digest", async () => {
    const root = await copyServiceProofFixture();
    const recordPath = join(root, issue913T14ServiceSuccessorRelocationRecordPath);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RuntimeTopologyRelocationRecord;
    const pairs = record.files[0]!.pairs;
    const first = pairs.findIndex((pair) => pair.old.line === 74 && pair.old.token === "read:parameter_modules");
    const second = pairs.findIndex((pair) => pair.old.line === 382 && pair.old.token === "read:parameter_modules");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(pairs[first]!.new.evidence).toBe(pairs[second]!.new.evidence);
    expect(pairs[first]!.new.token).toBe(pairs[second]!.new.token);
    [pairs[first]!.new, pairs[second]!.new] = [pairs[second]!.new, pairs[first]!.new];
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913T14ServiceSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("reviewed record integrity");
  });

  it("rejects whole-file blob drift before applying a service successor", async () => {
    const root = await copyServiceProofFixture();
    const servicePath = join(root, serviceTestFile);
    const service = await readFile(servicePath);
    service[0] = service[0]! ^ 1;
    await writeFile(servicePath, service);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913T14ServiceSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("destination whole-file blob");
  });

  it("partitions the exact 63 stale successors and named 17 retirements", async () => {
    const record = JSON.parse(
      await readFile(join(repoRoot, issue913StaleSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    const successorSourceIds = record.files.flatMap((section) => section.pairs.map((pair) => pair.old.id));
    const historicalSourceIds = [...successorSourceIds, ...issue913StaleRetiredSourceIds];

    expect(issue913StaleSuccessorPairCount).toBe(63);
    expect(new Set(successorSourceIds).size).toBe(63);
    expect(issue913StaleRetiredSourceIds.every((id) => !allowances.some((entry) => entry.id === id))).toBe(true);
    // The fixed record and partition prove #913 history; the owner-path test owns current inventory.
    validateIssue913StaleHistoricalPartition(historicalSourceIds, successorSourceIds);
  });

  it("rejects an incomplete historical partition and same-text endpoint reorder", async () => {
    const fixedRecord = JSON.parse(
      await readFile(join(repoRoot, issue913StaleSuccessorRelocationRecordPath), "utf8"),
    ) as RuntimeTopologyRelocationRecord;
    const successorSourceIds = fixedRecord.files.flatMap((section) => section.pairs.map((pair) => pair.old.id));
    const historicalSourceIds = [...successorSourceIds, ...issue913StaleRetiredSourceIds];
    validateIssue913StaleHistoricalPartition(historicalSourceIds, successorSourceIds);

    expect(() =>
      validateIssue913StaleHistoricalPartition(
        historicalSourceIds.filter((id) => id !== issue913StaleRetiredSourceIds[0]),
        successorSourceIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913StaleHistoricalPartition(
        [...historicalSourceIds, "S12-MOD:legacy-parameter-spec-identifier:unreviewed:residual"],
        successorSourceIds,
      ),
    ).toThrow("historical source inventory");
    expect(() =>
      validateIssue913StaleHistoricalPartition(
        historicalSourceIds,
        [...successorSourceIds.slice(1), issue913StaleRetiredSourceIds[0]!],
      ),
    ).toThrow("successor source partition");

    const root = await copyStaleSuccessorProofFixture();
    const recordPath = join(root, issue913StaleSuccessorRelocationRecordPath);
    const record = JSON.parse(await readFile(recordPath, "utf8")) as RuntimeTopologyRelocationRecord;
    const service = record.files.find((section) => section.file === "server/modules/parameter-modules/service.ts")!;
    const duplicateAnchor = "S12-MOD:legacy-parameter-spec-identifier:420ee39a001dbcaa";
    const duplicates = service.pairs.filter((pair) => pair.old.id.startsWith(`${duplicateAnchor}:`));
    expect(duplicates).toHaveLength(2);
    expect(duplicates.map((pair) => pair.old.line)).toEqual([201, 388]);
    [duplicates[0]!.new, duplicates[1]!.new] = [duplicates[1]!.new, duplicates[0]!.new];
    const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
    await writeFile(recordPath, bytes);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        {
          ...issue913StaleSuccessorRelocationConfig,
          recordSha256: createHash("sha256").update(bytes).digest("hex"),
        },
      ),
    ).rejects.toThrow("unchanged stable anchor byte order");
  });

  it("rejects a changed whole-file destination blob", async () => {
    const root = await copyStaleSuccessorProofFixture();
    const serviceFile = "server/modules/parameter-modules/service.ts";
    const servicePath = join(root, serviceFile);
    const service = await readFile(servicePath);
    service[0] = service[0]! ^ 1;
    await writeFile(servicePath, service);

    await expect(
      runReviewedRelocationRecord(
        root,
        fixture,
        allowances,
        discovered,
        [],
        issue913StaleSuccessorRelocationConfig,
      ),
    ).rejects.toThrow("destination whole-file blob");
  });
});
