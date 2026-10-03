import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import type { AllowlistEntry, BoundaryViolation } from "./schema";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
const recordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1009-debugging-retirement.json";
const recordDigest = "a304049af267db88435297b126ddcdc6d6515d5115e6e852a781c1a53c934e16";
const successorBase = "a6fe045b7a90606ff6066345af73d7c63b380bc9";
const successorHead = "fb5a45ac75d0200c029e936ab4443c25f1bc7dd3";
const successorPath = "docs/exec-plans/active/849-inventory/issue-898-debugging-test-owner-read-handoff.json";
const successorDigest = "618700474ae9e928d21438f44f026258b65e4cc78bc53739871589f460224738";
const successorFile = "server/modules/debugging/canonicalDebugging.integration.test.ts";
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const digest = (ids: readonly string[]) => sha(Buffer.from([...ids].sort().join("\n")));
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1009 debugging retirement rejected: ${detail}.`);
}

type SourceObservation = BoundaryViolation & { sourceSlice: string; sourceSliceSha256: string; lineContext: string };
const observationKeys = ["id", "family", "file", "rule", "token", "evidence", "reason", "line", "column",
  "byteStart", "byteEnd", "trustedBaseSha", "trustedBlobOid"] as const;
const observation = (source: SourceObservation): BoundaryViolation => Object.fromEntries(
  observationKeys.map((key) => [key, source[key]]),
) as BoundaryViolation;

/** Restore only the reviewed #1009 stage. This projection never authorizes the current native report. */
export async function acceptedIssue1009StageReport(repoRoot: string, allowances: readonly AllowlistEntry[], report: Report) {
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  const bytes = await readFile(join(repoRoot, successorPath));
  check(sha(bytes) === successorDigest && git(successorHead, successorPath).equals(bytes), "pinned #1013 handoff");
  const successor = JSON.parse(bytes.toString()) as {
    fixedBase: string; ownerFile: string; oldBlob: string; newBlob: string;
    oldFileSha256: string; newFileSha256: string; oldFileByteCount: number; newFileByteCount: number;
    byteChanges: Array<{ oldByteStart: number; oldByteEnd: number; newByteStart: number; newByteEnd: number;
      oldSlice: string; newSlice: string; oldSliceSha256: string; newSliceSha256: string }>;
    rawDiagnostic: { sharedIds: string[]; baseOnly: SourceObservation[]; headOnly: SourceObservation[];
      baseFullIdsSha256: string; headFullIdsSha256: string; disappearedSourceLabels: string[];
      byteIdenticalSuccessor: { oldId: string; newId: string; sliceSha256: string } };
  };
  check(successor.fixedBase === successorBase && successor.ownerFile === successorFile
    && successor.byteChanges.length === 2, "fixed successor input and two replacements");
  const old = git(successorBase, successorFile);
  const current = await readFile(join(repoRoot, successorFile));
  check(blob(old) === successor.oldBlob && sha(old) === successor.oldFileSha256 && old.length === successor.oldFileByteCount
    && blob(current) === successor.newBlob && sha(current) === successor.newFileSha256
    && current.length === successor.newFileByteCount && git(successorHead, successorFile).equals(current),
  "whole-file #1013 successor bytes, scope and current semantics");
  let oldEnd = 0;
  let newEnd = 0;
  for (const change of successor.byteChanges) {
    check(change.oldByteStart >= oldEnd && change.newByteStart >= newEnd
      && old.subarray(oldEnd, change.oldByteStart).equals(current.subarray(newEnd, change.newByteStart)),
    "unchanged prefix and inter-replacement bytes");
    const oldSlice = old.subarray(change.oldByteStart, change.oldByteEnd);
    const newSlice = current.subarray(change.newByteStart, change.newByteEnd);
    check(sha(oldSlice) === change.oldSliceSha256 && oldSlice.toString() === change.oldSlice
      && sha(newSlice) === change.newSliceSha256 && newSlice.toString() === change.newSlice,
    "exact owner-read replacement slices");
    oldEnd = change.oldByteEnd;
    newEnd = change.newByteEnd;
  }
  check(old.subarray(oldEnd).equals(current.subarray(newEnd)), "unchanged suffix bytes");
  const raw = successor.rawDiagnostic;
  const pair = raw.byteIdenticalSuccessor;
  const oldCount = raw.baseOnly.find(({ id }) => id === pair.oldId);
  const nextCount = raw.headOnly[0];
  check(raw.baseOnly.length === 5 && raw.headOnly.length === 1 && raw.disappearedSourceLabels.length === 4
    && oldCount !== undefined && nextCount?.id === pair.newId, "four retirements and one active count successor");
  const allowed = new Set(allowances.map(({ id }) => id));
  for (const endpoint of [...raw.baseOnly, ...raw.headOnly]) {
    const source = endpoint.trustedBlobOid === successor.oldBlob ? old : current;
    const slice = source.subarray(endpoint.byteStart, endpoint.byteEnd);
    check(endpoint.file === successorFile && sha(slice) === endpoint.sourceSliceSha256
      && slice.toString() === endpoint.sourceSlice && !allowed.has(endpoint.id), "exact unallowed successor endpoint slice");
  }
  check(oldCount.sourceSlice === nextCount.sourceSlice && oldCount.sourceSliceSha256 === pair.sliceSha256
    && nextCount.sourceSliceSha256 === pair.sliceSha256 && oldCount.lineContext === nextCount.lineContext
    && observationKeys.filter((key) => key !== "id" && key !== "trustedBlobOid")
      .every((key) => oldCount[key] === nextCount[key]), "active legacy count identity, position and context");
  check(!raw.baseOnly.some(({ id }) => report.violations.some((entry) => entry.id === id)),
    "retired or old observation/allowance revived");
  const actual = report.violations.find(({ id }) => id === nextCount.id);
  check(actual !== undefined && observationKeys.every((key) => actual[key] === nextCount[key]), "exact current count metadata");
  const setDigest = (ids: string[]) => sha(Buffer.from(`${JSON.stringify([...ids].sort(), null, 2)}\n`));
  const baseIds = [...raw.sharedIds, ...raw.baseOnly.map(({ id }) => id)];
  const currentIds = [...raw.sharedIds, nextCount.id];
  check(new Set(baseIds).size === baseIds.length && new Set(currentIds).size === currentIds.length
    && setDigest(baseIds) === raw.baseFullIdsSha256 && setDigest(currentIds) === raw.headFullIdsSha256
    && report.violations.every((entry, index) => index === 0 || report.violations[index - 1]!.id < entry.id),
  "complete baseline raw ID set handoff and current ordering");
  const restore = (entries: BoundaryViolation[]) => [...entries.map((entry) => entry.id === nextCount.id ? observation(oldCount) : entry),
    ...raw.baseOnly.filter(({ id }) => id !== oldCount.id).map(observation)].sort((a, b) => a.id.localeCompare(b.id));
  const stageBytes = git(successorBase, recordPath);
  check(sha(stageBytes) === recordDigest, "pinned accepted #1009 stage");
  const stage = JSON.parse(stageBytes.toString()) as { currentRawIdsSha256: string; currentUnallowlistedIds: string[] };
  // Native IDs include previously reviewed relocation bindings; the handoff's raw scanner IDs do not.
  // Compare the restored native set to the original accepted native set, without running another scan.
  check(digest(restore(report.violations).map(({ id }) => id)) === stage.currentRawIdsSha256,
    "complete baseline raw ID set minus four owner-read labels and one exact count successor");
  check(digest(restore(report.unallowlisted).map(({ id }) => id)) === digest(stage.currentUnallowlistedIds),
    "complete inherited 173 ID set accepted-stage successors");
  check(report.unallowlisted.some(({ id }) => id === nextCount.id), "complete inherited 173 ID set current count");
  check(report.summary.unallowlisted === report.unallowlisted.length, "complete inherited 173 ID set length");
  check(report.summary.violations === report.violations.length && report.summary.allowlisted === 3389
    && report.summary.staleAllowances === 0
    && report.summary.metadataMismatches === 0 && report.summary.allowlistGrowth === 0,
  "current successor allowance integrity");
  return { ...report, violations: restore(report.violations), unallowlisted: restore(report.unallowlisted),
    summary: { ...report.summary, violations: report.summary.violations + 4, unallowlisted: report.summary.unallowlisted + 4 } };
}

/** Historical proof view only. The actual native report remains failed with its independently measured IDs. */
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
  check(![...record.retired, ...record.moved].some(({ old }) => allowances.some(({ id }) => id === old.id)
    || report.violations.some(({ id }) => id === old.id)), "retired or old observation/allowance revived");
  report = await acceptedIssue1009StageReport(repoRoot, allowances, report);
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  const currentFiles = new Map<string, Buffer>();
  for (const [file, oid] of Object.entries(record.ownerBlobs)) {
    const current = file === successorFile ? git(successorBase, file) : await readFile(join(repoRoot, file));
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
