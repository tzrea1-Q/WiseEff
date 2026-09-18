import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadAllowlistIndex, loadBoundaryViolationFixture } from "./index";
import type { BoundaryViolation } from "./schema";

const repoRoot = resolve(import.meta.dirname, "../..");
const trustedBaseSha = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
const fixtureSha256 = "fe3cd2abe9181517332612938f00082db864d66f6f9b284d5f43b3051b5fe951";
const checkerPath = process.env.T14_CHECKER_JSON ?? "/tmp/t14-now.json";
const outPath = "scripts/fixtures/parameter-catalog-allowlist/t14-t22-family-successor-relocation.json";

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function blobOid(bytes: Buffer): string {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function anchor(id: string): string {
  return id.split(":").slice(0, 3).join(":");
}

function orderNew(violation: BoundaryViolation): BoundaryViolation {
  return {
    id: violation.id,
    family: violation.family,
    rule: violation.rule,
    file: violation.file,
    line: violation.line,
    column: violation.column,
    byteStart: violation.byteStart,
    byteEnd: violation.byteEnd,
    token: violation.token,
    evidence: violation.evidence,
    reason: violation.reason,
    trustedBaseSha: violation.trustedBaseSha,
    trustedBlobOid: violation.trustedBlobOid,
  };
}

const priorRecordPaths = [
  "scripts/fixtures/parameter-catalog-allowlist/runtime-topology-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/post-cutover-test-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/debugging-transfer-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/edit-service-version-index-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/property-key-cutover-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json",
  "scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json",
];

const priorOldIds = new Set<string>();
const priorNewIds = new Set<string>();
for (const path of priorRecordPaths) {
  const rec = JSON.parse(await readFile(resolve(repoRoot, path), "utf8")) as {
    files?: Array<{ pairs: Array<{ old: { id: string }; new: { id: string } }> }>;
    pairs?: Array<{ old: { id: string }; new: { id: string } }>;
  };
  const sections = rec.files ?? (rec.pairs ? [{ pairs: rec.pairs }] : []);
  for (const section of sections) {
    for (const pair of section.pairs) {
      priorOldIds.add(pair.old.id);
      priorNewIds.add(pair.new.id);
    }
  }
}

const coveredFiles = new Set([
  ...JSON.parse(
    await readFile(resolve(repoRoot, "scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json"), "utf8"),
  ).files.map((section: { file: string }) => section.file),
  ...JSON.parse(
    await readFile(
      resolve(repoRoot, "scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json"),
      "utf8",
    ),
  ).files.map((section: { file: string }) => section.file),
  "server/modules/parameter-specs/propertyKeyCutover.integration.test.ts",
]);

const raw = await readFile(checkerPath, "utf8");
const report = JSON.parse(raw.slice(raw.indexOf("{"))) as {
  unallowlisted: BoundaryViolation[];
  staleAllowances: Array<{ id: string; file: string }>;
};
const fixture = await loadBoundaryViolationFixture(repoRoot);
const allowlist = new Set((await loadAllowlistIndex(repoRoot)).entries.map((entry) => entry.id));
const baselineById = new Map(fixture.violations.map((entry) => [entry.id, entry]));
const unallowlisted = report.unallowlisted.filter(
  (entry) => !coveredFiles.has(entry.file) && !priorNewIds.has(entry.id) && !allowlist.has(entry.id),
);
const stale = report.staleAllowances.filter(
  (entry) => !coveredFiles.has(entry.file) && !priorOldIds.has(entry.id) && allowlist.has(entry.id),
);

const usedNew = new Set<string>();
const files = new Map<
  string,
  {
    file: string;
    sourceBlobOid: string;
    destinationBlobOid: string;
    pairs: Array<{ old: BoundaryViolation; new: BoundaryViolation; sliceSha256: string }>;
  }
>();

const staleSorted = stale
  .map((entry) => ({ entry, old: baselineById.get(entry.id) }))
  .filter((item): item is { entry: (typeof stale)[number]; old: BoundaryViolation } => item.old !== undefined)
  .sort((left, right) => left.old.file.localeCompare(right.old.file) || left.old.byteStart - right.old.byteStart);
const previousByAnchor = new Map<string, number>();

for (const { old } of staleSorted) {
  const source = execFileSync("git", ["show", `${trustedBaseSha}:${old.file}`], { cwd: repoRoot });
  const destination = await readFile(resolve(repoRoot, old.file));
  const destOid = blobOid(destination);
  const sourceOid = blobOid(source);
  if (destOid === sourceOid) continue;
  const oldBytes = source.subarray(old.byteStart, old.byteEnd);
  const orderKey = JSON.stringify([old.file, anchor(old.id), old.token, old.evidence, old.column]);
  const minStart = previousByAnchor.get(orderKey) ?? -1;
  const match = unallowlisted.find((entry) => {
    if (usedNew.has(entry.id)) return false;
    if (entry.file !== old.file) return false;
    if (anchor(entry.id) !== anchor(old.id)) return false;
    if (entry.token !== old.token) return false;
    if (entry.evidence !== old.evidence) return false;
    if (entry.column !== old.column) return false;
    if (entry.family !== old.family) return false;
    if (entry.rule !== old.rule) return false;
    if (entry.reason !== old.reason) return false;
    if (entry.trustedBlobOid !== destOid) return false;
    if (entry.byteStart <= minStart) return false;
    if (entry.id === old.id) return false;
    return destination.subarray(entry.byteStart, entry.byteEnd).equals(oldBytes);
  });
  if (!match) continue;
  usedNew.add(match.id);
  previousByAnchor.set(orderKey, match.byteStart);
  const section = files.get(old.file) ?? {
    file: old.file,
    sourceBlobOid: sourceOid,
    destinationBlobOid: destOid,
    pairs: [],
  };
  section.pairs.push({ old, new: orderNew(match), sliceSha256: sha256(oldBytes) });
  files.set(old.file, section);
}

const record = {
  schemaVersion: 1 as const,
  trustedBaseSha,
  fixtureSha256,
  files: [...files.values()].sort((left, right) => left.file.localeCompare(right.file)),
};
const serialized = `${JSON.stringify(record, null, 2)}\n`;
await writeFile(resolve(repoRoot, outPath), serialized);
process.stdout.write(
  `${JSON.stringify(
    {
      path: outPath,
      sha256: sha256(Buffer.from(serialized, "utf8")),
      files: record.files.map((section) => ({ file: section.file, pairs: section.pairs.length })),
      totalPairs: record.files.reduce((sum, section) => sum + section.pairs.length, 0),
      staleCandidates: stale.length,
      unallowlistedCandidates: unallowlisted.length,
    },
    null,
    2,
  )}\n`,
);
