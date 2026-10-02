import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import { runReviewedRelocationRecord, type RuntimeTopologyRelocationRecord,
  type RuntimeTopologyRelocation } from "./runtimeTopologyRelocation";
import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
type Inventory = { summary: Report["summary"]; violationsIdsSha256: string; violationsMetadataSha256: string;
  unallowlistedIdsSha256: string; unallowlistedMetadataSha256: string };
type Context = { start: number; end: number; sha256: string };
export type Issue1021StructuralSpecRecord = {
  schemaVersion: number; baseHead: string; ownerHead: string; trustedBaseSha: string;
  source: { file: string; oldBlob: string; newBlob: string; oldBytes: number; newBytes: number;
    oldSHA256: string; newSHA256: string; exactFourCallsOnly: boolean };
  changes: Array<{ oldStart: number; oldEnd: number; currentStart: number; currentEnd: number;
    oldSha256: string; currentSha256: string; oldUtf8: string; currentUtf8: string }>;
  anchors: Array<{ path: string; blob: string; bytes: number; sha256: string }>;
  wrapperInput: { path: string; blob: string; bytes: number; sha256: string };
  frozenReferences: Array<{ path: string; blob: string }>;
  historicalRecord: { file: string; sha256: string; total: number; target: number;
    sourceBlob: string; destinationBlob: string };
  standardRecord: { file: string; bytes: number; sha256: string };
  retired: Array<{ endpoint: BoundaryViolation; sliceUtf8: string; sliceSha256: string; context: Context }>;
  writers: Array<{ old: BoundaryViolation; current: BoundaryViolation; oldSlice: string; currentSlice: string;
    oldContext: Context; currentContext: Context }>;
  rawBase: { idsSha256: string; metadataSha256: string }; rawCurrent: { idsSha256: string; metadataSha256: string };
  baseInventory: Inventory; currentInventory: Inventory; allowancesSha256: string;
  baseRelocationsSha256: string; currentRelocationsSha256: string;
};
export const issue1021SpecRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1021-topology-structural-spec-identity-successor.json";
export const issue1021SpecRelocationRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1021-topology-structural-spec-identity-relocation.json";
const recordDigest = "bc2e9d7d0d58ac7214efba046e9bf9d24daad91a50bc0523264bcbf5e50ed633";
const standardDigest = "8816d93a49c446cf0d6f8a36fc2cecba50c7cadc266335a1674789f76e472aa2";
const allowanceOrderDigest = "f42f73838d7251e3afbf2a93591130756f483a6af8ccae5dc6f1bbb182c5c1b5";
const baseHead = "b695b356ef869037a83f182c0fc1cbf5a481945f";
const ownerHead = "d9add8c9246c09dcb78e3bd2b8e4b7069279df00";
const sourceFile = "server/modules/parameter-topology/editService.test.ts";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const ids = (entries: readonly { id: string }[]) => sha(entries.map(({ id }) => id).sort().join("\n"));
const metadata = (value: unknown) => sha(JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1021 topology structural Spec identity successor rejected: ${detail}.`);
}

/** Byte-exact source first: no old observations or historical report can bypass this gate. */
export async function verifyIssue1021StructuralSpecSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  const bytes = await readFile(join(repoRoot, issue1021SpecRecordPath));
  check(bytes.length <= 32_768 && sha(bytes) === recordDigest, "pinned structural identity record integrity");
  const record = JSON.parse(bytes.toString()) as Issue1021StructuralSpecRecord;
  check(record.schemaVersion === 1 && record.baseHead === baseHead && record.ownerHead === ownerHead
    && record.source.file === sourceFile && record.source.exactFourCallsOnly
    && record.retired.length === 4 && record.writers.length === 4 && record.anchors.length === 4
    && record.frozenReferences.length === 51 && record.trustedBaseSha === "9b3ba7df7e21f5589684bc92c872da593ad4c246",
  "fixed inputs and exact source partition");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  check(execFileSync("git", ["show", "-s", "--format=%P", ownerHead], { cwd: repoRoot, encoding: "utf8" }).trim()
    === baseHead, "sole input parent");
  const old = git(baseHead, sourceFile);
  const current = await readFile(join(repoRoot, sourceFile));
  check(blob(old) === record.source.oldBlob && old.length === record.source.oldBytes && sha(old) === record.source.oldSHA256
    && blob(current) === record.source.newBlob && current.length === record.source.newBytes
    && sha(current) === record.source.newSHA256 && git(ownerHead, sourceFile).equals(current),
  "destination whole-file blob, 32 cases/143 expectations, fixture identity/refusals/lifecycle");
  check(isDeepStrictEqual(record.changes.map(({ oldStart, oldEnd, currentStart, currentEnd }) =>
    [oldStart, oldEnd, currentStart, currentEnd]), [
    [32613, 32790, 32613, 32691], [32826, 33027, 32727, 32829],
    [34001, 34178, 33803, 33881], [34214, 34416, 33917, 34020],
  ]), "only the four complete setup calls");
  let oldCursor = 0;
  let currentCursor = 0;
  for (const part of record.changes) {
    const before = old.subarray(part.oldStart, part.oldEnd);
    const after = current.subarray(part.currentStart, part.currentEnd);
    check(old.subarray(oldCursor, part.oldStart).equals(current.subarray(currentCursor, part.currentStart))
      && before.toString() === part.oldUtf8 && after.toString() === part.currentUtf8
      && sha(before) === part.oldSha256 && sha(after) === part.currentSha256
      && part.currentUtf8 === part.oldUtf8.replace(
        " = (\n         select parameter_spec_id from project_parameter_bindings where id = $1\n       )", " = $1")
        .replace("[fixture.binding.id]", "[SPEC_ID]"), "same row DELETE/UPDATE; only the structural identity lookup changed");
    oldCursor = part.oldEnd;
    currentCursor = part.currentEnd;
  }
  check(old.subarray(oldCursor).equals(current.subarray(currentCursor)), "all remaining cases/helpers/hooks unchanged");
  for (const anchor of record.anchors) {
    const content = await readFile(join(repoRoot, anchor.path));
    check(blob(content) === anchor.blob && content.length === anchor.bytes && sha(content) === anchor.sha256
      && git(baseHead, anchor.path).equals(content) && git(ownerHead, anchor.path).equals(content), "destination whole-file blob of unchanged source owner anchor");
  }
  const wrapper = git(baseHead, record.wrapperInput.path);
  check(blob(wrapper) === record.wrapperInput.blob && sha(wrapper) === record.wrapperInput.sha256
    && git(ownerHead, record.wrapperInput.path).equals(wrapper), "fixed input wrapper provenance");
  for (const reference of record.frozenReferences) {
    check(blob(await readFile(join(repoRoot, reference.path))) === reference.blob,
      "reviewed record integrity / immutable original fixture/shard bytes");
  }
  check(metadata([...allowances].sort(order)) === record.allowancesSha256
    && metadata(allowances) === allowanceOrderDigest, "allowance growth / complete allowances and original shard order");
  const originalBytes = await readFile(join(repoRoot, record.historicalRecord.file));
  check(record.historicalRecord.file === "scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json"
    && sha(originalBytes) === "b998321716d00d58ea83b03cd283a52bafb40ac40437549ee453e7153c83742c",
  "reviewed record integrity");
  const original = JSON.parse(originalBytes.toString()) as RuntimeTopologyRelocationRecord;
  const originalSection = original.files.find(({ file }) => file === sourceFile);
  check(original.files.flatMap(({ pairs }) => pairs).length === 82 && !!originalSection
    && originalSection.pairs.length === 28 && originalSection.sourceBlobOid === record.historicalRecord.sourceBlob
    && originalSection.destinationBlobOid === record.source.oldBlob, "immutable original 82/28 history");
  const standardBytes = await readFile(join(repoRoot, issue1021SpecRelocationRecordPath));
  check(standardBytes.length <= 53_248 && standardBytes.length === record.standardRecord.bytes
    && sha(standardBytes) === standardDigest && record.standardRecord.sha256 === standardDigest
    && record.standardRecord.file === issue1021SpecRelocationRecordPath, "pinned standard 28-pair record integrity");
  const standard = JSON.parse(standardBytes.toString()) as RuntimeTopologyRelocationRecord;
  const section = standard.files[0]!;
  check(standard.schemaVersion === 1 && standard.trustedBaseSha === original.trustedBaseSha
    && standard.fixtureSha256 === original.fixtureSha256 && standard.files.length === 1
    && section.file === sourceFile && section.sourceBlobOid === originalSection.sourceBlobOid
    && section.destinationBlobOid === record.source.newBlob && section.pairs.length === 28
    && section.pairs.every((pair, index) => isDeepStrictEqual(pair.old, originalSection.pairs[index]!.old)
      && pair.sliceSha256 === originalSection.pairs[index]!.sliceSha256
      && old.subarray(originalSection.pairs[index]!.new.byteStart, originalSection.pairs[index]!.new.byteEnd)
        .equals(current.subarray(pair.new.byteStart, pair.new.byteEnd))), "all 28 original canonical IDs, slices and order retained");
  for (const { endpoint, sliceUtf8, sliceSha256, context } of record.retired) {
    check(endpoint.file === sourceFile && endpoint.trustedBlobOid === record.source.oldBlob
      && endpoint.rule === "legacy-catalog-raw-read" && endpoint.token === "read:project_parameter_bindings"
      && old.subarray(endpoint.byteStart, endpoint.byteEnd).toString() === sliceUtf8
      && sha(old.subarray(endpoint.byteStart, endpoint.byteEnd)) === sliceSha256
      && sha(old.subarray(context.start, context.end)) === context.sha256 && !current.includes(Buffer.from(sliceUtf8))
      && !allowances.some(({ id }) => id === endpoint.id), "four exact old reads vanished and remain unlicensed");
  }
  for (const pair of record.writers) {
    check(pair.old.rule === "legacy-catalog-sql-write" && pair.current.rule === pair.old.rule
      && pair.old.file === sourceFile && pair.current.file === sourceFile && pair.old.reason === pair.current.reason
      && pair.old.token === pair.current.token && pair.old.trustedBlobOid === record.source.oldBlob
      && pair.current.trustedBlobOid === record.source.newBlob
      && old.subarray(pair.old.byteStart, pair.old.byteEnd).toString() === pair.oldSlice
      && current.subarray(pair.current.byteStart, pair.current.byteEnd).toString() === pair.currentSlice
      && sha(old.subarray(pair.oldContext.start, pair.oldContext.end)) === pair.oldContext.sha256
      && sha(current.subarray(pair.currentContext.start, pair.currentContext.end)) === pair.currentContext.sha256
      && !allowances.some(({ id }) => id === pair.old.id || id === pair.current.id), "four same-operation fixture writes remain unlicensed");
  }
  return { record, standard, originalSection };
}

/** Mandatory current source proof, then the unchanged generic exact-alias validator. */
export async function applyReviewedIssue1021StructuralSpecRelocation(repoRoot: string,
  fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[], discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = []) {
  await verifyIssue1021StructuralSpecSource(repoRoot, allowances);
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, {
    recordPath: issue1021SpecRelocationRecordPath, recordSha256: standardDigest,
    files: [{ file: sourceFile, pairs: 28 }], totalPairs: 28, rejectAllowanceGrowth: true,
    requireStableStructuralAnchor: true, requireStableByteOrder: true,
  });
}

function restoreEntries(entries: readonly BoundaryViolation[], pairs: Array<{ old: BoundaryViolation; current: BoundaryViolation }>,
  record: Issue1021StructuralSpecRecord) {
  const oldByCurrent = new Map(pairs.map(({ old, current }) => [current.id, old]));
  return [...entries.map((entry) => ({ ...(oldByCurrent.get(entry.id) ?? entry) })),
    ...record.retired.map(({ endpoint }) => ({ ...endpoint }))].sort(order);
}

/** Same-tree full raw only; historical clone is for the named frozen b695 stage, never the checker. */
export async function historicalIssue1021StructuralSpecRaw(repoRoot: string,
  allowances: readonly AllowlistEntry[], discovered: readonly BoundaryViolation[]) {
  const { record, standard, originalSection } = await verifyIssue1021StructuralSpecSource(repoRoot, allowances);
  check(ids(discovered) === record.rawCurrent.idsSha256 && metadata(discovered) === record.rawCurrent.metadataSha256,
    "complete current raw IDs, order and metadata");
  const pairs = [...record.writers, ...standard.files[0]!.pairs.map((pair, index) =>
    ({ old: originalSection.pairs[index]!.new, current: pair.new }))];
  const historical = restoreEntries(discovered, pairs, record);
  check(ids(historical) === record.rawBase.idsSha256 && metadata(historical) === record.rawBase.metadataSha256,
    "complete b695 raw history, original four writers plus four reads");
  return { record, historical };
}

/** Real native result first; restore only four writer endpoints/four reads and 28 observed aliases for history. */
export async function historicalIssue1021StructuralSpecReport(repoRoot: string,
  allowances: readonly AllowlistEntry[], report: Report) {
  const { record, standard, originalSection } = await verifyIssue1021StructuralSpecSource(repoRoot, allowances);
  const current = record.currentInventory;
  check(report.schemaVersion === 1 && report.status === "failed" && isDeepStrictEqual(report.summary, current.summary)
    && ids(report.violations) === current.violationsIdsSha256 && metadata(report.violations) === current.violationsMetadataSha256
    && ids(report.unallowlisted) === current.unallowlistedIdsSha256 && metadata(report.unallowlisted) === current.unallowlistedMetadataSha256
    && report.staleAllowances.length === 0 && report.metadataMismatches.length === 0 && report.allowlistGrowth.length === 0
    && report.relocations.length === 968 && metadata(report.relocations) === record.currentRelocationsSha256,
  "complete current native IDs, order, metadata, aliases and status");
  const permitted = new Set(allowances.map(({ id }) => id));
  check(isDeepStrictEqual(report.unallowlisted, report.violations.filter(({ id }) => !permitted.has(id)))
    && metadata(report.violations.filter(({ id }) => permitted.has(id)).map(({ id, file, rule, reason }) =>
      ({ id, file, rule, reason }))) === record.allowancesSha256, "exact inherited permission scope");
  const violations = restoreEntries(report.violations, record.writers, record);
  const unallowlisted = restoreEntries(report.unallowlisted, record.writers, record);
  const aliases = new Map(standard.files[0]!.pairs.map((pair, index) => [pair.old.id,
    { current: pair.new, old: originalSection.pairs[index]!.new }]));
  const relocations = report.relocations.map((entry) => {
    const pair = aliases.get(entry.id);
    check(!pair || isDeepStrictEqual(entry.observed, pair.current), "exact 28 current observed aliases");
    return { ...entry, observed: { ...(pair?.old ?? entry.observed) } };
  });
  const base = record.baseInventory;
  check(ids(violations) === base.violationsIdsSha256 && metadata(violations) === base.violationsMetadataSha256
    && ids(unallowlisted) === base.unallowlistedIdsSha256 && metadata(unallowlisted) === base.unallowlistedMetadataSha256
    && metadata(relocations) === record.baseRelocationsSha256, "complete accepted b695 native and alias history");
  return { ...report, violations, unallowlisted, relocations, summary: { ...base.summary } };
}
