import { digestOf } from "../release-verification/core/digest";
import type pg from "pg";
import { classifyFrozenP0Graph, fingerprintP0Graph, type FrozenP0Graph } from "./classifier";
import { comparisonInventorySummary, readCapturedComparisonInventory, type CapturedComparisonInventory } from "../release-verification/comparison/planInventory";
import { COMPARISON_FAMILIES, type ComparisonId } from "../release-verification/comparison/corpusContributionSchema";
import { capturePhysicalSourceIdentities, type MappingSourceIdentity, type MappingQueryable } from "./mapping";

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
