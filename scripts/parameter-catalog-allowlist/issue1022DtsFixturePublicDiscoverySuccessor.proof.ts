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
type Endpoint = { endpoint: BoundaryViolation; sliceUtf8: string; sliceSha256: string;
  context: { start: number; end: number; sha256: string } };
export type Issue1022DtsFixtureRecord = {
  schemaVersion: number; baseHead: string; ownerHead: string; trustedBaseSha: string;
  source: { file: string; oldBlob: string; newBlob: string; oldBytes: number; newBytes: number;
    oldSHA256: string; newSHA256: string };
  changes: Array<{ oldStart: number; oldEnd: number; currentStart: number; currentEnd: number;
    oldSha256: string; currentSha256: string; oldUtf8: string; currentUtf8: string }>;
  anchors: Array<{ path: string; blob: string; bytes: number; sha256: string }>;
  oldReaderRecord: { path: string; sha256: string; readers: number };
  retired: Endpoint[]; pairs: Array<{ old: Endpoint; current: Endpoint }>;
  rawBase: { idsSha256: string; metadataSha256: string }; rawCurrent: { idsSha256: string; metadataSha256: string };
  baseInventory: Inventory; currentInventory: Inventory | null;
  allowancesSha256: string; allowanceOrderSha256: string; relocationsSha256: string;
};
export const issue1022DtsFixtureRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1022-dts-fixture-public-discovery-successor.json";
export const issue1022DtsFixtureSourceFile = "server/modules/dts-reload/testing/canonicalReloadFixture.ts";
const recordDigest = "24829f248952d716dce0fe2cadd56bd311380d353f18e2a713c32848969673fb";
const baseHead = "afb231c75c54e9fe9cdd8ba6f62c5a76721d13f7";
const ownerHead = "a06fe760af9b95444c2c9aba09d91ae2b7f1dfd5";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const ids = (entries: readonly { id: string }[]) => sha(entries.map(({ id }) => id).sort().join("\n"));
const metadata = (value: unknown) => sha(JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1022 DTS fixture public discovery successor rejected: ${detail}.`);
}

/** Every current entry proves the complete helper and its public seam before any historical bytes are returned. */
export async function verifyIssue1022DtsFixtureSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  const bytes = await readFile(join(repoRoot, issue1022DtsFixtureRecordPath));
  check(bytes.length <= 32_768 && sha(bytes) === recordDigest, "pinned public discovery record integrity");
  const record = JSON.parse(bytes.toString()) as Issue1022DtsFixtureRecord;
  check(record.schemaVersion === 1 && record.baseHead === baseHead && record.ownerHead === ownerHead
    && record.trustedBaseSha === "9b3ba7df7e21f5589684bc92c872da593ad4c246"
    && record.source.file === issue1022DtsFixtureSourceFile && record.changes.length === 3
    && record.retired.length === 2 && record.pairs.length === 6 && record.anchors.length === 12,
  "fixed input, two vanished queries, six still-unlicensed identities and twelve exact anchors");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  check(execFileSync("git", ["show", "-s", "--format=%P", ownerHead], { cwd: repoRoot, encoding: "utf8" }).trim()
    === baseHead, "sole fixed parent");
  const old = git(baseHead, record.source.file);
  const current = await readFile(join(repoRoot, record.source.file));
  check(blob(old) === record.source.oldBlob && old.length === record.source.oldBytes && sha(old) === record.source.oldSHA256
    && blob(current) === record.source.newBlob && current.length === record.source.newBytes
    && sha(current) === record.source.newSHA256 && git(ownerHead, record.source.file).equals(current),
  "unchanged public owner reader / destination whole-file blob, setup, exact cardinality, full pin and lifecycle");
  check(isDeepStrictEqual(record.changes.map(({ oldStart, oldEnd, currentStart, currentEnd }) =>
    [oldStart, oldEnd, currentStart, currentEnd]), [[374, 374, 374, 443], [1030, 1506, 1099, 1588], [13371, 14851, 13453, 14188]]),
  "only the complete trusted import, public typed imports and scoped post-sync discovery changed");
  let oldCursor = 0;
  let currentCursor = 0;
  for (const part of record.changes) {
    const before = old.subarray(part.oldStart, part.oldEnd);
    const after = current.subarray(part.currentStart, part.currentEnd);
    check(old.subarray(oldCursor, part.oldStart).equals(current.subarray(currentCursor, part.currentStart))
      && before.toString() === part.oldUtf8 && after.toString() === part.currentUtf8
      && sha(before) === part.oldSha256 && sha(after) === part.currentSha256,
    "byte-exact changed regions and unchanged intervening setup/auth/publication/audited sync");
    oldCursor = part.oldEnd;
    currentCursor = part.currentEnd;
  }
  check(old.subarray(oldCursor).equals(current.subarray(currentCursor)), "unchanged auth return and cleanup suffix");
  for (const anchor of record.anchors) {
    const content = await readFile(join(repoRoot, anchor.path));
    check(blob(content) === anchor.blob && content.length === anchor.bytes && sha(content) === anchor.sha256
      && git(baseHead, anchor.path).equals(content) && git(ownerHead, anchor.path).equals(content),
    "unchanged public owner reader, trusted invocation, typed pin and all six complete consumers");
  }
  check(metadata([...allowances].sort(order)) === record.allowancesSha256
    && metadata(allowances) === record.allowanceOrderSha256, "complete allowances and original load order; no growth");
  const originalBytes = await readFile(join(repoRoot, record.oldReaderRecord.path));
  check(record.oldReaderRecord.path === "scripts/fixtures/parameter-catalog-allowlist/issue-1020-promote-rollback-tip-read-successor.json"
    && record.oldReaderRecord.readers === 4 && record.oldReaderRecord.sha256 === "c43a09515d43750c3712fc515667e31ed4e7f272171e766bb6fe4f8eb6586617"
    && sha(originalBytes) === record.oldReaderRecord.sha256
    && git(baseHead, record.oldReaderRecord.path).equals(originalBytes), "immutable original four-reader #1020 record integrity");
  const original = JSON.parse(originalBytes.toString()) as { readers: Array<{ file: string; blob: string; byteCount: number; sha256: string }> };
  const reader = original.readers.find(({ file }) => file === record.source.file);
  check(original.readers.length === 4 && !!reader && reader.blob === record.source.oldBlob
    && reader.byteCount === old.length && reader.sha256 === sha(old), "exact old private helper reader, no #1019 anchor reinterpretation");
  const endpoints = [...record.retired, ...record.pairs.flatMap(({ old: before, current: after }) => [before, after])];
  check(new Set(endpoints.map(({ endpoint }) => endpoint.id)).size === 14, "complete distinct old/current endpoint partition");
  for (const { endpoint, sliceUtf8, sliceSha256, context } of endpoints) {
    const content = endpoint.trustedBlobOid === record.source.oldBlob ? old : current;
    const prefix = content.subarray(0, endpoint.byteStart).toString();
    const slice = content.subarray(endpoint.byteStart, endpoint.byteEnd);
    const occurrence = sha([endpoint.trustedBaseSha, endpoint.trustedBlobOid, String(endpoint.byteStart), String(endpoint.byteEnd),
      endpoint.token, endpoint.evidence, endpoint.file, endpoint.family, endpoint.rule].join("\0")).slice(0, 16);
    check(endpoint.file === record.source.file && endpoint.family === "S12-DTS" && endpoint.trustedBaseSha === record.trustedBaseSha
      && [record.source.oldBlob, record.source.newBlob].includes(endpoint.trustedBlobOid)
      && endpoint.line === prefix.split("\n").length && endpoint.column === prefix.length - prefix.lastIndexOf("\n")
      && endpoint.id.split(":").at(-1) === occurrence && slice.toString() === sliceUtf8 && sha(slice) === sliceSha256
      && context.start <= endpoint.byteStart && context.end >= endpoint.byteEnd
      && sha(content.subarray(context.start, context.end)) === context.sha256
      && !allowances.some(({ id }) => id === endpoint.id), "exact unlicensed source ID, blob, UTF8 slice/context and JS column");
  }
  check(record.retired.every(({ endpoint, sliceUtf8 }) => endpoint.trustedBlobOid === record.source.oldBlob
    && ["canonical-catalog-raw-access", "legacy-catalog-raw-read"].includes(endpoint.rule)
    && !current.includes(Buffer.from(sliceUtf8))), "two exact old queries absent, not newly permitted");
  for (const pair of record.pairs) {
    const before = pair.old.endpoint;
    const after = pair.current.endpoint;
    check(before.trustedBlobOid === record.source.oldBlob && after.trustedBlobOid === record.source.newBlob
      && ["forbidden-catalog-internal-import", "legacy-catalog-sql-write"].includes(before.rule)
      && before.id.split(":").slice(0, 3).join(":") === after.id.split(":").slice(0, 3).join(":")
      && before.rule === after.rule && before.token === after.token && before.reason === after.reason && before.evidence === after.evidence
      && pair.old.sliceUtf8 === pair.current.sliceUtf8 && pair.old.sliceSha256 === pair.current.sliceSha256,
    "six same-slice imports/writes remain present and unlicensed");
  }
  return { record, old };
}

/** Only this named private reader returns fixed afb bytes, after mandatory current proof; no other reader changes. */
export async function acceptedIssue1022DtsFixtureReaderSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  return (await verifyIssue1022DtsFixtureSource(repoRoot, allowances)).old;
}

function restoreEntries(entries: readonly BoundaryViolation[], record: Issue1022DtsFixtureRecord) {
  const oldByCurrent = new Map(record.pairs.map(({ old, current }) => [current.endpoint.id, old.endpoint]));
  return [...entries.map((entry) => ({ ...(oldByCurrent.get(entry.id) ?? entry) })),
    ...record.retired.map(({ endpoint }) => ({ ...endpoint }))].sort(order);
}

/** Same-tree complete raw scan first; named afb clone never replaces the scanner's actual entries. */
export async function historicalIssue1022DtsFixtureRaw(repoRoot: string, allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[]) {
  const { record } = await verifyIssue1022DtsFixtureSource(repoRoot, allowances);
  check(ids(discovered) === record.rawCurrent.idsSha256 && metadata(discovered) === record.rawCurrent.metadataSha256,
    "complete current raw IDs, order and metadata");
  const historical = restoreEntries(discovered, record);
  check(ids(historical) === record.rawBase.idsSha256 && metadata(historical) === record.rawBase.metadataSha256,
    "complete exact accepted afb raw history");
  return { record, historical };
}

/** Actual native inventory/status first; only six identities/two queries are restored in a local historical clone. */
export async function historicalIssue1022DtsFixtureReport(repoRoot: string, allowances: readonly AllowlistEntry[], report: Report) {
  const { record } = await verifyIssue1022DtsFixtureSource(repoRoot, allowances);
  const current = record.currentInventory;
  check(!!current && report.schemaVersion === 1 && report.status === "failed" && isDeepStrictEqual(report.summary, current.summary)
    && ids(report.violations) === current.violationsIdsSha256 && metadata(report.violations) === current.violationsMetadataSha256
    && ids(report.unallowlisted) === current.unallowlistedIdsSha256 && metadata(report.unallowlisted) === current.unallowlistedMetadataSha256
    && report.staleAllowances.length === 0 && report.metadataMismatches.length === 0 && report.allowlistGrowth.length === 0
    && report.relocations.length === 968 && metadata(report.relocations) === record.relocationsSha256,
  "complete current native IDs, order, metadata, aliases and status");
  const permitted = new Set(allowances.map(({ id }) => id));
  check(isDeepStrictEqual(report.unallowlisted, report.violations.filter(({ id }) => !permitted.has(id)))
    && metadata(report.violations.filter(({ id }) => permitted.has(id)).map(({ id, file, rule, reason }) =>
      ({ id, file, rule, reason }))) === record.allowancesSha256, "exact complete current permission scope");
  const violations = restoreEntries(report.violations, record);
  const unallowlisted = restoreEntries(report.unallowlisted, record);
  const base = record.baseInventory;
  check(ids(violations) === base.violationsIdsSha256 && metadata(violations) === base.violationsMetadataSha256
    && ids(unallowlisted) === base.unallowlistedIdsSha256 && metadata(unallowlisted) === base.unallowlistedMetadataSha256,
  "complete exact accepted afb native history");
  return { ...report, violations, unallowlisted, summary: { ...base.summary } };
}
