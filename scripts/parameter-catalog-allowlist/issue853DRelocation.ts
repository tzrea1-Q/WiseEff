import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import {
  runReviewedRelocationRecord,
  verifyHistoricalRelocationProof,
  type RelocationConfig,
  type RuntimeTopologyRelocation,
} from "./runtimeTopologyRelocation";

const inventoryPath = "scripts/fixtures/parameter-catalog-allowlist/issue-853-d-902-inventory.json";
const inventorySha256 = "cdc7312ae736676de8b45f233d9c1605a86d20d06d02c087fbe11e85b782aa78";
const canonicalTrustedBaseSha = "9b3ba7df7e21f5589684bc92c872da593ad4c246";

const exactConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-d-902-exact-successor.json",
  recordSha256: "8f8000403507515ddf2474e7aa7f0e200d3178453d9f33b9a5617ac6b481e90b",
  files: [
    { file: "server/modules/parameters/initializationService.ts", pairs: 4 },
    { file: "server/modules/parameters/initializationTypes.ts", pairs: 2 },
    { file: "server/modules/parameters/mergeInitializationBindings.test.ts", pairs: 8 },
    { file: "server/modules/parameters/mergeInitializationBindings.ts", pairs: 2 },
    { file: "server/modules/parameters/schemas.test.ts", pairs: 1 },
    { file: "server/modules/parameters/schemas.ts", pairs: 2 },
  ],
  totalPairs: 19,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const fixedConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-d-914-fixed-successor.json",
  recordSha256: "196710666a5052c06b91f7697854d8de225d7c383f1b967c63c59dd9070ee354",
  files: [
    { file: "server/modules/parameter-files/conflictService.test.ts", pairs: 3 },
    { file: "server/modules/parameter-files/syncService.test.ts", pairs: 2 },
  ],
  totalPairs: 5,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const conflictServiceC940Config: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-940-conflict-service-successor.json",
  recordSha256: "c990414c0d7389c5161ff28d7314f66d215b051b65c52590fad54794407e41d0",
  files: [{ file: "server/modules/parameter-files/conflictService.test.ts", pairs: 3 }],
  totalPairs: 3,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const additionalFixedConfig: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-d-additional-fixed-successor.json",
  recordSha256: "ab50f316281e61ccdd8d4e55ab245ef750f0a38b2b309751706d0df2d3b34640",
  files: [
    { file: "server/modules/parameter-files/candidateRepository.ts", pairs: 1 },
    { file: "server/modules/parameter-files/conflictService.ts", pairs: 2 },
    { file: "server/modules/parameter-files/syncService.ts", pairs: 1 },
    { file: "src/infrastructure/http/parameterFileClient.ts", pairs: 2 },
  ],
  totalPairs: 6,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const conflictServiceOwnerC940Config: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-940-conflict-service-owner-successor.json",
  recordSha256: "891a8cc7306557dd28a21ce98b4e7e03d27f00b571caaa44fb5c5af754b05bf0",
  files: [{ file: "server/modules/parameter-files/conflictService.ts", pairs: 2 }],
  totalPairs: 2,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

const conflictServiceOwnerB948Config: RelocationConfig = {
  recordPath: "scripts/fixtures/parameter-catalog-allowlist/issue-853-a-b948-conflict-service-owner-successor.json",
  recordSha256: "615ddb3b17cd801f9eba5afcd539b3031292c95221b2f4827463c23f4c0447bd",
  files: [{ file: "server/modules/parameter-files/conflictService.ts", pairs: 2 }],
  totalPairs: 2,
  rejectAllowanceGrowth: true,
  requireStableStructuralAnchor: true,
  requireStableByteOrder: true,
};

type Inventory = {
  schemaVersion: 1;
  sourcePullRequest: 910;
  sourceHeadSha: string;
  sourceObservationCommit: string;
  sourceObservationTree: string;
  retiredIds: string[];
  unmatchedNewIds: string[];
  absentAtCombinedHead: string[];
  removedViolationId: string;
  targetBlobs: Record<string, string>;
};

const fixedNewIds = [
  "S12-FIL:legacy-parameter-spec-identifier:33112c839be81779:5e44d58cd28e0ec2",
  "S12-FIL:legacy-parameter-spec-identifier:67aefab892891aa4:7cafdea8ef014734",
  "S12-FIL:legacy-parameter-spec-identifier:2bf833958035c0a7:176a53d5f5c83514",
] as const;

export async function loadIssue853DRetiredSourceIds(repoRoot: string) {
  const bytes = await readFile(resolve(repoRoot, inventoryPath));
  requireD(sha256(bytes) === inventorySha256, "inventory integrity");
  const inventory = JSON.parse(bytes.toString("utf8")) as Inventory;
  requireD(inventory.retiredIds.length === 22 && new Set(inventory.retiredIds).size === 22,
    "22 retired source IDs");
  return inventory.retiredIds;
}

