import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { legacyMappingSourceKinds } from "../../parameter-catalog-contract/legacyIdentifiers";
import { MAPPING_TARGET_KINDS } from "../../catalog-cutover/mapping";
import { COMPARISON_FAMILIES, COMPARISON_IDS, COMPARISON_RESULT_CLASSES, FAMILY_COMPARISON_IDS,
  checksumCanonicalBytes, compareComparisonCases, serializeCanonical } from "./corpusContributionSchema";
import { corpusRefusal } from "./errors";

const text = z.string().min(1);
const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const json: z.ZodType<Json> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite().refine((value) => !Object.is(value, -0)), z.string(), z.array(json), z.record(json),
]));
const reference = z.object({ kind: text, id: text }).strict();
const observation = z.discriminatedUnion("status", [
  z.object({ status: z.literal("value"), value: z.record(json) }).strict(),
  z.object({ status: z.literal("query-failure"), code: text, detail: text }).strict(),
]);
export const comparisonSourceIdentitySchema = z.object({
  legacyIdentityId: text, sourceSystem: text, sourceKind: z.enum(legacyMappingSourceKinds),
  ownerScopeKind: z.enum(["platform", "organization", "project"]), ownerScopeId: text, sourceId: text,
}).strict();
const differenceFields = {
  sourceIdentity: comparisonSourceIdentitySchema, rClass: z.enum(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]),
  mappingVersionId: text, headVersion: z.number().int().safe().positive(), headDigest: digest,
  ruleId: text, planPin: digest,
};
const expectedDifference = z.union([
  z.object({ ...differenceFields, typedTarget: z.object({ kind: z.enum(MAPPING_TARGET_KINDS), id: text }).strict() }).strict(),
  z.object({ ...differenceFields, Archive: z.object({ id: text }).strict() }).strict(),
]);
export const comparisonContextV2Schema = z.object({
  phase: z.enum(["pre-activation", "post-p13"]), inventoryMode: z.enum(["fresh", "populated"]),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/u), planPin: digest,
  mappingSnapshot: z.object({ epoch: digest, headDigest: digest }).strict(), catalogSnapshotChecksum: checksum,
}).strict();
const comparisonCase = z.object({
  caseId: text, comparisonId: z.enum(COMPARISON_IDS), protectedReference: reference,
  legacyObservation: observation, canonicalObservation: observation,
  result: z.enum(COMPARISON_RESULT_CLASSES), expectedDifference: expectedDifference.nullable(),
}).strict();
const contributionSchema = comparisonContextV2Schema.extend({
  contractVersion: z.literal("pcat-comparison-contribution/v2"), family: z.enum(COMPARISON_FAMILIES),
  sourceInventoryCount: z.number().int().safe().nonnegative(), sourceInventoryChecksum: checksum,
  cases: z.array(comparisonCase), checksum,
}).strict();
export type ComparisonSourceIdentity = z.infer<typeof comparisonSourceIdentitySchema>;
export type ComparisonContextV2 = z.infer<typeof comparisonContextV2Schema>;
export type ExpectedDifferenceV2 = z.infer<typeof expectedDifference>;
export type ComparisonCaseV2 = z.infer<typeof comparisonCase>;
export type ComparisonContributionV2 = z.infer<typeof contributionSchema>;

export function checksumComparisonContributionV2(value: Omit<ComparisonContributionV2, "checksum"> | ComparisonContributionV2) {
  const { checksum: _checksum, ...unsigned } = value as ComparisonContributionV2;
  return checksumCanonicalBytes(serializeCanonical(unsigned));
}

/** Closed bytes/integrity decoder only. The live owner separately establishes
 * snapshot membership, current typed disposition and the original P0 rule.
 * This entry neither upgrades v1 bytes nor issues comparison evidence.
 */
export function parseComparisonContributionV2(value: unknown, context: ComparisonContextV2): ComparisonContributionV2 {
  const result = contributionSchema.safeParse(value);
  const expected = comparisonContextV2Schema.safeParse(context);
  if (!result.success || !expected.success) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "invalid closed v2 contribution or context");
  const contribution = result.data;
  for (const key of Object.keys(expected.data) as (keyof ComparisonContextV2)[]) {
    if (!isDeepStrictEqual(contribution[key], expected.data[key])) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "v2 context mismatch");
  }
  if (checksumComparisonContributionV2(contribution) !== contribution.checksum) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "v2 checksum mismatch");
  const ids = new Set<string>(), refs = new Set<string>();
  for (let index = 0; index < contribution.cases.length; index++) {
    const item = contribution.cases[index]!;
    if (!(FAMILY_COMPARISON_IDS[contribution.family] as readonly string[]).includes(item.comparisonId)) throw corpusRefusal("PCAT-CMP-UNKNOWN-COMPARISON-ID", "v2 family gate mismatch");
    if (ids.has(item.caseId)) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "duplicate v2 case");
    ids.add(item.caseId); refs.add(JSON.stringify(item.protectedReference));
    if (index && compareComparisonCases(contribution.cases[index - 1]!, item) >= 0) throw corpusRefusal("PCAT-CMP-ORDER-DRIFT", "v2 case order mismatch");
    const failed = item.legacyObservation.status === "query-failure" || item.canonicalObservation.status === "query-failure";
    const equal = !failed && isDeepStrictEqual(item.legacyObservation, item.canonicalObservation);
    if (failed && item.result !== "unqueryable/protected-reference-missing" ||
      item.result === "unqueryable/protected-reference-missing" && !failed ||
      item.result === "exact-equivalent" && !equal ||
      item.result === "declared-expected-difference" && (equal || !item.expectedDifference || item.expectedDifference.planPin !== contribution.planPin) ||
      item.result !== "declared-expected-difference" && item.expectedDifference !== null) {
      throw corpusRefusal("PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE", "v2 observation classification mismatch");
    }
  }
  if (contribution.inventoryMode === "fresh" && (contribution.sourceInventoryCount || contribution.cases.length) ||
    refs.size !== contribution.sourceInventoryCount) throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "v2 protected inventory mismatch");
  return contribution;
}
