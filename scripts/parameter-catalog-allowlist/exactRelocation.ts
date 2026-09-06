import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { boundaryViolationSchema, type AllowlistEntry, type BoundaryViolation, type BoundaryViolationFixture } from "./schema";

const file = "server/modules/parameter-specs/propertyKeyCutover.integration.test.ts";
const originalBase = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
export const exactRelocationRecordPath = "scripts/fixtures/parameter-catalog-allowlist/property-key-cutover-relocation.json";
// Materialized after independent Standards/Spec review of 164b832f543433564b3f5cd75d6b9445a7b9bb8d.
// Both reviewers independently verified this digest; the JSON cannot authorize itself.
const reviewedRecordSha256 = "fe2a8aa3e97193c98aafdfd06572335419e2e53854e80b33e172afa0e741e074";

const relocationSchema = z.object({
  schemaVersion: z.literal(1),
  file: z.literal(file),
  trustedBaseSha: z.literal(originalBase),
  fixtureSha256: z.literal("fe3cd2abe9181517332612938f00082db864d66f6f9b284d5f43b3051b5fe951"),
  sourceBlobOid: z.literal("dd0168f369b615f45eeb1e5539557fb63967e1dd"),
  destinationBlobOid: z.literal("1854772393388a8778b27594d2789b8635bfa3de"),
  pairs: z.array(z.object({
    old: boundaryViolationSchema,
    new: boundaryViolationSchema,
    sliceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }).strict()).length(23),
}).strict();

type RelocationInput = {
  fixture: BoundaryViolationFixture;
  allowances: readonly AllowlistEntry[];
  discovered: readonly BoundaryViolation[];
  source: Buffer;
  destination: Buffer;
};

/** Validate every pair before granting any alias. No SQL normalization or search. */
export function validateExactRelocation(value: unknown, input: RelocationInput) {
  const record = relocationSchema.parse(value);
  requireMatch(input.fixture.trustedBaseSha === originalBase, "fixture base");
  requireMatch(blobOid(input.source) === record.sourceBlobOid, "source whole-file blob");
  requireMatch(blobOid(input.destination) === record.destinationBlobOid, "destination whole-file blob");
  const baselineById = uniqueById(input.fixture.violations);
  const allowanceById = uniqueById(input.allowances);
  const discoveredById = uniqueById(input.discovered);
  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  for (const pair of record.pairs) {
    const old = pair.old;
    const next = pair.new;
    requireMatch(!oldIds.has(old.id) && !newIds.has(next.id), "duplicate mapping");
    oldIds.add(old.id);
    newIds.add(next.id);
    requireMatch(isDeepStrictEqual(baselineById.get(old.id), old), "original occurrence");
    requireMatch(isDeepStrictEqual(discoveredById.get(next.id), next), "exact destination occurrence");
    requireMatch(!discoveredById.has(old.id) && !allowanceById.has(next.id), "unused mapping");
    requireMatch(isDeepStrictEqual(allowanceById.get(old.id), {
      id: old.id, rule: old.rule, file: old.file, reason: old.reason,
    }), "existing allowance");
    for (const key of ["file", "family", "rule", "reason", "token", "evidence", "column", "trustedBaseSha"] as const) {
      requireMatch(old[key] === next[key], `unchanged ${key}`);
    }
    requireMatch(old.file === file && old.trustedBaseSha === originalBase, "file and trusted base");
    requireMatch(old.trustedBlobOid === record.sourceBlobOid && next.trustedBlobOid === record.destinationBlobOid, "occurrence blob identity");
    requireMatch(next.byteStart - old.byteStart === 216 && next.byteEnd - old.byteEnd === 216 && next.line - old.line === 5, "reviewed position pair");
    requireMatch(old.byteEnd <= input.source.length && next.byteEnd <= input.destination.length, "slice bounds");
    const oldBytes = input.source.subarray(old.byteStart, old.byteEnd);
    const nextBytes = input.destination.subarray(next.byteStart, next.byteEnd);
    requireMatch(oldBytes.equals(nextBytes) && sha256(oldBytes) === pair.sliceSha256, "identical raw slice");
  }
  return record.pairs;
}

/** Called only after the original fixture and Git ancestry checks succeeded. */
export async function applyReviewedExactRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
) {
  // Synthetic inventories do not carry this original file/identity contract.
  if (!fixture.violations.some((violation) => violation.file === file)) {
    return { violations: discovered, relocations: [] };
  }
  const bytes = await readFile(resolve(repoRoot, exactRelocationRecordPath));
  requireMatch(sha256(bytes) === reviewedRecordSha256, "reviewed record integrity");
  const [destination, source] = await Promise.all([
    readFile(resolve(repoRoot, file)),
    Promise.resolve().then(() => execFileSync("git", ["show", `${originalBase}:${file}`], { cwd: repoRoot })),
  ]);
  const pairs = validateExactRelocation(JSON.parse(bytes.toString("utf8")), {
    fixture, allowances, discovered, source, destination,
  });
  const aliases = new Map(pairs.map((pair) => [pair.new.id, pair.old]));
  return {
    violations: discovered.map((violation) => aliases.get(violation.id) ?? violation),
    // Identity metadata stays historical; expose actual locations explicitly.
    relocations: pairs.map((pair) => ({ id: pair.old.id, observed: pair.new })),
  };
}

function uniqueById<T extends { id: string }>(values: readonly T[]) {
  const result = new Map(values.map((value) => [value.id, value]));
  requireMatch(result.size === values.length, "duplicate occurrence or allowance");
  return result;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function blobOid(bytes: Buffer) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function requireMatch(matches: boolean, invariant: string): asserts matches {
  if (!matches) throw new Error(`Exact Catalog relocation rejected: ${invariant}.`);
}
