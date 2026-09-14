import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

import type { AllowlistEntry } from "./schema";
import { runReviewedRelocationRecord, type RelocationOutcome } from "./runtimeTopologyRelocation";
import type { BoundaryViolation, BoundaryViolationFixture } from "./schema";

/**
 * Reviewed relocation for Issue #846.
 *
 * The debugging catalog transfer feature had to add a route handler and repository
 * functions above four existing occurrences that the S12-DBG allowlist already covers:
 * two legacy 410 routes in `routes.ts` and two unresolved template-literal boundaries in
 * `catalogSplitRepository.ts`. The violations themselves are unchanged — the same route
 * literals and the same raw SQL expressions — but their byte offsets moved, and the file
 * blob identity changed, so the checker can no longer alias them by position alone.
 *
 * This record restates those four occurrences at their new positions plus the two
 * occurrences whose position is unchanged but whose reviewed blob identity moved. It adds
 * no new allowance: `validateRelocationRecord` requires every source id to be an existing
 * allowance and every destination id to be a current, previously unallowlisted occurrence
 * with a byte-identical slice.
 *
 * `recordSha256` is the digest of this exact JSON file. It is materialised here so the
 * record cannot authorize itself: a changed record fails `reviewed record integrity`
 * before any alias is granted. Independent review of the four position pairs and the two
 * identity pairs is what makes this file trustworthy.
 */
const trustedBaseSha = "9b3ba7df7e21f5589684bc92c872da593ad4c246";
const fixtureSha256 = "fe3cd2abe9181517332612938f00082db864d66f6f9b284d5f43b3051b5fe951";
const reviewedRecordSha256 = "d86b1800b92920ce6e7358d3843f5c92f99c4445bc8f052e2be1546cdf6de771";

export const debuggingTransferRelocationRecordPath =
  "scripts/fixtures/parameter-catalog-allowlist/debugging-transfer-relocation.json";

export const debuggingTransferRecordSha256 = reviewedRecordSha256;

const relocationSchema = z.object({
  schemaVersion: z.literal(1),
  trustedBaseSha: z.literal(trustedBaseSha),
  fixtureSha256: z.literal(fixtureSha256),
  files: z.array(z.object({
    file: z.string(),
    sourceBlobOid: z.string().regex(/^[a-f0-9]{40}$/u),
    destinationBlobOid: z.string().regex(/^[a-f0-9]{40}$/u),
    pairs: z.array(z.object({
      old: z.unknown(),
      new: z.unknown(),
      sliceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    }).strict()).length(2),
  }).strict()).length(2),
}).strict();

export type DebuggingTransferRelocationRecord = z.infer<typeof relocationSchema>;

/** The reviewed file inventory: two legacy routes, four unresolved boundary expressions. */
export const debuggingTransferRelocationFiles = [
  { file: "server/modules/debugging/routes.ts", pairs: 2 },
  { file: "server/modules/debugging/catalogSplitRepository.ts", pairs: 2 }
] as const;

export const debuggingTransferRelocationTotalPairs = 4;

export function reviewedRelocationRecordSha256() {
  return reviewedRecordSha256;
}

export async function readDebuggingTransferRelocationRecord(repoRoot: string) {
  const bytes = await readFile(resolve(repoRoot, debuggingTransferRelocationRecordPath));
  return JSON.parse(bytes.toString("utf8")) as DebuggingTransferRelocationRecord;
}

export function relocationRecordDigest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Applies the reviewed #846 relocation. Runs after the earlier reviewed records so the
 * cross-record overlap checks see every previously granted alias.
 */
export async function applyReviewedDebuggingTransferRelocation(
  repoRoot: string,
  fixture: BoundaryViolationFixture,
  allowances: readonly AllowlistEntry[],
  discovered: readonly BoundaryViolation[],
  existingRelocations: readonly { id: string; observed: BoundaryViolation }[] = []
): Promise<RelocationOutcome> {
  return runReviewedRelocationRecord(repoRoot, fixture, allowances, discovered, existingRelocations, {
    recordPath: debuggingTransferRelocationRecordPath,
    recordSha256: reviewedRecordSha256,
    files: debuggingTransferRelocationFiles,
    totalPairs: debuggingTransferRelocationTotalPairs,
    rejectAllowanceGrowth: true
  });
}
