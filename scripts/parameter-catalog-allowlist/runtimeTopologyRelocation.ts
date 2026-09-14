import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

import { boundaryViolationSchema, type AllowlistEntry, type BoundaryViolation, type BoundaryViolationFixture } from "./schema";

const trustedBaseSha = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
const fixtureSha256 = "fe3cd2abe9181517332612938f00082db864d66f6f9b284d5f43b3051b5fe951";
const reviewedRecordSha256 = "7c99527e2473aac06b64fc3e3db892d1b866843a8092bf39c058bdc5e81afaa2";
// Materialized from the independently accepted fixed 29-pair post-cutover proposal.
const postCutoverRecordSha256 = "9a68e55a93d17118275f71334dd5890ebdae5ad75582d6c9d590f6163134a647";
export const runtimeTopologyRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/runtime-topology-relocation.json";
export const postCutoverRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/post-cutover-test-relocation.json";

const ingestServiceFile = "server/modules/parameter-topology/ingestService.ts";
const schemasFile = "server/modules/parameter-topology/schemas.ts";
const fullGitShaSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const relocationPairSchema = z.object({
  old: boundaryViolationSchema,
  new: boundaryViolationSchema,
  sliceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
const relocationFileSchema = z.object({
  file: z.string(),
  sourceBlobOid: fullGitShaSchema,
  destinationBlobOid: fullGitShaSchema,
  pairs: z.array(relocationPairSchema),
}).strict();
const relocationSchema = z.object({
  schemaVersion: z.literal(1),
  trustedBaseSha: z.literal(trustedBaseSha),
  fixtureSha256: z.literal(fixtureSha256),
  files: z.array(relocationFileSchema),
}).strict();

export type RuntimeTopologyRelocationRecord = z.infer<typeof relocationSchema>;
export type RuntimeTopologyRelocation = {
  id: string;
  observed: BoundaryViolation;
};

type RelocationInput = {
  fixture: BoundaryViolationFixture;
  allowances: readonly AllowlistEntry[];
  discovered: readonly BoundaryViolation[];
  sourceByFile: ReadonlyMap<string, Buffer>;
  destinationByFile: ReadonlyMap<string, Buffer>;
  existingRelocations?: readonly RuntimeTopologyRelocation[];
};

export type RelocationConfig = {
  recordPath: string;
  recordSha256: string;
  files: readonly { file: string; pairs: number }[];
  totalPairs: number;
  rejectAllowanceGrowth?: boolean;
};

const runtimeTopologyConfig: RelocationConfig = {
  recordPath: runtimeTopologyRelocationRecordPath,
  recordSha256: reviewedRecordSha256,
  files: [
    { file: ingestServiceFile, pairs: 15 },
    { file: schemasFile, pairs: 1 },
  ],
  totalPairs: 16,
};

const postCutoverConfig: RelocationConfig = {
  recordPath: postCutoverRelocationRecordPath,
  recordSha256: postCutoverRecordSha256,
  files: [{ file: "server/modules/parameter-topology/postCutoverWorkflow.integration.test.ts", pairs: 29 }],
  totalPairs: 29,
  rejectAllowanceGrowth: true,
};

/** Validate the independently reviewed 16-pair identity map before granting any alias. */
export type RelocationOutcome = {
  violations: BoundaryViolation[];
  relocations: RuntimeTopologyRelocation[];
};

/** Validate the independently reviewed 16-pair identity map before granting any alias. */
export function validateRuntimeTopologyRelocation(value: unknown, input: RelocationInput) {
  return validateRelocationRecord(value, input, runtimeTopologyConfig);
}

/** Validate the independently reviewed 29-pair post-cutover identity map before granting any alias. */
export function validatePostCutoverRelocation(value: unknown, input: RelocationInput) {
  return validateRelocationRecord(value, input, postCutoverConfig);
}

function validateRelocationRecord(value: unknown, input: RelocationInput, config: RelocationConfig) {
  requireMatch(
    sha256(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8")) === config.recordSha256,
    "reviewed record integrity",
  );
  const record = relocationSchema.parse(value);
  requireMatch(input.fixture.trustedBaseSha === trustedBaseSha, "fixture base");

  for (const [index, expected] of config.files.entries()) {
    const section = record.files[index];
    requireMatch(section.file === expected.file && section.pairs.length === expected.pairs, "reviewed file inventory");
  }
  requireMatch(record.files.length === config.files.length, "reviewed file inventory");

  const baselineById = uniqueById(input.fixture.violations);
  const allowanceById = uniqueById(input.allowances);
  const discoveredById = uniqueById(input.discovered);
  if (config.rejectAllowanceGrowth) {
    for (const allowance of input.allowances) {
      const baseline = baselineById.get(allowance.id);
      requireMatch(baseline !== undefined && isDeepStrictEqual(allowance, {
        id: baseline.id,
        rule: baseline.rule,
        file: baseline.file,
        reason: baseline.reason,
      }), "allowance growth");
    }
  }
  const priorOldIds = new Set<string>();
  const priorObservedIds = new Set<string>();
  for (const relocation of input.existingRelocations ?? []) {
    requireMatch(!priorOldIds.has(relocation.id), "duplicate prior source mapping");
    requireMatch(!priorObservedIds.has(relocation.observed.id), "duplicate prior destination mapping");
    priorOldIds.add(relocation.id);
    priorObservedIds.add(relocation.observed.id);
  }
  requireMatch(
    [...priorOldIds].every((id) => !priorObservedIds.has(id)),
    "prior source and destination overlap",
  );

  const oldIds = new Set<string>();
  const newIds = new Set<string>();
  const pairs: RuntimeTopologyRelocationRecord["files"][number]["pairs"] = [];
  for (const section of record.files) {
    const source = input.sourceByFile.get(section.file);
    const destination = input.destinationByFile.get(section.file);
    requireMatch(source !== undefined && destination !== undefined, `missing source or destination bytes for ${section.file}`);
    requireMatch(blobOid(source) === section.sourceBlobOid, `source whole-file blob for ${section.file}`);
    requireMatch(blobOid(destination) === section.destinationBlobOid, `destination whole-file blob for ${section.file}`);

    for (const pair of section.pairs) {
      const old = pair.old;
      const next = pair.new;
      requireMatch(!oldIds.has(old.id) && !newIds.has(next.id), "duplicate mapping");
      requireMatch(!priorOldIds.has(old.id) && !priorObservedIds.has(old.id), "cross-record source mapping");
      requireMatch(!priorOldIds.has(next.id) && !priorObservedIds.has(next.id), "cross-record destination mapping");
      oldIds.add(old.id);
      newIds.add(next.id);

      requireMatch(isDeepStrictEqual(baselineById.get(old.id), old), "original occurrence");
      requireMatch(isDeepStrictEqual(discoveredById.get(next.id), next), "exact destination occurrence");
      requireMatch(!discoveredById.has(old.id) && !allowanceById.has(next.id), "unused mapping");
      requireMatch(isDeepStrictEqual(allowanceById.get(old.id), {
        id: old.id,
        rule: old.rule,
        file: old.file,
        reason: old.reason,
      }), "existing allowance");
      for (const key of ["file", "family", "rule", "reason", "token", "evidence", "column", "trustedBaseSha"] as const) {
        requireMatch(old[key] === next[key], `unchanged ${key}`);
      }
      requireMatch(old.file === section.file && next.file === section.file, "reviewed file");
      requireMatch(old.trustedBaseSha === trustedBaseSha && next.trustedBaseSha === trustedBaseSha, "trusted base");
      requireMatch(old.trustedBlobOid === section.sourceBlobOid, "source occurrence blob identity");
      requireMatch(next.trustedBlobOid === section.destinationBlobOid, "destination occurrence blob identity");
      requireMatch(old.byteEnd <= source.length && next.byteEnd <= destination.length, "slice bounds");
      const oldBytes = source.subarray(old.byteStart, old.byteEnd);
      const nextBytes = destination.subarray(next.byteStart, next.byteEnd);
      requireMatch(oldBytes.equals(nextBytes) && sha256(oldBytes) === pair.sliceSha256, "identical raw slice");
      pairs.push(pair);
    }
  }
  requireMatch(oldIds.size === config.totalPairs && newIds.size === config.totalPairs, "complete reviewed mapping");
  requireMatch([...oldIds].every((id) => !newIds.has(id)), "source and destination overlap");
  return pairs;
}

/** Called after the original 23-pair relocation and all trusted-parent checks. */
export async function applyReviewedRuntimeTopologyRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, runtimeTopologyConfig);
}

export async function applyReviewedPostCutoverRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[] = [],
) {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, postCutoverConfig);
}

