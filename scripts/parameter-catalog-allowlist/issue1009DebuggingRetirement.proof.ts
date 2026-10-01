import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import type { AllowlistEntry, BoundaryViolation } from "./schema";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
const recordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1009-debugging-retirement.json";
const recordDigest = "a304049af267db88435297b126ddcdc6d6515d5115e6e852a781c1a53c934e16";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = (ids: readonly string[]) => sha(Buffer.from([...ids].sort().join("\n")));
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1009 debugging retirement rejected: ${detail}.`);
}

/** Historical proof view only. The actual native report remains failed and retains all five new IDs. */
export async function historicalIssue1009Report(repoRoot: string, allowances: readonly AllowlistEntry[], report: Report) {
  const bytes = await readFile(join(repoRoot, recordPath));
  check(sha(bytes) === recordDigest, "pinned exact ledger");
  const record = JSON.parse(bytes.toString()) as {
    baseHead: string; ownerHead: string; ownerBlobs: Record<string, string>;
    baselineRawIdsSha256: string; baselineUnallowlistedIdsSha256: string;
    currentRawIdsSha256: string; currentUnallowlistedIds: string[];
    retired: Array<{ old: BoundaryViolation; sourceSliceSha256: string; sourceSpanText: string }>;
    moved: Array<{ old: BoundaryViolation; new: BoundaryViolation; sourceSliceSha256: string; sourceSpanText: string }>;
  };
  check(record.baseHead === "8dd0ea074e6686ba58d773c99c5a387050fb937c"
    && record.ownerHead === "d6188d5fd2c416957df5ffd738f3d07eca057312"
    && record.retired.length === 6 && record.moved.length === 5, "fixed input and exact six/five partition");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  const currentFiles = new Map<string, Buffer>();
  for (const [file, oid] of Object.entries(record.ownerBlobs)) {
    const current = await readFile(join(repoRoot, file));
    check(blob(current) === oid && git(record.ownerHead, file).equals(current), `whole-file owner blob ${file}`);
    currentFiles.set(file, current);
  }
  const allowed = new Set(allowances.map((item) => item.id));
  const moved = new Map<string, BoundaryViolation>();
  const oldFiles = new Map<string, Buffer>();
  const endpointIds = new Set<string>();
  for (const item of [...record.retired, ...record.moved]) {
    const old = item.old;
    check(!endpointIds.has(old.id) && !allowed.has(old.id)
      && !report.violations.some((entry) => entry.id === old.id), "retired or old observation/allowance revived");
    endpointIds.add(old.id);
    const oldFile = oldFiles.get(old.file) ?? git(record.baseHead, old.file);
    oldFiles.set(old.file, oldFile);
    const slice = oldFile.subarray(old.byteStart, old.byteEnd);
    check(blob(oldFile) === old.trustedBlobOid && sha(slice) === item.sourceSliceSha256
      && slice.toString() === item.sourceSpanText, "exact historical blob and slice");
    const currentFile = currentFiles.get(old.file)!;
    if ("new" in item) {
      const next = item.new as BoundaryViolation;
      const actual = report.violations.find((entry) => entry.id === next.id);
      check(actual !== undefined && !allowed.has(next.id) && !moved.has(next.id), "exact unallowed migration destination");
      for (const key of ["id", "file", "rule", "token", "evidence", "line", "column", "byteStart", "byteEnd", "trustedBlobOid"] as const) {
        check(actual[key] === next[key], `current migration endpoint ${next.id}:${key}`);
      }
      check(old.id.split(":").slice(0, 3).join(":") === next.id.split(":").slice(0, 3).join(":")
        && old.file === next.file && old.rule === next.rule && old.token === next.token && old.evidence === next.evidence
        && blob(currentFile) === next.trustedBlobOid
        && currentFile.subarray(next.byteStart, next.byteEnd).equals(slice), "unchanged test slice and scanner context");
      moved.set(next.id, old);
    } else {
      check(!currentFile.includes(slice), "retired raw source slice revived");
    }
  }
  const retired = record.retired.map((item) => item.old);
  const violations = [...report.violations.map((entry) => moved.get(entry.id) ?? entry), ...retired].sort((a, b) => a.id.localeCompare(b.id));
  const unallowlisted = [...report.unallowlisted.map((entry) => moved.get(entry.id) ?? entry), ...retired].sort((a, b) => a.id.localeCompare(b.id));
  check(digest(violations.map((item) => item.id)) === record.baselineRawIdsSha256, "complete baseline raw ID set");
  check(digest(unallowlisted.map((item) => item.id)) === record.baselineUnallowlistedIdsSha256, "complete inherited 173 ID set");
  check(digest(report.violations.map((item) => item.id)) === record.currentRawIdsSha256
    && digest(report.unallowlisted.map((item) => item.id)) === digest(record.currentUnallowlistedIds),
  "complete current raw and unallowlisted ID sets");
  check(report.summary.violations === 3556 && report.summary.allowlisted === 3389 && report.summary.unallowlisted === 167
    && report.summary.staleAllowances === 0 && report.summary.metadataMismatches === 0 && report.summary.allowlistGrowth === 0,
  "current stage exact inventory and allowance integrity");
  return { ...report, violations, unallowlisted, summary: { ...report.summary,
    violations: report.summary.violations + retired.length, unallowlisted: report.summary.unallowlisted + retired.length,
  } };
}
