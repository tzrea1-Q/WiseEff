import { digestOf } from "../release-verification/core/digest";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type pg from "pg";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "./classifier";
import { comparisonInventorySummary, readCapturedComparisonInventory, type CapturedComparisonInventory } from "../release-verification/comparison/planInventory";
import { COMPARISON_FAMILIES, COMPARISON_IDS, FAMILY_COMPARISON_IDS, type ComparisonId } from "../release-verification/comparison/corpusContributionSchema";
import { capturePhysicalSourceIdentities, type MappingSourceIdentity, type MappingQueryable } from "./mapping";
import { comparisonSourceIdentitySchema } from "../release-verification/comparison/corpusContributionV2";
import { MIGRATION_CONTRACT_VERSION, PRE_ACTIVATION_PHASES, type CutoverPlan } from "./interface";

/** Source-only P0 graph. No canonical Catalog, mapping outcome, comparison
 * result or caller graph supplies these fields. The root retains the actual
 * source/metadata locks while this owner reads every row and plans its rules.
 */
export async function captureComparisonP0Graph(client: MappingQueryable, sourceSystem: string): Promise<FrozenP0Graph> {
  const rows = async <T extends pg.QueryResultRow>(sql: string): Promise<readonly T[]> => structuredClone((await client.query<T>(sql)).rows);
  const identities = (await capturePhysicalSourceIdentities({ client, sourceSystem })).map(({ legacyIdentityId, ...identity }) => ({ id: legacyIdentityId, ...identity }));
  const graph: FrozenP0Graph = {
    catalog: "parameter-catalog-p0-graph", identities,
    specs: await rows(`select id,organization_id as "organizationId",source_kind as "sourceKind",specification_key as "specificationKey",
      attribution_subject_id as "attributionSubjectId",definition_lifecycle as "definitionLifecycle",property_key as "propertyKey" from public.parameter_specs order by id collate "C"`),
    specVersions: await rows(`select id,parameter_spec_id as "parameterSpecId",version,lifecycle,version_status as "versionStatus" from public.parameter_spec_versions order by id collate "C"`),
    subjects: await rows(`select id,organization_id as "organizationId",subject_kind as "subjectKind" from public.attribution_subjects order by id collate "C"`),
    driverRegistrations: await rows(`select attribution_subject_id as "attributionSubjectId" from public.driver_registrations order by attribution_subject_id collate "C"`),
    nodeTypeDefinitions: await rows(`select attribution_subject_id as "attributionSubjectId" from public.node_type_definitions order by attribution_subject_id collate "C"`),
    driverSchemas: await rows(`select id,parameter_spec_id as "parameterSpecId",organization_id as "organizationId",attribution_subject_id as "attributionSubjectId" from public.driver_schemas order by id collate "C"`),
    driverSchemaVersions: await rows(`select id,driver_schema_id as "driverSchemaId",lifecycle from public.driver_schema_versions order by id collate "C"`),
    dtsPropertySpecs: await rows(`select id,parameter_spec_id as "parameterSpecId",driver_schema_id as "driverSchemaId",property_key as "propertyKey" from public.dts_property_specs order by id collate "C"`),
    modules: await rows(`select id,organization_id as "organizationId",kind,origin,name,attribution_subject_id as "attributionSubjectId" from public.parameter_modules order by id collate "C"`),
    placements: await rows(`select id,organization_id as "organizationId",attribution_subject_id as "attributionSubjectId",driver_group_module_id as "driverGroupModuleId" from public.driver_registration_placements order by id collate "C"`),
    bindings: await rows(`select id,organization_id as "organizationId",parameter_spec_id as "parameterSpecId",module_id as "moduleId" from public.project_parameter_bindings order by id collate "C"`),
    bindingRevisions: await rows(`select id,binding_id as "bindingId",parameter_spec_version_id as "parameterSpecVersionId" from public.project_parameter_binding_revisions order by id collate "C"`),
  };
  const classified = classifyFrozenP0Graph(graph);
  if (!classified.ok) throw new Error("PCAT-CMP-P0-SOURCE-GRAPH-INVALID");
  return structuredClone(graph);
}

/** These are the nine existing semantic assertions, not classification rules
 * or new permitted losses. A disposition may change; every protected fact
 * named by its D assertion must still be preserved by the two real readers. */
