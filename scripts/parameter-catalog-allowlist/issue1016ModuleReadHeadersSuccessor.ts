import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import { isDeepStrictEqual } from "node:util";
import { runReviewedRelocationRecord, type RelocationConfig,
  type RuntimeTopologyRelocation } from "./runtimeTopologyRelocation";

export const issue1016ModuleRoutesFile = "server/modules/parameter-modules/routes.ts";
export const issue1016ModuleReadHeadersSuccessorConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-1016-module-read-headers-successor.json",
  recordSha256: "56b6e1daf9c58a34bc52a4a8eb1889d6116772cea55269994a56236ec104e46f",
  files: [{ file: issue1016ModuleRoutesFile, pairs: 13 }], totalPairs: 13,
  rejectAllowanceGrowth: true, requireStableStructuralAnchor: true, requireStableByteOrder: true,
};

/** Current header-only successors retain all thirteen original live route permissions. */
export async function applyReviewedIssue1016ModuleReadHeadersSuccessor(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[], existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  const result = await runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations,
    issue1016ModuleReadHeadersSuccessorConfig);
  const watched = discovered.filter(({ file }) => file === issue1016ModuleRoutesFile);
  const order = (a: BoundaryViolation, b: BoundaryViolation) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (!isDeepStrictEqual(watched, [...watched].sort(order))
    || !isDeepStrictEqual(result.violations.filter(({ file }) => file === issue1016ModuleRoutesFile).sort(order),
      fixture.violations.filter(({ file }) => file === issue1016ModuleRoutesFile).sort(order))) {
    throw new Error("Issue #1016 Module successor rejected: complete current source inventory and order.");
  }
  return result;
}

/** Strip only this verified current alias partition for the preceding A043 historical stage. */
export async function historicalIssue1016ModuleReport(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  report: Awaited<ReturnType<typeof import("../check-parameter-catalog-boundaries").checkParameterCatalogBoundaries>>,
) {
  const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const aliases = report.relocations.filter(({ observed }) => observed.file === issue1016ModuleRoutesFile);
  const bySource = new Map(aliases.map((entry) => [entry.id, entry.observed]));
  const raw = report.violations.map((entry) => bySource.get(entry.id) ?? entry).sort(order);
  const checked = await applyReviewedIssue1016ModuleReadHeadersSuccessor(repoRoot, fixture, allowances, raw);
  const unallowed = new Set(report.unallowlisted.map(({ id }) => id));
  const permissions = report.violations.filter(({ id }) => !unallowed.has(id))
    .map(({ id, file, rule, reason }) => ({ id, file, rule, reason })).sort(order);
  if (!isDeepStrictEqual(aliases, checked.relocations)
    || !isDeepStrictEqual(report.violations.filter(({ file }) => file === issue1016ModuleRoutesFile).sort(order),
      fixture.violations.filter(({ file }) => file === issue1016ModuleRoutesFile).sort(order))
    || !isDeepStrictEqual(permissions, [...allowances].sort(order))
    || report.summary.staleAllowances !== 0 || report.summary.metadataMismatches !== 0
    || report.summary.allowlistGrowth !== 0 || report.staleAllowances.length !== 0
    || report.metadataMismatches.length !== 0 || report.allowlistGrowth.length !== 0) {
    throw new Error("Issue #1016 Module successor rejected: exact current report and permissions.");
  }
  return { ...report, relocations: report.relocations.filter(({ id }) => !bySource.has(id)) };
}
