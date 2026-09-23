import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
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

const remainderExactConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-remainder-exact.json",
  recordSha256: "1e6a54777f644aed11cbac490210bf803233ca6aa49b053eeac304f929ccc366",
  files: [
    { file: "server/modules/agent/tools/actionTools.integration.test.ts", pairs: 23 },
    { file: "server/modules/dts-reload/history.test.ts", pairs: 6 },
    { file: "server/modules/dts-reload/repository.ts", pairs: 1 },
    { file: "server/modules/dts-reload/restoreBaseline.test.ts", pairs: 1 },
    { file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 },
  ],
  totalPairs: 35,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const remainderRewrittenConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-remainder-rewritten.json",
  recordSha256: "bf1366617336a652ef7c0c984b52a1093a3b6a0c2788c105013aa12a297deefa",
  files: [{ file: "server/modules/parameter-topology/writeLock.ts", pairs: 4 }],
  totalPairs: 4,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
  requireIdenticalSlice: false,
};

const remainderRetiredRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-remainder-retired.json";
const remainderRetiredRecordSha256 =
  "3b00dbbf9ffe8ec945e15fd734669e6442fda3eaf7acfa915ec4607b112fd00a";
const remainderRetiredFiles = [
  ["server/modules/agent/tools/actionTools.test.ts", 3],
  ["server/modules/dts-reload/behaviouralVerify.ts", 3],
  ["server/modules/dts-reload/deploy.test.ts", 6],
  ["server/modules/dts-reload/promote.test.ts", 7],
  ["server/modules/dts-reload/repository.ts", 17],
  ["server/modules/dts-reload/service.test.ts", 6],
] as const;

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
  // Synthetic checker fixtures use their own trusted base and do not contain this fixed Catalog debt.
  if (fixture.trustedBaseSha !== "9b3ba7df7e21f5589684bc92c872da593ad4c246") return;
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

export async function applyReviewedIssue853CRemainderRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  prior: readonly RuntimeTopologyRelocation[],
) {
  const exact = await runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, prior, remainderExactConfig);
  const rewritten = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, exact.violations, [...prior, ...exact.relocations], remainderRewrittenConfig,
  );
  return { violations: rewritten.violations, relocations: [...exact.relocations, ...rewritten.relocations] };
}

export async function verifyIssue853CRemainderRetirement(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  if (fixture.trustedBaseSha !== "9b3ba7df7e21f5589684bc92c872da593ad4c246") return;
  const record = await loadIssue853CRemainderRetirement(repoRoot);
  const blobOid = (value: Buffer) => createHash("sha1")
    .update(`blob ${value.length}\0`).update(value).digest("hex");
  const baseline = new Map(fixture.violations.map((entry) => [entry.id, entry]));
  const allowed = new Set(allowances.map((entry) => entry.id));
  const current = new Set(discovered.map((entry) => entry.id));
  if (record.schemaVersion !== 1 || record.trustedBaseSha !== fixture.trustedBaseSha
    || record.files.length !== remainderRetiredFiles.length) {
    throw new Error("Issue #853 C retirement rejected: fixed inventory.");
  }
  const seen = new Set<string>();
  for (const [index, [file, count]] of remainderRetiredFiles.entries()) {
    const section = record.files[index];
    if (section.file !== file || section.retiredIds.length !== count) {
      throw new Error("Issue #853 C retirement rejected: fixed file partition.");
    }
    const source = execFileSync("git", ["show", `${fixture.trustedBaseSha}:${file}`], { cwd: repoRoot });
    const destination = await readFile(resolve(repoRoot, file));
    if (blobOid(source) !== section.sourceBlobOid || blobOid(destination) !== section.destinationBlobOid) {
      throw new Error(`Issue #853 C retirement rejected: whole-file blob ${file}.`);
    }
    for (const id of section.retiredIds) {
      const old = baseline.get(id);
      if (!old || old.file !== file || seen.has(id) || allowed.has(id) || current.has(id)
        || old.trustedBlobOid !== section.sourceBlobOid
        || destination.includes(source.subarray(old.byteStart, old.byteEnd))) {
        throw new Error(`Issue #853 C retirement rejected: exact vanished slice ${id}.`);
      }
      seen.add(id);
    }
  }
  if (seen.size !== 42) throw new Error("Issue #853 C retirement rejected: 42-item partition.");
}

export async function loadIssue853CRemainderRetiredSourceIds(repoRoot: string) {
  const record = await loadIssue853CRemainderRetirement(repoRoot);
  return record.files.flatMap((section) => section.retiredIds);
}

async function loadIssue853CRemainderRetirement(repoRoot: string) {
  const bytes = await readFile(resolve(repoRoot, remainderRetiredRecordPath));
  if (createHash("sha256").update(bytes).digest("hex") !== remainderRetiredRecordSha256) {
    throw new Error("Issue #853 C retirement rejected: reviewed record integrity.");
  }
  return JSON.parse(bytes.toString("utf8")) as {
    schemaVersion: number;
    trustedBaseSha: string;
    files: Array<{ file: string; sourceBlobOid: string; destinationBlobOid: string; retiredIds: string[] }>;
  };
}
