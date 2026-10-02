import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import type { AllowlistEntry, BoundaryViolation } from "./schema";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
type Inventory = { summary: Report["summary"]; violationsIdsSha256: string; violationsMetadataSha256: string;
  unallowlistedIdsSha256: string; unallowlistedMetadataSha256: string };
export type Issue1018ReadSuccessorRecord = {
  schemaVersion: number; baseHead: string; ownerHead: string; trustedBaseSha: string;
  source: { file: string; oldBlob: string; currentBlob: string; oldByteCount: number; currentByteCount: number;
    oldSha256: string; currentSha256: string };
  readers: Array<{ file: string; blob: string; byteCount: number; sha256: string }>;
  changedRead: { start: number; oldEnd: number; currentEnd: number; oldSha256: string;
    currentSha256: string; prefixSha256: string; suffixSha256: string };
  retired: BoundaryViolation[]; pairs: Array<{ old: BoundaryViolation; current: BoundaryViolation }>;
  spans: Array<{ oldStart: number; oldEnd: number; currentStart: number | null; currentEnd: number | null;
    sliceUtf8: string; sliceSha256: string; oldContextStart: number; oldContextEnd: number;
    contextUtf8: string; contextSha256: string }>;
  baseInventory: Inventory; currentInventory: Inventory; allowancesSha256: string; relocationsSha256: string;
  rawBase: { idsSha256: string; metadataSha256: string }; rawCurrent: { idsSha256: string; metadataSha256: string };
};
export const issue1018ReadSuccessorRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1018-json-deleted-state-read-successor.json";
const recordDigest = "eeefbf8c1899b375e8297cb56132904301ad07dea2d2a74b25c53985ca9c00d8";
const baseHead = "31f35f8abea30f163e64aa774eff3efca5c7de43";
const ownerHead = "72e1d8ec4ed7743a7a0897fef37eb284da37484b";
const sourceFile = "server/modules/parameter-files/canonicalJsonSource.integration.test.ts";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const ids = (entries: readonly { id: string }[]) => sha(entries.map(({ id }) => id).sort().join("\n"));
const metadata = (value: unknown) => sha(JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1018 JSON deleted-state successor rejected: ${detail}.`);
}

async function verifiedSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  const bytes = await readFile(join(repoRoot, issue1018ReadSuccessorRecordPath));
  check(bytes.length <= 32_768 && sha(bytes) === recordDigest, "pinned three-retirement/four-successor record integrity");
  const record = JSON.parse(bytes.toString()) as Issue1018ReadSuccessorRecord;
  check(record.schemaVersion === 1 && record.baseHead === baseHead && record.ownerHead === ownerHead
    && record.trustedBaseSha === "9b3ba7df7e21f5589684bc92c872da593ad4c246" && record.source.file === sourceFile
    && record.retired.length === 3 && record.pairs.length === 4 && record.spans.length === 3 && record.readers.length === 3,
  "fixed owner inputs and exact source partition");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  check(execFileSync("git", ["show", "-s", "--format=%P", ownerHead], { cwd: repoRoot, encoding: "utf8" }).trim()
    === baseHead, "fixed sole parent");
  const old = git(baseHead, sourceFile);
  const current = await readFile(join(repoRoot, sourceFile));
  check(blob(old) === record.source.oldBlob && old.length === record.source.oldByteCount && sha(old) === record.source.oldSha256
    && blob(current) === record.source.currentBlob && current.length === record.source.currentByteCount
    && sha(current) === record.source.currentSha256 && git(ownerHead, sourceFile).equals(current),
  "whole-file JSON fixture, product cases, permissions, FK, cardinality and cleanup");
  const changed = record.changedRead;
  check(changed.start === 72027 && changed.oldEnd === 72917 && changed.currentEnd === 73216
    && old.subarray(0, changed.start).equals(current.subarray(0, changed.start))
    && old.subarray(changed.oldEnd).equals(current.subarray(changed.currentEnd))
    && sha(current.subarray(0, changed.start)) === changed.prefixSha256
    && sha(current.subarray(changed.currentEnd)) === changed.suffixSha256
    && sha(old.subarray(changed.start, changed.oldEnd)) === changed.oldSha256
    && sha(current.subarray(changed.start, changed.currentEnd)) === changed.currentSha256,
  "only the reviewed deleted-state read changed");
  for (const reader of record.readers) {
    const content = await readFile(join(repoRoot, reader.file));
    check(blob(content) === reader.blob && content.length === reader.byteCount && sha(content) === reader.sha256
      && git(baseHead, reader.file).equals(content) && git(ownerHead, reader.file).equals(content),
    "unchanged public owner reader bytes");
  }
  check(metadata([...allowances].sort(order)) === record.allowancesSha256, "unchanged complete allowances");
  const seen = new Set<string>();
  for (const endpoint of [...record.retired, ...record.pairs.flatMap(({ old: previous, current: next }) => [previous, next])]) {
    const isCurrent = endpoint.trustedBlobOid === record.source.currentBlob;
    const source = isCurrent ? current : old;
    const span = record.spans.find((item) => (isCurrent ? item.currentStart : item.oldStart) === endpoint.byteStart);
    check(!!span && endpoint.trustedBlobOid === (isCurrent ? record.source.currentBlob : record.source.oldBlob)
      && endpoint.file === sourceFile && endpoint.family === "S12-FIL" && endpoint.trustedBaseSha === record.trustedBaseSha
      && !seen.has(endpoint.id) && !allowances.some(({ id }) => id === endpoint.id), "exact eleven unlicensed endpoints");
    const prefix = source.subarray(0, endpoint.byteStart).toString();
    const slice = source.subarray(endpoint.byteStart, endpoint.byteEnd);
    check(endpoint.byteStart >= 0 && endpoint.byteEnd > endpoint.byteStart && endpoint.byteEnd <= source.length
      && endpoint.byteEnd === (isCurrent ? span.currentEnd : span.oldEnd)
      && endpoint.line === prefix.split("\n").length && endpoint.column === prefix.length - prefix.lastIndexOf("\n")
      && slice.toString() === span.sliceUtf8 && sha(slice) === span.sliceSha256,
    "exact endpoint blob, span, line, column and slice");
    const offset = isCurrent ? 299 : 0;
    const context = source.subarray(span.oldContextStart + offset, span.oldContextEnd + offset);
    check(span.oldContextStart >= 0 && span.oldContextStart <= span.oldStart && span.oldContextEnd >= span.oldEnd
      && span.oldContextEnd + offset <= source.length && context.toString() === span.contextUtf8
      && sha(context) === span.contextSha256, "exact endpoint context");
    seen.add(endpoint.id);
  }
  for (const { old: previous, current: next } of record.pairs) {
    const stable = (v: BoundaryViolation) => ({ file: v.file, family: v.family, rule: v.rule, reason: v.reason,
      token: v.token, evidence: v.evidence, trustedBaseSha: v.trustedBaseSha, column: v.column });
    check(isDeepStrictEqual(stable(previous), stable(next)) && next.line === previous.line + 4
      && next.byteStart === previous.byteStart + 299 && next.byteEnd === previous.byteEnd + 299,
    "four retained SQL identities preserve bytes and semantics without permission");
  }
  for (const previous of record.retired) {
    check(previous.byteStart >= changed.start && previous.byteEnd <= changed.oldEnd
      && !current.includes(old.subarray(previous.byteStart, previous.byteEnd)), "retired deleted-state read revived");
  }
  return record;
}

function historicalEntries(entries: readonly BoundaryViolation[], record: Issue1018ReadSuccessorRecord) {
  const oldByCurrent = new Map(record.pairs.map((pair) => [pair.current.id, pair.old]));
  return [...entries.map((entry) => ({ ...(oldByCurrent.get(entry.id) ?? entry) })),
    ...record.retired.map((entry) => ({ ...entry }))].sort(order);
}

/** Same-tree raw scan only; the returned 31f view is local to the unchanged #1017 historical checks. */
export async function historicalIssue1018JsonDeletedStateRaw(
  repoRoot: string, allowances: readonly AllowlistEntry[], discovered: readonly BoundaryViolation[],
) {
  const record = await verifiedSource(repoRoot, allowances);
  check(ids(discovered) === record.rawCurrent.idsSha256 && metadata(discovered) === record.rawCurrent.metadataSha256,
    "complete current raw IDs, order and metadata");
  const historical = historicalEntries(discovered, record);
  check(ids(historical) === record.rawBase.idsSha256 && metadata(historical) === record.rawBase.metadataSha256,
    "exact complete 31f raw history from three retirements and four successors");
  return { record, historical };
}

/** Validates the full native result before returning historical metadata; actual strict status stays failed. */
export async function historicalIssue1018JsonDeletedStateReport(
  repoRoot: string, allowances: readonly AllowlistEntry[], report: Report,
) {
  const record = await verifiedSource(repoRoot, allowances);
  const current = record.currentInventory;
  check(report.schemaVersion === 1 && report.status === "failed" && isDeepStrictEqual(report.summary, current.summary)
    && ids(report.violations) === current.violationsIdsSha256 && metadata(report.violations) === current.violationsMetadataSha256
    && ids(report.unallowlisted) === current.unallowlistedIdsSha256
    && metadata(report.unallowlisted) === current.unallowlistedMetadataSha256
    && report.staleAllowances.length === 0 && report.metadataMismatches.length === 0 && report.allowlistGrowth.length === 0
    && report.relocations.length === 968 && metadata(report.relocations) === record.relocationsSha256,
  "complete current native IDs, metadata, aliases and allowance integrity");
  const permitted = new Set(allowances.map(({ id }) => id));
  check(isDeepStrictEqual(report.unallowlisted, report.violations.filter(({ id }) => !permitted.has(id)))
    && metadata(report.violations.filter(({ id }) => permitted.has(id)).map(({ id, file, rule, reason }) =>
      ({ id, file, rule, reason }))) === record.allowancesSha256, "exact current permission scope");
  const violations = historicalEntries(report.violations, record);
  const unallowlisted = historicalEntries(report.unallowlisted, record);
  const base = record.baseInventory;
  check(ids(violations) === base.violationsIdsSha256 && metadata(violations) === base.violationsMetadataSha256
    && ids(unallowlisted) === base.unallowlistedIdsSha256 && metadata(unallowlisted) === base.unallowlistedMetadataSha256,
  "exact complete 31f native history without licensing four active successors");
  return { ...report, violations, unallowlisted, summary: { ...base.summary } };
}
