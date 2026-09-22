import { isDeepStrictEqual } from "node:util";
import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord, verifyHistoricalRuntimeTopologyRelocation,
  type RelocationConfig, type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";
import { verifyHistoricalEditServiceVersionIndexRelocation } from "./editServiceVersionIndexRelocation";

export const sourceWorkflowRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json";
export const sourceWorkflowConsumerRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json";

// Separate exact data approved by both design reviewers; no historical aliases.
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

export async function applyReviewedSourceWorkflowConsumerRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, consumerConfig);
}

// Exact 82-pair data independently approved by Spec and Standards for #849/#853.
const config: RelocationConfig = {
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

export async function applyReviewedSourceWorkflowRelocation(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  if (!fixture.violations.some((entry) => config.files.some(({ file }) => entry.file === file))) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }
  const runtime = await verifyHistoricalRuntimeTopologyRelocation(repoRoot, fixture, allowances);
  const edit = await verifyHistoricalEditServiceVersionIndexRelocation(repoRoot, fixture, allowances);
  const history = [...runtime.pairs, ...edit.pairs];
  if (new Set(history.map((pair) => pair.old.id)).size !== 75) {
    throw new Error("Source workflow relocation rejected: historical source inventory.");
  }
  const result = await runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, config);
  const activeIds = new Set(result.relocations.map((entry) => entry.id));
  const boundById = new Map(result.violations.map((entry) => [entry.id, entry]));
  if (history.some((pair) => !activeIds.has(pair.old.id) || !isDeepStrictEqual(boundById.get(pair.old.id), pair.old))) {
    throw new Error("Source workflow relocation rejected: incomplete historical successor coverage.");
  }
  return result;
}
