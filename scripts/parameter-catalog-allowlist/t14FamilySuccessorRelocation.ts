import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  type RelocationConfig,
  type RelocationOutcome,
  type RuntimeTopologyRelocation,
  type RuntimeTopologyRelocationRecord,
} from "./runtimeTopologyRelocation";

export const t14FamilySuccessorRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json";

const recordSha256 = "6e55b1378acf6f4439392ae53971092a996c12b41fe358fa31622f052e7f4cf2";

export const t14FamilySuccessorRelocationConfig: RelocationConfig = {
  recordPath: t14FamilySuccessorRelocationRecordPath,
  recordSha256,
  files: [
    { file: "e2e/acceptance/knowledge.acceptance.spec.ts", pairs: 13 },
    { file: "server/modules/agent/tools/actionTools.ts", pairs: 2 },
    { file: "server/modules/debugging/repository.ts", pairs: 9 },
    { file: "server/modules/dts-reload/repository.ts", pairs: 4 },
    { file: "server/modules/dts-reload/service.test.ts", pairs: 6 },
    { file: "server/modules/knowledge/parameterReferences.ts", pairs: 6 },
    { file: "server/modules/logs/analyzer/tools/dbToolBackends.ts", pairs: 2 },
    { file: "server/modules/parameter-files/conflictService.test.ts", pairs: 3 },
    { file: "server/modules/parameter-files/syncIdentity.ts", pairs: 2 },
    { file: "server/modules/parameter-files/syncService.test.ts", pairs: 1 },
    { file: "server/modules/parameter-modules/recomputeDryRun.integration.test.ts", pairs: 3 },
    { file: "server/modules/parameter-modules/repository.ts", pairs: 13 },
    { file: "server/modules/parameter-modules/service.test.ts", pairs: 24 },
    { file: "server/modules/parameter-specs/definitionVerification.ts", pairs: 41 },
    { file: "server/modules/parameter-specs/effectiveDefinition.integration.test.ts", pairs: 69 },
    { file: "server/modules/parameter-specs/routes.ts", pairs: 63 },
    { file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 },
  ],
  totalPairs: 265,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

export async function applyReviewedT14FamilySuccessorRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
  activeFiles = t14FamilySuccessorRelocationConfig.files.map(({ file }) => file),
): Promise<RelocationOutcome> {
  requireKnowledge(activeFiles.length > 0 && new Set(activeFiles).size === activeFiles.length
    && activeFiles.every((file) => t14FamilySuccessorRelocationConfig.files.some((section) => section.file === file)),
  "active owner file inventory");
  const proof = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
  const unchangedFiles = activeFiles.filter((file) => file !== knowledgeFile);
  const unchanged = unchangedFiles.length ? await runReviewedRelocationRecord(
    repoRoot,
    fixture,
    allowances,
    discovered,
    existingRelocations,
    { ...t14FamilySuccessorRelocationConfig, activeFiles: unchangedFiles },
  ) : { violations: [...discovered], relocations: [] };
  if (!activeFiles.includes(knowledgeFile)) return unchanged;
  const current = await runReviewedRelocationRecord(repoRoot, fixture, allowances, unchanged.violations,
    [...existingRelocations, ...unchanged.relocations], knowledgeCurrentConfig);
  const watched = discovered.filter(({ file }) => file === knowledgeFile);
  requireKnowledge(isDeepStrictEqual(watched, [...proof.currentPairs.map(({ new: next }) => next),
    ...knowledgeGetPairs().map(({ next }) => next)].sort((a, b) => a.id.localeCompare(b.id))),
  "complete six current source endpoints and order");
  return { violations: current.violations, relocations: [...unchanged.relocations, ...current.relocations] };
}