const assertions = {
  "PCAT-CMP-D01-DEFINITION-SEMANTICS": "definition-membership-owner-lifecycle-revision",
  "PCAT-CMP-D02-SUBJECT-IDENTITY": "subject-selector-definition-identity",
  "PCAT-CMP-D03-REGISTRATION-PLACEMENT": "registration-placement-organization-parent-kind",
  "PCAT-CMP-D04-BINDING-HISTORY": "binding-owner-current-tip-ordered-history",
  "PCAT-CMP-D05-PROJECT-VALUE-PIN": "value-identity-exact-revision-shape-units-policy",
  "PCAT-CMP-D06-REVIEW-PROPOSAL-OBSERVATION": "unique-review-proposal-observation-or-archive",
  "PCAT-CMP-D07-PROTECTED-CONSUMER-REFERENCE": "exact-protected-reference-and-pin",
  "PCAT-CMP-D08-SOURCE-WRITEBACK": "source-occurrence-locator-revision-format-provenance",
  "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME": "typed-legacy-status-and-operator-outcome",
} as const satisfies Record<ComparisonId, string>;

export type ComparisonP0Rules = ReturnType<typeof produceComparisonP0Rules>;

/** Called by planCutover, before P0 is committed and before either semantic
 * reader runs. The inventory is the original owner-issued read, never rows or
 * rules supplied in a Comparison contribution. Future mappings cannot select
 * an R class, invent a rule, or change this selection after seeing a result.
 */
export function produceComparisonP0Rules(graph: FrozenP0Graph, selection: CapturedComparisonInventory) {
  const inventory = readCapturedComparisonInventory(selection);
  if (fingerprintP0Graph(graph) !== fingerprintP0Graph(inventory.graph)) throw new Error("PCAT-CMP-P0-SOURCE-GRAPH-DRIFT");
  const summary = comparisonInventorySummary(selection);
  const classified = classifyFrozenP0Graph(graph);
  if (!classified.ok || classified.value.blockers.length) throw new Error("PCAT-CMP-P0-CLASSIFICATION-UNAVAILABLE");
  const identities = graph.identities.map(identity => {
    const assignment = classified.value.assignments.filter(row => row.identityId === identity.id);
    if (assignment.length !== 1) throw new Error("PCAT-CMP-P0-IDENTITY-UNAVAILABLE");
    const { id, ...source } = identity;
    const sourceIdentity: MappingSourceIdentity = { legacyIdentityId: id, ...source };
    return { sourceIdentity, assignment: assignment[0]! };
  });
  const cases = COMPARISON_FAMILIES.flatMap(family => inventory.source[family].flatMap(record => {
    // The consumer supplies its actual relation's source references. A missing
    // association remains explicit and cannot produce expected-difference
    // evidence. Native/unchanged facts can still be compared for exact equality.
    const references = record.sourceReferences;
    const sources = Array.isArray(references) ? references.map((reference: unknown) => {
      if (!reference || typeof reference !== "object") throw new Error("PCAT-CMP-P0-IDENTITY-UNAVAILABLE");
      const key = reference as Partial<MappingSourceIdentity>;
      const matches = identities.filter(({ sourceIdentity }) => sourceIdentity.legacyIdentityId === key.legacyIdentityId &&
        sourceIdentity.sourceSystem === key.sourceSystem && sourceIdentity.sourceKind === key.sourceKind &&
        sourceIdentity.sourceId === key.sourceId && sourceIdentity.ownerScopeKind === key.ownerScopeKind &&
        sourceIdentity.ownerScopeId === key.ownerScopeId);
      if (matches.length !== 1) throw new Error("PCAT-CMP-P0-IDENTITY-UNAVAILABLE");
      return matches[0]!;
    }) : [];
    if (new Set(sources.map(row => row.sourceIdentity.legacyIdentityId)).size !== sources.length) throw new Error("PCAT-CMP-P0-IDENTITY-UNAVAILABLE");
    return record.applicable.map(comparisonId => {
      const basis = { family, comparisonId, protectedReference: { kind: record.kind, id: record.id },
        inputChecksum: digestOf(record), semanticAssertion: assertions[comparisonId],
        identities: sources.map(({ sourceIdentity, assignment }) => ({ sourceIdentity,
          rClass: assignment.rClass, classificationRuleId: assignment.ruleId, disposition: assignment.disposition,
        })).sort((a, b) => a.sourceIdentity.legacyIdentityId < b.sourceIdentity.legacyIdentityId ? -1 : 1),
      };
      return { ...basis, ruleId: `PCAT-P0-COMPARISON:${digestOf(basis)}` };
    });
  }));
  const rules = { version: "pcat-comparison-p0-rules/v2" as const,
    sourceSnapshotFingerprint: fingerprintP0Graph(graph), inventory: summary, cases };
  return { ...rules, digest: digestOf(rules) };
}

