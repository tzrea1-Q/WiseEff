import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { issue904LogRetiredIds, verifyIssue904LogRetirement } from "./issue904LogRetirement";
import type { AllowlistEntry, BoundaryViolationFixture } from "./schema";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
const sourceHead = "e94da503b8e01f838de1aba0cac4059be01a841b";
const ledgerPath = "docs/exec-plans/active/849-inventory/mod-dismissed-identity-read-retirement.json";
const historicalScriptBlob = "5524f0b1f6617f6c437c4d3c1fb721984a4a6bb5";
const baselineRawIdsSha256 = "f0e5e41dfbc4e8120241832a53e55e8bbdc732276963bc1ebfae5c37bb7537d0";
const allowanceIdsSha256 = "48c252407e2ae48d7708007c33ee7572b0dc4569c890e4ea0e30d1464097d10b";
const remainingIdsSha256 = "e4d61c03087651a29cf8b039db4d302c54df73fefc51412ce118bff5579d9a40";
export const issue1006RetiredId = "S12-MOD:legacy-catalog-raw-read:3d36995998094eb1:b170050e2ad90587";

const digest = (ids: readonly string[]) => createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
const blobOid = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function requireRetirement(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1006 retirement rejected: ${detail}.`);
}

/** Consume the owner-path report's existing same-tree scan; never rescan or permit an ID. */
export async function verifyIssue1006Retirement(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[], report: Report,
) {
  const ledger = JSON.parse(execFileSync("git", ["show", `${sourceHead}:${ledgerPath}`], {
    cwd: repoRoot, encoding: "utf8",
  })) as {
    baseHead: string; retired: Array<{ id: string; file: string; baseBlob: string; currentBlob: string;
      byteStart: number; byteEnd: number; sourceSliceSha256: string }>;
    currentProofBlobs: Record<string, string>; remainingUnallowlistedIds: string[];
  };
  requireRetirement(ledger.baseHead === "6ecf3e3c6f0fce18ed43572dddc7f2bb1f94b914"
    && ledger.retired.length === 1 && ledger.retired[0]!.id === issue1006RetiredId, "fixed input and sole retirement");
  const retired = ledger.retired[0]!;
  requireRetirement(!report.violations.some(({ id }) => id === retired.id)
    && !allowances.some(({ id }) => id === retired.id), "retired read or allowance revived");
  requireRetirement(digest([...report.violations.map(({ id }) => id), retired.id]) === baselineRawIdsSha256,
    "complete baseline raw ID set minus exactly the retired read");
  requireRetirement(digest(report.unallowlisted.map(({ id }) => id)) === remainingIdsSha256
    && digest(ledger.remainingUnallowlistedIds) === remainingIdsSha256,
    "complete inherited 173 ID set");
  requireRetirement(digest(allowances.map(({ id }) => id)) === allowanceIdsSha256,
    "unchanged exact allowance set");
  const old = execFileSync("git", ["show", `${ledger.baseHead}:${retired.file}`], { cwd: repoRoot });
  requireRetirement(blobOid(old) === retired.baseBlob
    && createHash("sha256").update(old.subarray(retired.byteStart, retired.byteEnd)).digest("hex")
      === retired.sourceSliceSha256, "exact old blob and source slice");
  const current = await readFile(join(repoRoot, retired.file));
  requireRetirement(blobOid(current) === retired.currentBlob
    && !current.includes(old.subarray(retired.byteStart, retired.byteEnd)), "current whole-file retirement");
  for (const [file, blob] of Object.entries(ledger.currentProofBlobs)) {
    requireRetirement(blobOid(await readFile(join(repoRoot, file))) === blob, `formal reader proof blob ${file}`);
  }
  await verifyIssue904LogRetirement(repoRoot, fixture, allowances, report.violations);
  const historicalScript = execFileSync("git", ["show",
    "cce8751a37ff4eb224869df146a52144142625bc:scripts/check-parameter-catalog-boundaries.test.ts",
  ], { cwd: repoRoot });
  requireRetirement(blobOid(historicalScript) === historicalScriptBlob, "frozen historical assertion blob");
  // Historical normalized inventory: restore only the two proven LOG observations/allowances.
  // MOD's later unallowed addition and its retirement cancel; no other raw ID may change.
  return {
    ...report.summary,
    violations: report.summary.violations + issue904LogRetiredIds.length,
    allowlisted: report.summary.allowlisted + issue904LogRetiredIds.length,
  };
}
