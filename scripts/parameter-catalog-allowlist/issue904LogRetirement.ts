import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";

const file = "server/modules/logs/repository.ts";
const oldHead = "1e55c6ef11ba667a6fd6104f1bb0794ab0ca76a1";
const oldBlob = "f12cbc987b876a6cf6ffb827968606d5fd9f52b7";
const dParent = "2060de5e98425f02b598b90bb4553a8d7742928c";
const dParentBlob = "c29f748344dcaaf532af357255310205e426861e";
const dHead = "931ffd989d17166e8dc0f06d5b94f5a16a8a59f1";
const fixedBlob = "d2803fb1c7273ea764058a34f863a6bdd6cc05e6";
const retiredIds = [
  "S12-LOG:unresolved-boundary-expression:9809fb7c167c6968:1a70b383ae7e6440",
  "S12-LOG:unresolved-boundary-expression:9809fb7c167c6968:60440b5438bb4a26",
] as const;

function requireRetirement(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #904 Logs retirement rejected: ${detail}.`);
}

/** The two old allowances disappear only with the fixed, statically visible SQL. */
export async function verifyIssue904LogRetirement(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  if (fixture.trustedBaseSha !== "9b3ba7df7e21f5589684bc92c872da593ad4c246") return;
  const old = execFileSync("git", ["show", `${oldHead}:${file}`], { cwd: repoRoot });
  const beforeD = execFileSync("git", ["show", `${dParent}:${file}`], { cwd: repoRoot });
  const fromD = execFileSync("git", ["show", `${dHead}:${file}`], { cwd: repoRoot });
  const current = await readFile(resolve(repoRoot, file));
  const oid = (bytes: Buffer) => createHash("sha1")
    .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  requireRetirement(oid(old) === oldBlob && oid(fromD) === fixedBlob
    && oid(current) === fixedBlob, "old and exact D-head fixed whole-file blobs");
  requireRetirement(oid(beforeD) === dParentBlob
    && (beforeD.toString("utf8").match(/where\.join/gu) ?? []).length === 3,
  "all three D-parent dynamic SQL sites");
  const historical = fixture.violations.filter((entry) => retiredIds.includes(entry.id as typeof retiredIds[number]));
  requireRetirement(historical.length === 2, "two exact historical observations");
  for (const entry of historical) {
    requireRetirement(entry.file === file && entry.trustedBlobOid === oldBlob
      && old.subarray(entry.byteStart, entry.byteEnd).toString("utf8").includes("where.join"),
    `old dynamic SQL slice ${entry.id}`);
    requireRetirement(!allowances.some((allowed) => allowed.id === entry.id)
      && !discovered.some((observed) => observed.id === entry.id),
    `retired ID or allowance revived ${entry.id}`);
  }
  requireRetirement(!discovered.some((entry) => entry.file === file),
    "no new or unmatched Logs repository observation");
  const text = current.toString("utf8");
  for (const predicate of [
    "where lr.organization_id = $1", "lr.archive_state = 'active'",
    "lr.related_parameter_project_id = any($6::text[])",
    "lr.related_parameter_project_id = any($4::text[])",
    "where lf.organization_id = $1", "lf.created_at >= now() - $2::interval",
    "lr.related_parameter_project_id = any($4::text[])",
  ]) {
    requireRetirement(text.includes(predicate), `fixed SQL predicate ${predicate}`);
  }
  requireRetirement(!text.includes("where.join"), "no dynamic WHERE composition remains");
}
