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
export type Issue1017RetirementRecord = {
  schemaVersion: number; baseHead: string; ownerHead: string; trustedBaseSha: string;
  source: { file: string; oldBlob: string; currentBlob: string; oldByteCount: number; currentByteCount: number;
    oldSha256: string; currentSha256: string };
  helper: { file: string; blob: string; byteCount: number; sha256: string };
  retired: Array<{ old: BoundaryViolation; sourceSliceUtf8: string; sliceSha256: string;
    contextByteStart: number; contextByteEnd: number; contextUtf8: string; contextSha256: string }>;
  baseInventory: Inventory; currentInventory: Inventory; allowancesSha256: string; relocationsSha256: string;
  rawBase: { idsSha256: string; metadataSha256: string }; rawCurrent: { idsSha256: string; metadataSha256: string };
};
export const issue1017RetirementRecordPath = "scripts/fixtures/parameter-catalog-allowlist/issue-1017-approved-prepare-retirement.json";
const recordDigest = "acac09dcee8b0e1b8ef51581f9ee44b4f18fdb8dcf87dfe8aedea5505f89495b";
const baseHead = "bfaa2a3ccc745730675dbd4eba2713a819e22ee4";
const ownerHead = "d3f66f161c575853b9c52e4f67d4a1c4bd16dce9";
const sourceFile = "server/modules/parameter-files/canonicalApprovedPrepare.integration.test.ts";
const helperFile = "server/testing/parameterCatalog/driverSource.ts";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const blob = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const order = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const ids = (entries: readonly { id: string }[]) => sha(entries.map(({ id }) => id).sort().join("\n"));
// Exact metadata snapshots preserve array order while ignoring object property insertion order.
const metadata = (value: unknown) => sha(JSON.stringify(value, (_key, item: unknown) =>
  item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));
function check(ok: boolean, detail: string): asserts ok {
  if (!ok) throw new Error(`Issue #1017 approved prepare retirement rejected: ${detail}.`);
}

async function verifiedSource(repoRoot: string, allowances: readonly AllowlistEntry[]) {
  const bytes = await readFile(join(repoRoot, issue1017RetirementRecordPath));
  check(bytes.length <= 32_768 && sha(bytes) === recordDigest, "pinned eight-source record integrity");
  const record = JSON.parse(bytes.toString()) as Issue1017RetirementRecord;
  check(record.schemaVersion === 1 && record.baseHead === baseHead && record.ownerHead === ownerHead
    && record.trustedBaseSha === "9b3ba7df7e21f5589684bc92c872da593ad4c246"
    && record.source.file === sourceFile && record.helper.file === helperFile && record.retired.length === 8,
  "fixed owner inputs and exact retirement partition");
  const git = (rev: string, file: string) => execFileSync("git", ["show", `${rev}:${file}`], { cwd: repoRoot });
  check(execFileSync("git", ["show", "-s", "--format=%P", ownerHead], { cwd: repoRoot, encoding: "utf8" }).trim()
    === baseHead, "fixed sole parent");
  const old = git(baseHead, sourceFile);
  const current = await readFile(join(repoRoot, sourceFile));
  const helper = await readFile(join(repoRoot, helperFile));
  check(blob(old) === record.source.oldBlob && old.length === record.source.oldByteCount
    && sha(old) === record.source.oldSha256 && blob(current) === record.source.currentBlob
    && current.length === record.source.currentByteCount && sha(current) === record.source.currentSha256
    && git(ownerHead, sourceFile).equals(current), "whole-file approved fixture and all product assertions");
  check(blob(helper) === record.helper.blob && helper.length === record.helper.byteCount
    && sha(helper) === record.helper.sha256 && git(baseHead, helperFile).equals(helper)
    && git(ownerHead, helperFile).equals(helper), "unchanged public fixture owner contract");
  check(metadata([...allowances].sort(order)) === record.allowancesSha256, "unchanged complete allowances");
  const seen = new Set<string>();
  for (const item of record.retired) {
    const v = item.old;
    const slice = old.subarray(v.byteStart, v.byteEnd);
    const prefix = old.subarray(0, v.byteStart).toString();
    const context = old.subarray(item.contextByteStart, item.contextByteEnd);
    check(v.file === sourceFile && v.family === "S12-FIL" && v.trustedBlobOid === record.source.oldBlob
      && v.trustedBaseSha === record.trustedBaseSha && !seen.has(v.id)
      && !allowances.some(({ id }) => id === v.id), "exact unlicensed historical identity");
    check(v.byteStart >= 0 && v.byteEnd > v.byteStart && v.byteEnd <= old.length
      && v.line === prefix.split("\n").length && v.column === prefix.length - prefix.lastIndexOf("\n")
      && sha(slice) === item.sliceSha256 && slice.toString() === item.sourceSliceUtf8
      && item.contextByteStart <= v.byteStart && item.contextByteEnd >= v.byteEnd
      && item.contextByteStart >= 0 && item.contextByteEnd <= old.length
      && sha(context) === item.contextSha256 && context.toString() === item.contextUtf8,
    "exact old blob, source span, line, column and context");
    check(!current.includes(slice), "retired private import or SQL revived");
    seen.add(v.id);
  }
  return record;
}