/**
 * Shared runner for a reviewed relocation record: validates every pair against the fixture,
 * the current scan and the existing allowances, then aliases each new occurrence back to its
 * reviewed source id. Sibling records (for example the Issue #846 debugging relocation)
 * register a `RelocationConfig` and call this instead of re-implementing the checks.
 */
export async function runReviewedRelocationRecord(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[],
  config: RelocationConfig,
): Promise<RelocationOutcome> {
  return applyRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, config);
}

async function applyRelocationRecord(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly RuntimeTopologyRelocation[],
  config: RelocationConfig,
): Promise<RelocationOutcome> {
  const targetFiles = new Set<string>(config.files.map(({ file }) => file));
  if (!fixture.violations.some((violation) => targetFiles.has(violation.file))) {
    return { violations: [...discovered], relocations: [] as RuntimeTopologyRelocation[] };
  }

  const bytes = await readFile(resolve(repoRoot, config.recordPath));
  requireMatch(sha256(bytes) === config.recordSha256, "reviewed record integrity");
  const value = JSON.parse(bytes.toString("utf8"));
  const record = relocationSchema.parse(value) as RuntimeTopologyRelocationRecord;
  const sourceByFile = new Map<string, Buffer>();
  const destinationByFile = new Map<string, Buffer>();
  for (const section of record.files) {
    sourceByFile.set(
      section.file,
      execFileSync("git", ["show", `${record.trustedBaseSha}:${section.file}`], { cwd: repoRoot }),
    );
    destinationByFile.set(section.file, await readFile(resolve(repoRoot, section.file)));
  }
  const pairs = validateRelocationRecord(value, {
    fixture,
    allowances,
    discovered,
    sourceByFile,
    destinationByFile,
    existingRelocations,
  }, config);
  const aliases = new Map(pairs.map((pair) => [pair.new.id, pair.old]));
  return {
    violations: discovered.map((violation) => aliases.get(violation.id) ?? violation),
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
  if (!matches) throw new Error(`Runtime topology relocation rejected: ${invariant}.`);
}
