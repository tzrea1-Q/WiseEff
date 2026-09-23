import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
  type RuntimeTopologyRelocationRecord,
} from "./runtimeTopologyRelocation";

export const issue913StaleSuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-913-stale-successor-relocation.json";
export const issue913StaleSuccessorPairCount = 63;
export const issue913StaleHistoricalSourceCount = 80;

export const issue913StaleRetiredSourceIds = [
  "S12-MOD:legacy-catalog-raw-read:e568f290277114b2:824c43b03e040dd5",
  "S12-MOD:legacy-catalog-table-name:605c0eea941cb6bd:f9ec9ef3bd4f57e8",
  "S12-MOD:legacy-parameter-spec-identifier:0609d6dfbd359db9:3c3da7357cffb3cf",
  "S12-MOD:legacy-parameter-spec-identifier:2fb8a45d4f27a45f:3e3da5cb0e291b75",
  "S12-MOD:legacy-parameter-spec-identifier:3e21583dc68cea78:01831520ddad6795",
  "S12-MOD:legacy-parameter-spec-identifier:89937479f23f9d0d:0d7583dd87aa8f20",
  "S12-MOD:legacy-parameter-spec-identifier:89937479f23f9d0d:1cba32e2c1acc16a",
  "S12-MOD:legacy-parameter-spec-identifier:89937479f23f9d0d:255bd52fc6b04d76",
  "S12-MOD:legacy-parameter-spec-identifier:89937479f23f9d0d:28f3dd1f254bae08",
  "S12-MOD:legacy-parameter-spec-identifier:89937479f23f9d0d:cf5aacc3dea13514",
  "S12-MOD:legacy-parameter-spec-identifier:8edfc265a611a420:ac7c6e5c7763fdc0",
  "S12-MOD:legacy-parameter-spec-identifier:9337aefc001c2026:9e2c123835d1b06c",
  "S12-MOD:legacy-parameter-spec-identifier:9337aefc001c2026:be4de36eca41b746",
  "S12-MOD:legacy-parameter-spec-identifier:9337aefc001c2026:fc11f688aa52ec03",
  "S12-MOD:legacy-parameter-spec-identifier:a7c30addd75f33d6:e602570fdccdecd0",
  "S12-PRJ:legacy-catalog-raw-read:613007d0d70a4003:0a30c88b9f209be9",
  "S12-PRJ:unresolved-boundary-expression:64a8d2cbafc6a08a:347f2ea33343631c",
] as const;

const retiredSourceIdSet = new Set<string>(issue913StaleRetiredSourceIds);
const staleSuccessorFiles = [
  "server/modules/parameter-modules/driverRegistryQuery.test.ts",
  "server/modules/parameter-modules/repository.ts",
  "server/modules/parameter-modules/service.ts",
  "server/modules/parameters/parameterModuleRepository.test.ts",
  "server/modules/parameters/parameterModuleRepository.ts",
] as const;

export const issue913StaleSuccessorRelocationConfig: RelocationConfig = {
  recordPath: issue913StaleSuccessorRelocationRecordPath,
  recordSha256: "6051c3bddfe35eae74d38f01c05661a3353bb330bdbe921f02cbfdf7eb95c2d3",
  files: [
    { file: staleSuccessorFiles[0], pairs: 1 },
    { file: staleSuccessorFiles[1], pairs: 14 },
    { file: staleSuccessorFiles[2], pairs: 18 },
    { file: staleSuccessorFiles[3], pairs: 8 },
    { file: staleSuccessorFiles[4], pairs: 22 },
  ],
  totalPairs: issue913StaleSuccessorPairCount,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

/** Apply the exact stale allowance successors after the caller's prior relocation aliases. */
export async function applyReviewedIssue913StaleSuccessorRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  priorRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  if (!fixture.violations.some((violation) => staleSuccessorFiles.includes(violation.file as (typeof staleSuccessorFiles)[number]))) {
    return { violations: [...discovered], relocations: [] };
  }

  const recordBytes = await readFile(resolve(repoRoot, issue913StaleSuccessorRelocationRecordPath));
  requireStale(
    createHash("sha256").update(recordBytes).digest("hex") === issue913StaleSuccessorRelocationConfig.recordSha256,
    "reviewed record integrity",
  );
  const record = JSON.parse(recordBytes.toString("utf8")) as RuntimeTopologyRelocationRecord;
  const successorSourceIds = record.files.flatMap((section) => section.pairs.map((pair) => pair.old.id));
  const historicalSourceIds = [...successorSourceIds, ...issue913StaleRetiredSourceIds];
  validateIssue913StaleHistoricalPartition(historicalSourceIds, successorSourceIds);

  const discoveredIds = new Set(discovered.map((entry) => entry.id));
  const priorSourceIds = new Set(priorRelocations.map((entry) => entry.id));
  const allowanceSourceIds = allowances
    .filter((entry) => staleSuccessorFiles.includes(entry.file as (typeof staleSuccessorFiles)[number]))
    .filter((entry) => !discoveredIds.has(entry.id) && !priorSourceIds.has(entry.id))
    .map((entry) => entry.id);
  requireExactIds(allowanceSourceIds, successorSourceIds, "complete active stale source inventory");

  const baselineIds = new Set(fixture.violations.map((entry) => entry.id));
  const allowanceIds = new Set(allowances.map((entry) => entry.id));
  for (const id of issue913StaleRetiredSourceIds) {
    requireStale(baselineIds.has(id), "retired source missing from historical fixture");
    requireStale(!allowanceIds.has(id), "retired source remains allowlisted");
    requireStale(!discoveredIds.has(id), "retired source reappeared in current scan");
  }

  const result = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    priorRelocations,
    issue913StaleSuccessorRelocationConfig,
  );
  requireStale(result.relocations.length === issue913StaleSuccessorPairCount, "active successor count");
  requireExactIds(
    result.relocations.map((entry) => entry.id),
    successorSourceIds,
    "complete successor source partition",
  );
  return result;
}

/** The fixed 80 historical sources partition into 63 active successors and 17 named retirements. */
export function validateIssue913StaleHistoricalPartition(
  historicalSourceIds: readonly string[],
  successorSourceIds: readonly string[],
) {
  const historical = new Set(historicalSourceIds);
  const successors = new Set(successorSourceIds);
  const retired = retiredSourceIdSet;
  requireStale(
    historical.size === historicalSourceIds.length && historical.size === issue913StaleHistoricalSourceCount,
    "historical source inventory",
  );
  requireStale(
    successors.size === successorSourceIds.length && successors.size === issue913StaleSuccessorPairCount,
    "successor source inventory",
  );
  requireStale([...retired].every((id) => historical.has(id)), "retired source inventory");
  requireStale(
    [...successors].every((id) => historical.has(id) && !retired.has(id)),
    "successor source partition",
  );
  const partition = new Set([...successors, ...retired]);
  requireStale(
    partition.size === historical.size && [...historical].every((id) => partition.has(id)),
    "retired source partition",
  );
}

function requireExactIds(actualIds: readonly string[], expectedIds: readonly string[], invariant: string) {
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  requireStale(
    actual.size === actualIds.length
      && expected.size === expectedIds.length
      && actual.size === expected.size
      && [...expected].every((id) => actual.has(id)),
    invariant,
  );
}

function requireStale(matches: boolean, invariant: string): asserts matches {
  if (!matches) throw new Error(`Issue #913 stale successor relocation rejected: ${invariant}.`);
}