const knowledgeFile = "e2e/acceptance/knowledge.acceptance.spec.ts";
const knowledgeBase = "5d90785fea95ee436e4e2faccc2be0e0328d3c54";
const knowledgeHead = "7f49d51ca02f5d90f5292e57cbb84e6c470339f2";
const oldKnowledgeBlob = "fea9a484b0b3b1411552c29db488aa74ed45f795";
const currentKnowledgeBlob = "853b8b648f97949797e9841bcb7702d9e8955ff5";
const knowledgeShard = "scripts/parameter-catalog-allowlist/shards/s12-knw.json";
const knowledgeCurrentConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-1015-knowledge-current-relocation.json",
  recordSha256: "472492689b4841556146dd10937831ee20783c35ec23f5cbc10d23e0c9f1f9b5",
  files: [{ file: knowledgeFile, pairs: 4 }], totalPairs: 4,
  rejectAllowanceGrowth: true, requireStableStructuralAnchor: true, requireStableByteOrder: true,
};
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function requireKnowledge(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1015 Knowledge successor rejected: ${detail}.`);
}

/** Only this proved historical view may restore the nine revoked original permissions. */
export async function verifyIssue1015KnowledgeSuccessor(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
) {
  const git = (rev: string, path: string) => execFileSync("git", ["show", `${rev}:${path}`], { cwd: repoRoot });
  const [bytes, current, shardBytes, currentRecordBytes] = await Promise.all([
    readFile(join(repoRoot, t14FamilySuccessorRelocationRecordPath)), readFile(join(repoRoot, knowledgeFile)),
    readFile(join(repoRoot, knowledgeShard)), readFile(join(repoRoot, knowledgeCurrentConfig.recordPath)),
  ]);
  requireKnowledge(sha(bytes) === recordSha256, "frozen thirteen-pair record");
  const section = (JSON.parse(bytes.toString()) as RuntimeTopologyRelocationRecord).files[0]!;
  const currentSection = (JSON.parse(currentRecordBytes.toString()) as RuntimeTopologyRelocationRecord).files[0]!;
  requireKnowledge(sha(currentRecordBytes) === knowledgeCurrentConfig.recordSha256
    && section.file === knowledgeFile && section.pairs.length === 13 && currentSection.pairs.length === 4,
  "pinned current four-pair record");
  const old = git(knowledgeBase, knowledgeFile);
  requireKnowledge(blob(old) === oldKnowledgeBlob && section.destinationBlobOid === oldKnowledgeBlob
    && blob(current) === currentKnowledgeBlob && current.equals(git(knowledgeHead, knowledgeFile))
    && old.length === 70371 && current.length === 59415, "whole-file source and current bytes");
  requireKnowledge(old.subarray(0, 7833).equals(current.subarray(0, 7833))
    && old.subarray(9621, 53764).equals(current.subarray(7833, 51976))
    && old.subarray(62932).equals(current.subarray(51976)), "only two reviewed deletion blocks");
  // Bind retirement to the required canonical replacement and lawful lifecycle fixture,
  // rather than treating absence of scanner hits as proof that coverage was retained.
  for (const path of ["e2e/acceptance/knowledge-canonical-definition.acceptance.spec.ts",
    "e2e/acceptance/requirements.ts", "e2e/acceptance/operationMatrix.ts",
    "server/testing/parameterCatalog/registryProjection.ts",
    "server/testing/parameterCatalog/knowledgeDefinitionLifecycle.test.ts"]) {
    requireKnowledge((await readFile(join(repoRoot, path))).equals(git(knowledgeHead, path)),
      `fixed canonical required replacement and lifecycle ${path}`);
  }
  const activeIds = new Set(currentSection.pairs.map(({ old: endpoint }) => endpoint.id));
  requireKnowledge(activeIds.size === 4 && currentSection.pairs.every((pair) => section.pairs.some((oldPair) =>
    isDeepStrictEqual(oldPair.old, pair.old) && oldPair.sliceSha256 === pair.sliceSha256)), "four original source identities");
  const retired = section.pairs.filter(({ old: endpoint }) => !activeIds.has(endpoint.id));
  requireKnowledge(retired.length === 9 && retired.every(({ new: endpoint }) =>
    (endpoint.byteStart >= 7833 && endpoint.byteEnd <= 9621)
      || (endpoint.byteStart >= 53764 && endpoint.byteEnd <= 62932)), "exact nine deleted historical sources");
  const baseShard = JSON.parse(git(knowledgeBase, knowledgeShard).toString()) as { entries: AllowlistEntry[] };
  const currentShard = JSON.parse(shardBytes.toString()) as { entries: AllowlistEntry[] };
  const retiredIds = new Set(retired.map(({ old: endpoint }) => endpoint.id));
  requireKnowledge(baseShard.entries.length === 50 && isDeepStrictEqual(currentShard,
    { ...baseShard, entries: baseShard.entries.filter(({ id }) => !retiredIds.has(id)) }), "only nine exact shard revocations");
  const restored = baseShard.entries.filter(({ id }) => retiredIds.has(id));
  requireKnowledge(restored.length === 9 && restored.every((entry) => {
    const endpoint = fixture.violations.find(({ id }) => id === entry.id);
    return endpoint && isDeepStrictEqual(entry, { id: endpoint.id, rule: endpoint.rule, file: endpoint.file, reason: endpoint.reason });
  }) && !allowances.some(({ id }) => retiredIds.has(id)), "retired allowance revived or wrong fixture identity");
  const getPairs = knowledgeGetPairs();
  requireKnowledge(!allowances.some(({ id }) => getPairs.some(({ old, next }) => id === old.id || id === next.id)),
    "unallowed GET diagnostics gained permission");
  return { retired, currentPairs: currentSection.pairs, oldPairs: section.pairs,
    historicalAllowances: [...allowances, ...restored] };
}

function knowledgeGetPairs() {
  return [[19, 978, "0dcc3afd5085efb1", "7009282f877fd401"],
    [20, 1047, "4b8452f1a8d1dd6f", "b25f3c4dcd84ae51"]].map(([line, start, oldId, nextId]) => {
    const endpoint: BoundaryViolation = {
      id: `S12-KNW:legacy-catalog-route:1d4c96ffe00e3ac7:${oldId}`,
      family: "S12-KNW", rule: "legacy-catalog-route", file: knowledgeFile, line: Number(line), column: 28,
      byteStart: Number(start), byteEnd: Number(start) + 25, token: "route:/api/v2/parameter-specs",
      evidence: "/api/v2/parameter-specs",
      reason: "Legacy structural Catalog or governance route remains pending retirement or exact adaptation.",
      trustedBaseSha: "9b3ba7df7e21f5589684bc92c872da593ad4c246", trustedBlobOid: oldKnowledgeBlob,
    };
    return { old: endpoint, next: { ...endpoint, id: endpoint.id.replace(String(oldId), String(nextId)),
      trustedBlobOid: currentKnowledgeBlob } };
  });
}

/** Restore the exact A5d historical proof stage; never return this as a current native report. */
export async function historicalIssue1015KnowledgeReport(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  report: Awaited<ReturnType<typeof import("../check-parameter-catalog-boundaries").checkParameterCatalogBoundaries>>,
) {
  const proof = await verifyIssue1015KnowledgeSuccessor(repoRoot, fixture, allowances);
  const gets = knowledgeGetPairs();
  const expected = [...proof.currentPairs.map(({ old }) => old), ...gets.map(({ next }) => next)]
    .sort((a, b) => a.id.localeCompare(b.id));
  requireKnowledge(isDeepStrictEqual(report.violations.filter(({ file }) => file === knowledgeFile), expected),
    "complete current native Knowledge identities and metadata");
  requireKnowledge(isDeepStrictEqual(report.unallowlisted.filter(({ file }) => file === knowledgeFile), gets.map(({ next }) => next)),
    "two unallowed GET diagnostics preserved");
  requireKnowledge(report.summary.staleAllowances === 0 && report.summary.metadataMismatches === 0
    && report.summary.allowlistGrowth === 0, "current allowance integrity");
  const restore = (entries: BoundaryViolation[]) => entries.map((entry) => gets.find(({ next }) => next.id === entry.id)?.old ?? entry);
  const violations = [...restore(report.violations), ...proof.retired.map(({ old }) => old)].sort((a, b) => a.id.localeCompare(b.id));
  const relocations = report.relocations.map((entry) => ({ ...entry,
    observed: proof.oldPairs.find(({ old }) => old.id === entry.id)?.new ?? entry.observed }));
  relocations.push(...proof.retired.map(({ old, new: observed }) => ({ id: old.id, observed })));
  return { allowances: proof.historicalAllowances, report: { ...report, violations,
    unallowlisted: restore(report.unallowlisted).sort((a, b) => a.id.localeCompare(b.id)), relocations,
    summary: { ...report.summary, violations: report.summary.violations + proof.retired.length,
      allowlisted: report.summary.allowlisted + proof.retired.length } } };
}
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