/** Reuse #913's same-tree, same-trusted-base scan; this never scans or permits an observation. */
export async function verifyIssue1017RawRetirement(
  repoRoot: string, allowances: readonly AllowlistEntry[], discovered: readonly BoundaryViolation[],
) {
  const record = await verifiedSource(repoRoot, allowances);
  check(ids(discovered) === record.rawCurrent.idsSha256 && metadata(discovered) === record.rawCurrent.metadataSha256,
    "complete current raw IDs, order and metadata");
  check(!discovered.some(({ file }) => file === sourceFile), "complete retired consumer inventory");
  const historical = [...discovered, ...record.retired.map(({ old }) => old)].sort(order);
  check(ids(historical) === record.rawBase.idsSha256 && metadata(historical) === record.rawBase.metadataSha256,
    "complete baseline raw metadata minus only eight reviewed sources");
  return record;
}

/** Verified bfaa historical view only; the actual native report stays failed with 155 unallowed IDs. */
export async function historicalIssue1017ApprovedPrepareReport(
  repoRoot: string, allowances: readonly AllowlistEntry[], report: Report,
) {
  const record = await verifiedSource(repoRoot, allowances);
  const current = record.currentInventory;
  check(report.schemaVersion === 1 && report.status === "failed" && isDeepStrictEqual(report.summary, current.summary)
    && ids(report.violations) === current.violationsIdsSha256
    && metadata(report.violations) === current.violationsMetadataSha256
    && ids(report.unallowlisted) === current.unallowlistedIdsSha256
    && metadata(report.unallowlisted) === current.unallowlistedMetadataSha256
    && report.staleAllowances.length === 0 && report.metadataMismatches.length === 0 && report.allowlistGrowth.length === 0
    && report.relocations.length === 968 && metadata(report.relocations) === record.relocationsSha256,
  "complete current native IDs, metadata, aliases and allowance integrity");
  const permitted = new Set(allowances.map(({ id }) => id));
  check(isDeepStrictEqual(report.unallowlisted, report.violations.filter(({ id }) => !permitted.has(id)))
    && metadata(report.violations.filter(({ id }) => permitted.has(id)).map(({ id, file, rule, reason }) =>
      ({ id, file, rule, reason }))) === record.allowancesSha256, "exact current permission scope");
  const restore = (entries: BoundaryViolation[]) => [...entries, ...record.retired.map(({ old }) => ({ ...old }))].sort(order);
  const violations = restore(report.violations);
  const unallowlisted = restore(report.unallowlisted);
  const base = record.baseInventory;
  check(ids(violations) === base.violationsIdsSha256 && metadata(violations) === base.violationsMetadataSha256
    && ids(unallowlisted) === base.unallowlistedIdsSha256 && metadata(unallowlisted) === base.unallowlistedMetadataSha256,
  "complete bfaa historical metadata restored by exactly eight unlicensed sources");
  return { ...report, violations, unallowlisted, summary: { ...base.summary } };
}
