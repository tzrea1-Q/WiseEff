import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { checkParameterCatalogBoundaries } from "../check-parameter-catalog-boundaries";
import type { AllowlistEntry, BoundaryViolation, BoundaryViolationFixture } from "./schema";
import { acceptedIssue1022DtsFixtureReaderSource, issue1022DtsFixtureSourceFile } from "./issue1022DtsFixturePublicDiscoverySuccessor.proof";

type Report = Awaited<ReturnType<typeof checkParameterCatalogBoundaries>>;
type Inventory = { summary: Report["summary"]; violationsIdsSha256: string; violationsMetadataSha256: string;
  unallowlistedIdsSha256: string; unallowlistedMetadataSha256: string };
export type Issue1020ReadSuccessorRecord = {
  schemaVersion: number; baseHead: string; ownerHead: string; trustedBaseSha: string;
  source: { file: string; oldBlob: string; currentBlob: string; oldByteCount: number; currentByteCount: number;
    oldSha256: string; currentSha256: string };
  readers: Array<{ file: string; blob: string; byteCount: number; sha256: string }>;
  changes: Array<{ oldStart: number; oldEnd: number; currentStart: number; currentEnd: number;
    oldSha256: string; currentSha256: string }>; unchangedRegionsSha256: string[];
  retired: BoundaryViolation[];
  oldCRecord: { file: string; sha256: string; files: number; total: number; promote: number;
    sourceBlob: string; destinationBlob: string };
  spans: Array<{ oldStart: number; oldEnd: number; sliceUtf8: string; sliceSha256: string; oldContextStart: number; oldContextEnd: number;
    contextUtf8: string; contextSha256: string }>;
  baseInventory: Inventory; currentInventory: Inventory; allowancesSha256: string; relocationsSha256: string;
  rawBase: { idsSha256: string; metadataSha256: string }; rawCurrent: { idsSha256: string; metadataSha256: string };
};
export const issue1020ReadSuccessorRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1020-promote-rollback-tip-read-successor.json";
const recordDigest = "c43a09515d43750c3712fc515667e31ed4e7f272171e766bb6fe4f8eb6586617";
const baseHead = "1e442e14fcbf38cb076a342fffb510c12a80aed1";
const ownerHead = "eafb5a1579ff56cd659bd31390afe44c1f340a16";
const sourceFile = "server/modules/dts-reload/promote.test.ts";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const ids = (entries: readonly { id: string }[]) => sha(entries.map(({ id }) => id).sort().join("\n"));
const metadata = (value: unknown) => sha(JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1020 promote rollback-tip successor rejected: ${detail}.`);
}

async function verifiedSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  const bytes = await readFile(join(repoRoot, issue1020ReadSuccessorRecordPath));
  check(bytes.length <= 32_768 && sha(bytes) === recordDigest, "pinned two-tag retirement/current-source record integrity");
  const record = JSON.parse(bytes.toString()) as Issue1020ReadSuccessorRecord;
  check(record.schemaVersion === 1 && record.baseHead === baseHead && record.ownerHead === ownerHead
    && record.trustedBaseSha === "9b3ba7df7e21f5589684bc92c872da593ad4c246" && record.source.file === sourceFile
    && record.retired.length === 2 && record.spans.length === 1 && record.readers.length === 4,
  "fixed owner inputs and exact source partition");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  check(execFileSync("git", ["show", "-s", "--format=%P", ownerHead], { cwd: repoRoot, encoding: "utf8" }).trim()
    === baseHead, "fixed sole parent");
  const old = git(baseHead, sourceFile);
  const current = await readFile(join(repoRoot, sourceFile));
  check(blob(old) === record.source.oldBlob && old.length === record.source.oldByteCount && sha(old) === record.source.oldSha256
    && blob(current) === record.source.currentBlob && current.length === record.source.currentByteCount
    && sha(current) === record.source.currentSha256 && git(ownerHead, sourceFile).equals(current),
  "whole-file DTS fixture, ten cases, audit rollback guards, whole cardinality and lifecycle");
  check(isDeepStrictEqual(record.changes.map(({ oldStart, oldEnd, currentStart, currentEnd }) =>
    ({ oldStart, oldEnd, currentStart, currentEnd })), [
    { oldStart: 875, oldEnd: 875, currentStart: 875, currentEnd: 947 },
    { oldStart: 13000, oldEnd: 13224, currentStart: 13072, currentEnd: 13426 },
  ]) && old.subarray(0, 875).equals(current.subarray(0, 875))
    && old.subarray(875, 13000).equals(current.subarray(947, 13072))
    && old.subarray(13224).equals(current.subarray(13426))
    && isDeepStrictEqual([sha(old.subarray(0, 875)), sha(old.subarray(875, 13000)), sha(old.subarray(13224))],
      record.unchangedRegionsSha256)
    && record.changes.every((part) => sha(old.subarray(part.oldStart, part.oldEnd)) === part.oldSha256
      && sha(current.subarray(part.currentStart, part.currentEnd)) === part.currentSha256),
  "only the complete public import and scoped current-tip helper changed");
  for (const reader of record.readers) {
    const content = reader.file === issue1022DtsFixtureSourceFile
      ? await acceptedIssue1022DtsFixtureReaderSource(repoRoot, allowances)
      : await readFile(join(repoRoot, reader.file));
    check(blob(content) === reader.blob && content.length === reader.byteCount && sha(content) === reader.sha256
      && git(baseHead, reader.file).equals(content) && git(ownerHead, reader.file).equals(content),
    "unchanged public owner reader bytes");
  }
  check(metadata([...allowances].sort(order)) === record.allowancesSha256, "unchanged complete allowances");
  const seen = new Set<string>();
  for (const endpoint of record.retired) {
    const span = record.spans[0]!;
    check(endpoint.trustedBlobOid === record.source.oldBlob && endpoint.file === sourceFile
      && endpoint.family === "S12-DTS" && endpoint.trustedBaseSha === record.trustedBaseSha
      && !seen.has(endpoint.id) && !allowances.some(({ id }) => id === endpoint.id), "exact two unlicensed endpoints");
    const prefix = old.subarray(0, endpoint.byteStart).toString();
    const slice = old.subarray(endpoint.byteStart, endpoint.byteEnd);
    check(endpoint.byteStart === span.oldStart && endpoint.byteEnd === span.oldEnd
      && endpoint.line === prefix.split("\n").length && endpoint.column === prefix.length - prefix.lastIndexOf("\n")
      && slice.toString() === span.sliceUtf8 && sha(slice) === span.sliceSha256,
    "exact endpoint blob, span, line, column and slice");
    const context = old.subarray(span.oldContextStart, span.oldContextEnd);
    check(context.toString() === span.contextUtf8 && sha(context) === span.contextSha256
      && endpoint.byteStart >= 13000 && endpoint.byteEnd <= 13224 && !current.includes(slice),
    "exact endpoint context and vanished rollback-tip SQL");
    seen.add(endpoint.id);
  }
  return record;
}

function historicalEntries(entries: readonly BoundaryViolation[], record: Issue1020ReadSuccessorRecord) {
  return [...entries.map((entry) => ({ ...entry })), ...record.retired.map((entry) => ({ ...entry }))].sort(order);
}

/** Current source first; return accepted old bytes solely for the unchanged six-file/42-source C proof. */
export async function acceptedIssue1020PromoteRemainderSource(
  repoRoot: string, fixture: BoundaryViolationFixture, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  const record = await verifiedSource(repoRoot, allowances);
  const historic = record.oldCRecord;
  const bytes = await readFile(join(repoRoot, historic.file));
  check(historic.file === "scripts/fixtures/parameter-catalog-allowlist/issue-853-c-remainder-retired.json"
    && historic.sha256 === "3b00dbbf9ffe8ec945e15fd734669e6442fda3eaf7acfa915ec4607b112fd00a"
    && sha(bytes) === historic.sha256, "immutable original C retirement record");
  const original = JSON.parse(bytes.toString()) as { schemaVersion: number; trustedBaseSha: string;
    files: Array<{ file: string; sourceBlobOid: string; destinationBlobOid: string; retiredIds: string[] }> };
  const section = original.files.find(({ file }) => file === sourceFile);
  check(original.schemaVersion === 1 && original.trustedBaseSha === fixture.trustedBaseSha
    && fixture.trustedBaseSha === record.trustedBaseSha && original.files.length === 6
    && original.files.flatMap(({ retiredIds }) => retiredIds).length === 42 && !!section
    && section.retiredIds.length === 7 && section.sourceBlobOid === historic.sourceBlob
    && section.destinationBlobOid === record.source.oldBlob && section.destinationBlobOid === historic.destinationBlob,
  "original 42/seven history and accepted destination");
  const source = execFileSync("git", ["show", `${fixture.trustedBaseSha}:${sourceFile}`], { cwd: repoRoot });
  const current = await readFile(join(repoRoot, sourceFile));
  check(blob(source) === historic.sourceBlob && !discovered.some(({ file }) => file === sourceFile)
    && !discovered.some(({ id }) => record.retired.some((old) => old.id === id)),
  "no revived promote observation");
  for (const id of section.retiredIds) {
    const old = fixture.violations.find((entry) => entry.id === id);
    check(!!old && old.file === sourceFile && old.trustedBlobOid === historic.sourceBlob
      && !allowances.some((entry) => entry.id === id) && !discovered.some((entry) => entry.id === id)
      && !current.includes(source.subarray(old.byteStart, old.byteEnd)), "original seven sources remain vanished and unlicensed");
  }
  return execFileSync("git", ["show", `${baseHead}:${sourceFile}`], { cwd: repoRoot });
}

/** Same-tree raw scan only; the returned 1e view is local to the unchanged #1019 historical checks. */
export async function historicalIssue1020PromoteRollbackTipRaw(
  repoRoot: string, allowances: readonly AllowlistEntry[], discovered: readonly BoundaryViolation[],
) {
  const record = await verifiedSource(repoRoot, allowances);
  check(ids(discovered) === record.rawCurrent.idsSha256 && metadata(discovered) === record.rawCurrent.metadataSha256,
    "complete current raw IDs, order and metadata");
  const historical = historicalEntries(discovered, record);
  check(ids(historical) === record.rawBase.idsSha256 && metadata(historical) === record.rawBase.metadataSha256,
    "exact complete 1e raw history from two retired tags");
  return { record, historical };
}

/** Validates the full native result before returning historical metadata; actual strict status stays failed. */
export async function historicalIssue1020PromoteRollbackTipReport(
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
  "exact complete 1e native history without granting permission");
  return { ...report, violations, unallowlisted, summary: { ...base.summary } };
}
