import { isDeepStrictEqual } from "node:util";
import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  verifyHistoricalRelocationProof,
  verifyHistoricalRuntimeTopologyRelocation,
  type RelocationConfig,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";
import { verifyHistoricalEditServiceVersionIndexRelocation } from "./editServiceVersionIndexRelocation";

export const sourceWorkflowRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json";
export const sourceWorkflowConsumerRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json";
export const issue911RelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-911-boundary-successor-relocation.json";

const sourceWorkflowMainProvenance = {
  commit: "47a67562df2920d804ea6ca0f27b84e024ff2ac4",
  tree: "3ff4fd6a2a1a212465b9eeea92df86f3c6b09312",
} as const;

// Keep the fixed #849/#853 records intact; their changed-file aliases are proof-only.
const sourceWorkflowConfig: RelocationConfig = {
  recordPath: sourceWorkflowRelocationRecordPath,
  recordSha256: "b998321716d00d58ea83b03cd283a52bafb40ac40437549ee453e7153c83742c",
  files: [
    { file: "server/modules/parameter-topology/ingestService.ts", pairs: 20 },
    { file: "server/modules/parameter-topology/schemas.ts", pairs: 3 },
    { file: "server/modules/parameter-topology/editService.ts", pairs: 26 },
    { file: "server/modules/parameter-topology/editService.test.ts", pairs: 28 },
    { file: "server/modules/parameter-topology/overlayWriteback.ts", pairs: 5 },
  ],
  totalPairs: 82,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

// This full 237-pair record is proved at the fixed main tree. Only unchanged files stay active.
const consumerConfig: RelocationConfig = {
  recordPath: sourceWorkflowConsumerRelocationRecordPath,
  recordSha256: "97f3190a80d0800fac88b6d3d5b60897ed24312ef056bdc59e2099dfa6e712a9",
  files: [
    { file: "e2e/acceptance/parameter-files.acceptance.spec.ts", pairs: 2 },
    { file: "e2e/acceptance/parameter-import-wizard.acceptance.spec.ts", pairs: 2 },
    { file: "e2e/acceptance/parameter-topology.acceptance.spec.ts", pairs: 82 },
    { file: "server/modules/parameter-files/writebackService.ts", pairs: 14 },
    { file: "server/modules/parameter-topology/repository.ts", pairs: 1 },
    { file: "server/modules/parameters/importBatchRepository.ts", pairs: 16 },
    { file: "server/modules/parameters/service.ts", pairs: 29 },
    { file: "src/application/ports/ParameterTopologyRepository.ts", pairs: 1 },
    { file: "src/infrastructure/http/parameterTopologyClient.test.ts", pairs: 22 },
    { file: "src/infrastructure/http/parameterTopologyClient.ts", pairs: 32 },
    { file: "server/modules/parameter-drafts/repository.test.ts", pairs: 2 },
    { file: "server/modules/parameter-drafts/repository.ts", pairs: 2 },
    { file: "server/modules/parameters/reviewWorkflowRepository.ts", pairs: 30 },
    { file: "src/application/ports/ParameterRepository.ts", pairs: 2 },
  ],
  totalPairs: 237,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const issue911Config: RelocationConfig = {
  recordPath: issue911RelocationRecordPath,
  recordSha256: "f187dc3f6ed3ea56cc81e915c6686a3ec0c7d52eb1031c380968ec4a93d3ef49",
  files: [
    { file: "server/modules/parameter-topology/schemas.ts", pairs: 3 },
    { file: "src/infrastructure/http/parameterTopologyClient.test.ts", pairs: 24 },
    { file: "src/infrastructure/http/parameterTopologyClient.ts", pairs: 32 },
    { file: "server/modules/parameter-topology/bindingService.ts", pairs: 58 },
    { file: "server/modules/parameter-topology/service.ts", pairs: 14 },
    { file: "server/modules/parameter-topology/service.test.ts", pairs: 2 },
  ],
  totalPairs: 133,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const sourceWorkflowActiveFiles = sourceWorkflowConfig.files
  .map(({ file }) => file)
  .filter((file) => file !== "server/modules/parameter-topology/schemas.ts");
const sourceWorkflowConsumerActiveFiles = consumerConfig.files
  .map(({ file }) => file)
  .filter((file) => file !== "src/infrastructure/http/parameterTopologyClient.test.ts"
    && file !== "src/infrastructure/http/parameterTopologyClient.ts");

export function verifyHistoricalSourceWorkflowRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
) {
  return verifyHistoricalRelocationProof(repoRoot, fixture, allowances, sourceWorkflowConfig, sourceWorkflowMainProvenance);
}

export function verifyHistoricalSourceWorkflowConsumerRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
) {
  return verifyHistoricalRelocationProof(repoRoot, fixture, allowances, consumerConfig, sourceWorkflowMainProvenance);
}

export async function applyReviewedIssue911Relocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, issue911Config);
}

export async function applyReviewedSourceWorkflowConsumerRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  if (!fixture.violations.some((entry) => consumerConfig.files.some(({ file }) => entry.file === file))) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }
  const history = await verifyHistoricalSourceWorkflowConsumerRelocation(repoRoot, fixture, allowances);
  const current = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    { ...consumerConfig, activeFiles: sourceWorkflowConsumerActiveFiles },
  );
  const ids = new Set([...existingRelocations, ...current.relocations].map((entry) => entry.id));
  const boundById = new Map(current.violations.map((entry) => [entry.id, entry]));
  if (history.pairs.some((pair) => !ids.has(pair.old.id)
    || !isDeepStrictEqual(boundById.get(pair.old.id), pair.old))) {
    throw new Error("Source workflow consumer relocation rejected: incomplete historical successor coverage.");
  }
  return current;
}

export async function applyReviewedSourceWorkflowRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  if (!fixture.violations.some((entry) => sourceWorkflowConfig.files.some(({ file }) => entry.file === file))) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }
  const runtime = await verifyHistoricalRuntimeTopologyRelocation(repoRoot, fixture, allowances);
  const edit = await verifyHistoricalEditServiceVersionIndexRelocation(repoRoot, fixture, allowances);
  const history = [...runtime.pairs, ...edit.pairs];
  if (new Set(history.map((pair) => pair.old.id)).size !== 75) {
    throw new Error("Source workflow relocation rejected: historical source inventory.");
  }

  const historical = await verifyHistoricalSourceWorkflowRelocation(repoRoot, fixture, allowances);
  const current = await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    { ...sourceWorkflowConfig, activeFiles: sourceWorkflowActiveFiles },
  );
  const successor = await applyReviewedIssue911Relocation(
    repoRoot,
    fixture,
    allowances,
    current.violations,
    [...existingRelocations, ...current.relocations],
  );
  const relocations = [...current.relocations, ...successor.relocations];
  const activeIds = new Set(relocations.map((entry) => entry.id));
  const boundById = new Map(successor.violations.map((entry) => [entry.id, entry]));
  const historicIds = new Map<string, BoundaryViolation>();
  for (const pair of [...history, ...historical.pairs]) historicIds.set(pair.old.id, pair.old);
  if (historicIds.size !== 82 || [...historicIds].some(([id, old]) =>
    !activeIds.has(id) || !isDeepStrictEqual(boundById.get(id), old))) {
    throw new Error("Source workflow relocation rejected: incomplete historical successor coverage.");
  }
  return { violations: successor.violations, relocations };
}