/** The original plan hashing order. Do not canonicalize this historical
 * JSON.stringify codec or replace its nested original input bytes. */
export function comparisonPlanDigest(plan: Omit<CutoverPlan, "planDigest">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify({
    sourceSnapshotFingerprint: plan.sourceSnapshotFingerprint,
    targetArtifactSha: plan.targetArtifactSha,
    targetCatalogReleaseDigest: plan.targetCatalogReleaseDigest,
    migrationContractVersion: plan.migrationContractVersion,
    phases: plan.phases,
    ...(plan.comparisonRules ? { comparisonRulesDigest: plan.comparisonRules.digest } : {}),
    ...(plan.managementMigrationReceiptDigest ? { managementMigrationReceiptDigest: plan.managementMigrationReceiptDigest,
      managementPreparation: plan.managementPreparation } : {}),
    ...(plan.conversionManifestDigest ? { conversionManifestDigest: plan.conversionManifestDigest } : {}),
    ...(plan.bindingImportIntentDigest ? { bindingImportIntentDigest: plan.bindingImportIntentDigest } : {}),
    ...(plan.bindingImportIntentDigest ? { bindingArchiveRetainUntil: plan.bindingArchiveRetainUntil } : {}),
  })).digest("hex")}`;
}

const nonempty = z.string().min(1);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const checksum = z.string().regex(/^[a-f0-9]{64}$/u);
const sha = z.string().regex(/^[a-f0-9]{40}$/u);
const protectedReference = z.object({ kind: nonempty, id: nonempty }).strict();
const plannedCase = z.object({ comparisonId: z.enum(COMPARISON_IDS), protectedReference, inputChecksum: checksum }).strict();
const sourceBinding = z.object({ hostRunId: nonempty, handoffDigest: digest, sourceSystem: nonempty,
  managementConfigurationDigest: digest, target: z.object({ systemIdentifier: nonempty, databaseOid: nonempty }).strict(),
  sourceSha: sha, candidateSha: sha }).strict();
const storedRules = z.object({ version: z.literal("pcat-comparison-p0-rules/v2"), sourceSnapshotFingerprint: digest,
  inventory: z.object({ version: z.literal("pcat-comparison-selection/v2"), binding: sourceBinding,
    families: z.array(z.object({ family: z.enum(COMPARISON_FAMILIES), sourceInventoryCount: z.number().int().safe().nonnegative(),
      sourceInventoryChecksum: checksum, cases: z.array(plannedCase) }).strict()) }).strict(),
  cases: z.array(plannedCase.extend({ inputChecksum: digest, family: z.enum(COMPARISON_FAMILIES), semanticAssertion: nonempty, ruleId: nonempty,
    identities: z.array(z.object({ sourceIdentity: comparisonSourceIdentitySchema,
      rClass: z.enum(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]),
      classificationRuleId: nonempty, disposition: z.enum(["mapped", "archived", "review-evidence", "definition-proposal"]),
    }).strict()),
  }).strict()), digest }).strict();
const storedPlan = z.object({ comparisonRules: storedRules,
  managementPreparation: z.object({ runId: nonempty, planDigest: digest, candidateArtifactSha: sha, candidateArtifactTree: sha }).strict().optional(),
  managementMigrationReceiptDigest: digest.optional(), bindingImportIntentDigest: digest.optional(),
  bindingArchiveRetainUntil: nonempty.optional(), conversionManifestDigest: digest.optional(),
  planDigest: digest, sourceSnapshotFingerprint: digest, targetArtifactSha: sha, targetCatalogReleaseDigest: digest,
  migrationContractVersion: z.literal(MIGRATION_CONTRACT_VERSION), phases: z.array(z.enum(PRE_ACTIVATION_PHASES)),
}).strict();

/** Read-only public owner projection for live Comparison. The maintenance
 * root holds its original source/target boundary and this actual session.
 * It does not accept plan JSON and does not authorize a phase or a mapping.
 */
export async function readCommittedComparisonPlan(input: {
  readonly client: MappingQueryable; readonly runId: string; readonly planDigest: string; readonly candidateSha: string;
}): Promise<CutoverPlan & { readonly comparisonRules: ComparisonP0Rules }> {
  try {
    const rows = (await input.client.query<{ runId: string; planDigest: string; candidateSha: string;
      sourceFingerprint: string; state: string; checkpointDigest: string; eventDigest: string;
      payload: { comparisonPlan?: unknown; comparisonRules?: unknown; sourceSnapshotFingerprint?: unknown } }>(`
      select r.id as "runId",r.plan_digest as "planDigest",r.target_artifact_sha as "candidateSha",
        r.source_snapshot_fingerprint as "sourceFingerprint",r.state,
        c.checkpoint_digest as "checkpointDigest",e.payload->>'checkpointDigest' as "eventDigest",c.payload
      from parameter_catalog.parameter_catalog_cutover_runs r
      join parameter_catalog.parameter_catalog_cutover_checkpoints c on c.cutover_run_id=r.id and c.phase='P0'
      join parameter_catalog.parameter_catalog_cutover_events e on e.cutover_run_id=r.id and e.phase='P0' and e.event_kind='checkpoint'
      where r.id=$1`, [input.runId])).rows;
    const row = rows[0];
    if (rows.length !== 1 || !row || row.runId !== input.runId || row.planDigest !== input.planDigest ||
      row.candidateSha !== input.candidateSha || !["running", "completed"].includes(row.state) ||
      !digest.safeParse(row.checkpointDigest).success || row.eventDigest !== row.checkpointDigest ||
      typeof row.payload?.comparisonPlan !== "string") throw new Error();
    // Keep the original parsed object order for the historical plan digest.
    // Zod's decoded clone is used for validation only.
    const original: unknown = JSON.parse(row.payload.comparisonPlan);
    storedPlan.parse(original);
    const plan = original as CutoverPlan & { comparisonRules: ComparisonP0Rules };
    const rules = plan.comparisonRules;
    const { digest: rulesDigest, ...unsignedRules } = rules;
    if (plan.planDigest !== input.planDigest || plan.targetArtifactSha !== input.candidateSha ||
      comparisonPlanDigest(plan) !== input.planDigest || !isDeepStrictEqual(plan.phases, PRE_ACTIVATION_PHASES) ||
      plan.sourceSnapshotFingerprint !== row.sourceFingerprint || row.payload.sourceSnapshotFingerprint !== row.sourceFingerprint ||
      rules.sourceSnapshotFingerprint !== row.sourceFingerprint || rules.digest !== digestOf(unsignedRules) ||
      rules.inventory.binding.candidateSha !== input.candidateSha || !isDeepStrictEqual(row.payload.comparisonRules, rules) ||
      Boolean(plan.managementPreparation) !== Boolean(plan.managementMigrationReceiptDigest) ||
      Boolean(plan.bindingImportIntentDigest) !== Boolean(plan.bindingArchiveRetainUntil) ||
      !isDeepStrictEqual(rules.inventory.families.map(family => family.family), COMPARISON_FAMILIES)) throw new Error();
    for (const family of rules.inventory.families) {
      const actual = rules.cases.filter(item => item.family === family.family);
      // Source-inventory checksums use the Comparison codec; rule input
      // digests use the core codec. Preserve both, never compare their hashes
      // as if adding/removing a prefix established equivalence.
      const summarized = actual.map(({ comparisonId, protectedReference }) => ({ comparisonId, protectedReference }));
      const inventoryCases = family.cases.map(({ comparisonId, protectedReference }) => ({ comparisonId, protectedReference }));
      if (!isDeepStrictEqual(summarized, inventoryCases) || new Set(family.cases.map(item => JSON.stringify(item.protectedReference))).size !== family.sourceInventoryCount) throw new Error();
      const seen = new Set<string>();
      for (const item of actual) {
        const { ruleId, ...basis } = item;
        const key = JSON.stringify([item.comparisonId, item.protectedReference]);
        if (seen.has(key) || ruleId !== `PCAT-P0-COMPARISON:${digestOf(basis)}` ||
          item.semanticAssertion !== assertions[item.comparisonId] ||
          !(FAMILY_COMPARISON_IDS[family.family] as readonly string[]).includes(item.comparisonId) ||
          new Set(item.identities.map(identity => identity.sourceIdentity.legacyIdentityId)).size !== item.identities.length ||
          item.identities.some(identity => identity.sourceIdentity.sourceSystem !== rules.inventory.binding.sourceSystem)) throw new Error();
        seen.add(key);
      }
    }
    return structuredClone(plan);
  } catch { throw new Error("PCAT-CMP-P0-PLAN-UNAVAILABLE"); }
}