export async function verifyIssue853DInventory(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  if (fixture.trustedBaseSha !== canonicalTrustedBaseSha) return;
  const bytes = await readFile(resolve(repoRoot, inventoryPath));
  requireD(sha256(bytes) === inventorySha256, "inventory integrity");
  const inventory = JSON.parse(bytes.toString("utf8")) as Inventory;
  requireD(inventory.schemaVersion === 1 && inventory.sourcePullRequest === 910
    && inventory.sourceHeadSha === "c0c60cb3296154f7e46e222e15c2d595d083bd05"
    && inventory.sourceObservationCommit === "bf9fb5e16472c7919460d255b3c32d61dbb61a0a"
    && inventory.sourceObservationTree === "b90bc952ca05f1ad96d8af27fe4b940fecc5017a",
  "source provenance");
  requireD(execFileSync("git", ["rev-parse", `${inventory.sourceObservationCommit}^{tree}`],
    { cwd: repoRoot, encoding: "utf8" }).trim() === inventory.sourceObservationTree,
  "source observation tree identity");
  const old = new Map(fixture.violations.map((entry) => [entry.id, entry]));
  const current = new Map(discovered.map((entry) => [entry.id, entry]));
  const allowed = new Set(allowances.map((entry) => entry.id));
  requireD(inventory.retiredIds.length === 22 && new Set(inventory.retiredIds).size === 22,
    "22 retired source IDs");
  for (const id of inventory.retiredIds) {
    requireD(old.has(id) && !current.has(id) && !allowed.has(id), `retired source ${id}`);
  }
  const unmatched = new Set(inventory.unmatchedNewIds);
  requireD(unmatched.size === 23 && inventory.unmatchedNewIds.length === 23,
    "23 unmatched new IDs");
  requireD(inventory.absentAtCombinedHead.length === 1
    && unmatched.has(inventory.absentAtCombinedHead[0]), "one absent combined-head observation");
  const absent = new Set(inventory.absentAtCombinedHead);
  for (const id of unmatched) {
    requireD(current.has(id) === !absent.has(id) && !allowed.has(id), `unmatched new ${id}`);
  }
  requireD(!current.has(inventory.removedViolationId) && !allowed.has(inventory.removedViolationId),
    "repaired raw access stays absent");
  requireD(Object.keys(inventory.targetBlobs).length === 8, "reviewed target file inventory");
  for (const [file, expected] of Object.entries(inventory.targetBlobs)) {
    const data = await readFile(resolve(repoRoot, file));
    const blob = createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
    requireD(blob === expected, `target whole-file blob ${file}`);
  }
  return inventory;
}

export async function applyReviewedIssue853DRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  prior: readonly RuntimeTopologyRelocation[],
) {
  if (fixture.trustedBaseSha !== canonicalTrustedBaseSha) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }
  await verifyIssue853DInventory(repoRoot, fixture, allowances, discovered);
  const exact = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, discovered, prior, exactConfig,
  );
  await verifyHistoricalRelocationProof(repoRoot, fixture, allowances, fixedConfig, {
    commit: "a51ba55c955cb0852819bc49d95ea26404093b73",
    tree: "682b22c73cd9f46b300b297ec67b46f6d2641e9c",
  });
  const fixed = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, exact.violations, [...prior, ...exact.relocations],
    { ...fixedConfig, activeFiles: ["server/modules/parameter-files/syncService.test.ts"] },
  );
  const conflictService = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, fixed.violations,
    [...prior, ...exact.relocations, ...fixed.relocations], conflictServiceC940Config,
  );
  const fixedFiles = new Set(fixedConfig.files.map(({ file }) => file));
  const fixedUnmatched = discovered.filter((entry) => fixedFiles.has(entry.file)
    && ![...fixed.relocations, ...conflictService.relocations].some((pair) => pair.observed.id === entry.id));
  requireD(fixedUnmatched.length === fixedNewIds.length
    && fixedNewIds.every((id) => fixedUnmatched.some((entry) => entry.id === id)),
  "three newly introduced fixed-file observations remain unallowed");
  await verifyHistoricalRelocationProof(repoRoot, fixture, allowances, additionalFixedConfig, {
    commit: "a51ba55c955cb0852819bc49d95ea26404093b73",
    tree: "682b22c73cd9f46b300b297ec67b46f6d2641e9c",
  });
  const additional = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, conflictService.violations,
    [...prior, ...exact.relocations, ...fixed.relocations, ...conflictService.relocations],
    { ...additionalFixedConfig, activeFiles: additionalFixedConfig.files
      .map(({ file }) => file).filter((file) => file !== "server/modules/parameter-files/conflictService.ts") },
  );
  const previousConflictServiceOwner = await verifyHistoricalRelocationProof(
    repoRoot, fixture, allowances, conflictServiceOwnerC940Config, {
      commit: "bc9c2d1f324d39498205913ec5c9a38f680a2d8b",
      tree: "4911c47756295437d8dc132526c88506965f8996",
    },
  );
  const currentOwnerRecord = JSON.parse((await readFile(resolve(repoRoot, conflictServiceOwnerB948Config.recordPath))).toString("utf8")) as {
    files: Array<{ pairs: Array<{ old: { id: string } }> }>;
  };
  requireD(previousConflictServiceOwner.pairs.map((pair) => pair.old.id).sort().join("\0")
    === currentOwnerRecord.files.flatMap((file) => file.pairs.map((pair) => pair.old.id)).sort().join("\0"),
  "C940 owner source identities survive the B948 successor");
  const conflictServiceOwner = await runReviewedRelocationRecord(
    repoRoot, fixture, allowances, additional.violations,
    [...prior, ...exact.relocations, ...fixed.relocations, ...conflictService.relocations,
      ...additional.relocations], conflictServiceOwnerB948Config,
  );
  return {
    violations: conflictServiceOwner.violations,
    relocations: [...exact.relocations, ...fixed.relocations, ...conflictService.relocations,
      ...additional.relocations, ...conflictServiceOwner.relocations],
  };
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireD(ok: boolean, invariant: string): asserts ok {
  if (!ok) throw new Error(`Issue #853 D inventory rejected: ${invariant}.`);
}
