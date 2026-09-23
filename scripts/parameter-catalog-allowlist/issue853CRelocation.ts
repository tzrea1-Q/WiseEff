import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

const actionFile = "server/modules/agent/tools/actionTools.ts";
const routesFile = "server/modules/debugging/routes.ts";
const catalogSplitFile = "server/modules/debugging/catalogSplitRepository.ts";
const repositoryFile = "server/modules/debugging/repository.ts";

export const issue853CActionRetiredSourceIds = [
  "S12-AGT:legacy-parameter-spec-identifier:41333e6758b504a7:2352cd7afd8496cb",
  "S12-AGT:legacy-parameter-spec-identifier:f98934aa45a45cf4:3545c2d3303cc20c",
] as const;

const routesConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-debug-routes-successor.json",
  recordSha256: "2e4ad2e31562c4f56a307521b85df6fe7612996227e529a53682551ecac794e9",
  files: [{ file: routesFile, pairs: 2 }],
  totalPairs: 2,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const catalogSplitConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-debug-catalog-split-successor.json",
  recordSha256: "8462728c72250498a84a57b0abc86f2f0d90a8a0d3e7297e429ab21d5b05c4f6",
  files: [{ file: catalogSplitFile, pairs: 4 }],
  totalPairs: 4,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const repositoryConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-debug-repository-successor.json",
  recordSha256: "4f8480cec35e29db41b426a422a64f07e113f86462d225333861b27cda16b1eb",
  files: [{ file: repositoryFile, pairs: 9 }],
  totalPairs: 9,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const rewrittenRepositoryConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-debug-repository-rewritten-successor.json",
  recordSha256: "b80e103079926f33719e789a733738385a8d1c6913251a3203c28c64efc3fea9",
  files: [{ file: repositoryFile, pairs: 1 }],
  totalPairs: 1,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
  requireIdenticalSlice: false,
};

export async function verifyIssue853CActionRetirement(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  const oldIds = fixture.violations.filter((entry) => entry.file === actionFile).map((entry) => entry.id);
  const retired = new Set<string>(issue853CActionRetiredSourceIds);
  if (
    oldIds.length !== retired.size
    || oldIds.some((id) => !retired.has(id))
    || allowances.some((entry) => retired.has(entry.id))
    || discovered.some((entry) => entry.file === actionFile)
  ) throw new Error("Issue #853 C action retirement rejected: exact 2-to-0 partition.");
  const bytes = await readFile(resolve(repoRoot, actionFile));
  const blob = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (blob !== "57c5e95d02a64ee3ff2bc310e003ea2d4ab0e190") {
    throw new Error("Issue #853 C action retirement rejected: target whole-file blob.");
  }
}

export function applyReviewedIssue853CRouteRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  prior: readonly RuntimeTopologyRelocation[],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, prior, routesConfig);
}

export function applyReviewedIssue853CCatalogSplitRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  prior: readonly RuntimeTopologyRelocation[],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, prior, catalogSplitConfig);
}

export async function applyReviewedIssue853CRepositoryRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  prior: readonly RuntimeTopologyRelocation[],
) {
  const exact = await runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, prior, repositoryConfig);
  const rewritten = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, exact.violations, [...prior, ...exact.relocations], rewrittenRepositoryConfig,
  );
  return { violations: rewritten.violations, relocations: [...exact.relocations, ...rewritten.relocations] };
}
