import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  verifyHistoricalRelocationProof,
  type RelocationConfig,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";
import { t14FamilySuccessorRelocationConfig } from "./t14FamilySuccessorRelocation";
import { t14RewrittenSliceSuccessorRelocationConfig } from "./t14RewrittenSliceSuccessorRelocation";

const repositoryFile = "server/modules/parameter-modules/repository.ts";
const serviceTestFile = "server/modules/parameter-modules/service.test.ts";

export const issue913T14SuccessorPairCount = 45;
export const issue913T14ExpectedActiveRelocationCount = 318;
export const issue913T14RetiredSourceIds = [
  "S12-MOD:legacy-catalog-table-name:860a2404dfe5c6b4:8cd263657607ec3e",
  "S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:7d4a0c6f2bb42f1c",
  "S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:95f694f205d9301b",
  "S12-MOD:legacy-parameter-spec-identifier:59ee771a428f0978:0302adf87a58e40f",
] as const;

export const issue913T14SuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-successor-relocation.json";
export const issue913T14RewrittenRepositorySuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-rewritten-repo-successor-relocation.json";
export const issue913T14ServiceSuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-913-t14-service-successor-relocation.json";

const changedFiles = [repositoryFile, serviceTestFile] as const;
const changedFileSet = new Set<string>(changedFiles);
const retiredSourceIdSet = new Set<string>(issue913T14RetiredSourceIds);
const history = {
  commit: "097ad35625cc8ca2401f2cd028404f16a18a75ba",
  tree: "74b3df3635590d34738896e550e31eb9c8db0948",
};

/** Family repository occurrences preserve their exact historical bytes, metadata, and order. */
export const issue913T14RepositorySuccessorRelocationConfig: RelocationConfig = {
  recordPath: issue913T14SuccessorRelocationRecordPath,
  recordSha256: "a0f5d0caa2b6e5248441f8843a53c1143ac96d62227221775ae5d471ab308a0b",
  files: [{ file: repositoryFile, pairs: 13 }],
  totalPairs: 13,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

/** The seven reviewed rewritten-slice pairs retain anchor, byte order, and both endpoint digests. */
export const issue913T14RewrittenRepositorySuccessorRelocationConfig: RelocationConfig = {
  recordPath: issue913T14RewrittenRepositorySuccessorRelocationRecordPath,
  recordSha256: "947ed35426467b1aadd1f7dc634830f20748d0163448a5421e0c4b0ed424a4d4",
  files: [{ file: repositoryFile, pairs: 7 }],
  totalPairs: 7,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
  requireIdenticalSlice: false,
  requireUnchangedEvidence: false,
};

/**
 * Current service-test text and evidence are identical; only byte order is relaxed because
 * three reviewed same-anchor groups were reordered by the source rewrite.
 */
export const issue913T14ServiceSuccessorRelocationConfig: RelocationConfig = {
  recordPath: issue913T14ServiceSuccessorRelocationRecordPath,
  recordSha256: "ed511587dcca81969d4ebbefbe8ef043f36daedf8e8de0edf0c02c6ed9fa8077",
  files: [{ file: serviceTestFile, pairs: 25 }],
  totalPairs: 25,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
};

/** Verify complete history first; only then activate untouched old files and 45 fixed successors. */
export async function applyReviewedIssue913T14Relocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
): Promise<RelocationOutcome> {
  if (!fixture.violations.some((violation) => changedFileSet.has(violation.file))) {
    return { violations: [...discovered], relocations: [] };
  }

  requireT14(
    issue913T14RetiredSourceIds.every((id) => !allowances.some((entry) => entry.id === id)),
    "retired sources remain allowlisted",
  );
  requireT14(
    issue913T14RetiredSourceIds.every((id) => !discovered.some((entry) => entry.id === id)),
    "retired source reappeared in the current scan",
  );

  const historicalAllowances = withRetiredHistoricalAllowances(fixture, allowances);
  const [familyProof, rewrittenProof] = await Promise.all([
    verifyHistoricalRelocationProof(
      repoRoot,
      fixture,
      historicalAllowances,
      t14FamilySuccessorRelocationConfig,
      history,
    ),
    verifyHistoricalRelocationProof(
      repoRoot,
      fixture,
      historicalAllowances,
      t14RewrittenSliceSuccessorRelocationConfig,
      history,
    ),
  ]);

  const family = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    {
      ...t14FamilySuccessorRelocationConfig,
      activeFiles: activeUnchangedFiles(t14FamilySuccessorRelocationConfig),
    },
  );
  requireT14(family.relocations.length === 228, "active family historical subset");

  const familyAndPrior = [...existingRelocations, ...family.relocations];
  const rewritten = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    family.violations,
    familyAndPrior,
    {
      ...t14RewrittenSliceSuccessorRelocationConfig,
      activeFiles: activeUnchangedFiles(t14RewrittenSliceSuccessorRelocationConfig),
    },
  );
  requireT14(rewritten.relocations.length === 45, "active rewritten historical subset");

  const familyChangedPairs = familyProof.pairs.filter((pair) => changedFileSet.has(pair.old.file));
  const rewrittenChangedPairs = rewrittenProof.pairs.filter((pair) => changedFileSet.has(pair.old.file));
  const expectedRepositoryFamily = activeHistoricalSourceIds(familyChangedPairs, repositoryFile);
  const expectedRepositoryRewrite = activeHistoricalSourceIds(rewrittenChangedPairs, repositoryFile);
  const expectedService = [
    ...activeHistoricalSourceIds(familyChangedPairs, serviceTestFile),
    ...activeHistoricalSourceIds(rewrittenChangedPairs, serviceTestFile),
  ];

  const prior = [...familyAndPrior, ...rewritten.relocations];
  const repositoryFamily = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    rewritten.violations,
    prior,
    issue913T14RepositorySuccessorRelocationConfig,
  );
  requireExactSourceIds(
    repositoryFamily.relocations.map((entry) => entry.id),
    expectedRepositoryFamily,
    "family repository source partition",
  );

  const priorAndRepositoryFamily = [...prior, ...repositoryFamily.relocations];
  const repositoryRewrite = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    repositoryFamily.violations,
    priorAndRepositoryFamily,
    issue913T14RewrittenRepositorySuccessorRelocationConfig,
  );
  requireExactSourceIds(
    repositoryRewrite.relocations.map((entry) => entry.id),
    expectedRepositoryRewrite,
    "rewritten repository source partition",
  );

  const priorAndRepositories = [...priorAndRepositoryFamily, ...repositoryRewrite.relocations];
  const service = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    repositoryRewrite.violations,
    priorAndRepositories,
    issue913T14ServiceSuccessorRelocationConfig,
  );
  requireExactSourceIds(
    service.relocations.map((entry) => entry.id),
    expectedService,
    "service-test source partition",
  );

  const successorRelocations = [
    ...repositoryFamily.relocations,
    ...repositoryRewrite.relocations,
    ...service.relocations,
  ];
  validateIssue913T14HistoricalPartition(
    [...familyChangedPairs, ...rewrittenChangedPairs].map((pair) => pair.old.id),
    successorRelocations.map((entry) => entry.id),
  );

  const relocations = [
    ...family.relocations,
    ...rewritten.relocations,
    ...successorRelocations,
  ];
  requireT14(
    relocations.length === issue913T14ExpectedActiveRelocationCount,
    "complete active relocation inventory",
  );
  return { violations: service.violations, relocations };
}

/** The historical 49 sources must be exactly the active 45 plus the four named retirements. */
export function validateIssue913T14HistoricalPartition(
  historicalSourceIds: readonly string[],
  successorSourceIds: readonly string[],
) {
  const historical = new Set(historicalSourceIds);
  const successor = new Set(successorSourceIds);
  const retired = retiredSourceIdSet;
  requireT14(
    historical.size === historicalSourceIds.length && historical.size === 49,
    "historical source inventory",
  );
  requireT14(
    successor.size === successorSourceIds.length && successor.size === issue913T14SuccessorPairCount,
    "successor source inventory",
  );
  requireT14([...retired].every((id) => historical.has(id)), "retired source inventory");
  requireT14(
    [...successor].every((id) => historical.has(id) && !retired.has(id)),
    "successor source partition",
  );
  const partition = new Set([...successor, ...retired]);
  requireT14(
    partition.size === historical.size && [...historical].every((id) => partition.has(id)),
    "retired source partition",
  );
}

function activeHistoricalSourceIds(
  pairs: readonly { old: BoundaryViolation }[],
  file: string,
) {
  return pairs
    .filter((pair) => pair.old.file === file && !retiredSourceIdSet.has(pair.old.id))
    .map((pair) => pair.old.id);
}

function requireExactSourceIds(
  actualIds: readonly string[],
  expectedIds: readonly string[],
  invariant: string,
) {
  const actual = new Set(actualIds);
  const expected = new Set(expectedIds);
  requireT14(
    actual.size === actualIds.length
      && expected.size === expectedIds.length
      && actual.size === expected.size
      && [...expected].every((id) => actual.has(id)),
    invariant,
  );
}

function activeUnchangedFiles(config: RelocationConfig) {
  return config.files.map(({ file }) => file).filter((file) => !changedFileSet.has(file));
}

function withRetiredHistoricalAllowances(
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
) {
  const historical = [...allowances];
  for (const id of issue913T14RetiredSourceIds) {
    const baseline = fixture.violations.find((entry) => entry.id === id);
    requireT14(baseline !== undefined, "retired source missing from historical fixture");
    historical.push({ id, rule: baseline.rule, file: baseline.file, reason: baseline.reason });
  }
  return historical;
}

function requireT14(matches: boolean, invariant: string): asserts matches {
  if (!matches) throw new Error(`Issue #913 T1.4 relocation rejected: ${invariant}.`);
}
