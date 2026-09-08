import type pg from "pg";
import { isDeepStrictEqual } from "node:util";

import { provideAgtParameterCatalogComparisonContribution } from "../../agent/parameterCatalogComparisonContribution";
import { provideDbgParameterCatalogComparisonContribution } from "../../debugging/parameterCatalogComparisonContribution";
import { provideDtsParameterCatalogComparisonContribution } from "../../dts-reload/parameterCatalogComparisonContribution";
import { provideKnwParameterCatalogComparisonContribution } from "../../knowledge/parameterCatalogComparisonContribution";
import { provideLogParameterCatalogComparisonContribution } from "../../logs/parameterCatalogComparisonContribution";
import { provideOpsParameterCatalogComparisonContribution } from "../../operations/parameterCatalogComparisonContribution";
import { provideFilParameterCatalogComparisonContribution } from "../../parameter-files/parameterCatalogComparisonContribution";
import { provideModParameterCatalogComparisonContribution } from "../../parameter-modules/parameterCatalogComparisonContribution";
import { provideCghParameterCatalogComparisonContribution, readComparisonNativeInventory, readCghComparisonOperatorOutcome } from "../../parameter-specs/parameterCatalogComparisonContribution";
import { provideTopParameterCatalogComparisonContribution } from "../../parameter-topology/parameterCatalogComparisonContribution";
import { providePrjParameterCatalogComparisonContribution } from "../../parameters/parameterCatalogComparisonContribution";
import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import { readCommittedComparisonPlan } from "../../catalog-cutover/comparisonRules";
import { readComparisonMappingFactsOnHeldSession } from "../../catalog-cutover/activation";
import { readMappingSnapshot, type MappingSnapshotMember } from "../../catalog-cutover/mapping";
import { digestOf } from "../core/digest";
import { readComparisonSourceInventory, type ComparisonInventoryRecord } from "./planInventory";
import { comparisonContextV2Schema, checksumComparisonContributionV2, parseComparisonContributionV2,
  type ComparisonContextV2, type ComparisonContributionV2, type ComparisonCaseV2 } from "./corpusContributionV2";
import { ComparisonCorpusError, corpusRefusal } from "./errors";
import { assertComparisonDatabaseSource } from "./databaseSource";
import {
  FAMILY_COMPARISON_IDS,
  COMPARISON_FAMILIES, checksumCanonicalBytes, serializeCanonical, compareComparisonCases,
  type AggregationContext,
  type ComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
} from "./corpusContributionSchema";

export type ComparisonProviderInputV2 = ComparisonContextV2 & {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly managementClient: pg.PoolClient;
  readonly cutoverRunId: string;
  readonly target: { readonly systemIdentifier: string; readonly databaseOid: string };
  readonly verifyBoundary: () => Promise<void>;
};

type NativeInventory = Awaited<ReturnType<typeof readComparisonNativeInventory>>;
const inventoryChecksum = (value: unknown) => checksumCanonicalBytes(serializeCanonical(value));
const unavailable = (detail: string): ComparisonCaseV2["canonicalObservation"] => ({ status: "query-failure",
  code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE", detail });

/** Observe the exact current destination. A present mapping row is not target
 * existence or semantic preservation. Unavailable target readers remain
 * query failures; DTO inequality never becomes a declared difference here. */
function nativeObservation(record: ComparisonInventoryRecord, members: readonly MappingSnapshotMember[], native: NativeInventory): ComparisonCaseV2["canonicalObservation"] {
  if (members.length !== 1) return unavailable("protected-destination-not-unique");
  const member = members[0]!;
  const version = member.head.version;
  if (version.archiveId !== null) return unavailable("archive-object-observation-unavailable");
  const observedScopes = Reflect.get(record, "sourceObservations") as unknown;
  const scopes = Array.isArray(observedScopes) ? observedScopes.map(observation => observation?.organizationId) :
    member.sourceIdentity.ownerScopeKind === "organization" ? [member.sourceIdentity.ownerScopeId] : [];
  if (!scopes.length || scopes.some(scope => typeof scope !== "string" || !scope) || new Set(scopes).size !== scopes.length) {
    return unavailable("protected-target-observation-scope-unavailable");
  }
  const observations = [];
  for (const organizationId of scopes) {
    const found = native.filter(row => row.kind === version.targetKind && row.id === version.targetId && row.organizationId === organizationId);
    if (found.length !== 1) return unavailable("protected-target-observation-missing-or-ambiguous");
    observations.push({ organizationId, value: found[0]!.value });
  }
  // Materialize the actual public DTO's JSON wire representation. Optional
  // undefined JS properties are absent on that wire; SQL source cells are not
  // transformed by this path and remain in the source owner's inventory.
  return { status: "value", value: JSON.parse(serializeCanonical({ observation: observations }).toString("utf8")) };
}

export type ComparisonContextReadInputV2 = Omit<ComparisonProviderInputV2, "mappingSnapshot" | "catalogSnapshotChecksum">;

async function readActualContext(input: ComparisonContextReadInputV2) {
  const { database, pool, managementClient, cutoverRunId, phase, inventoryMode, candidateSha, planPin, verifyBoundary } = input;
  const target = structuredClone(input.target);
  assertComparisonDatabaseSource({ database, pool, managementClient, cutoverRunId, target, planPin, verifyBoundary });
  if (getRootPostgresPool(database) !== pool) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "actual root pool differs");
  await verifyBoundary();
  const facts = await readComparisonMappingFactsOnHeldSession({ client: managementClient, target, runId: cutoverRunId,
    planDigest: planPin, verifyBoundary });
  const native = await readComparisonNativeInventory(database);
  if (facts.candidateSha !== candidateSha || !facts.mapping.epoch) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "actual epoch or candidate unavailable");
  const context = comparisonContextV2Schema.parse({ phase, inventoryMode, candidateSha, planPin,
    mappingSnapshot: facts.mapping, catalogSnapshotChecksum: inventoryChecksum(native) });
  await verifyBoundary();
  assertComparisonDatabaseSource({ database, pool, managementClient, cutoverRunId, target, planPin, verifyBoundary });
  return { context, facts, native };
}

/** Actual before/after observation for the existing liveEvidence source.
 * Independent copies come from real readers, never a contribution or report.
 */
export async function readProductionComparisonContextV2(input: ComparisonContextReadInputV2): Promise<ComparisonContextV2> {
  try {
    return structuredClone((await readActualContext(input)).context);
  } catch (error) {
    throw corpusRefusal(error instanceof ComparisonCorpusError ? error.code : "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      "actual comparison context unavailable");
  }
}

/** The production v2 collection path, with no provider/rule/head overrides.
 * Its maintenance caller holds one writer/metadata boundary throughout all
 * eleven real source owners and canonical reads. It does not prepare P0/P11.
 */
export async function collectProductionComparisonContributionsV2(input: ComparisonProviderInputV2): Promise<readonly ComparisonContributionV2[]> {
  try {
    return await collectActualContributions(input);
  } catch (error) {
    throw corpusRefusal(error instanceof ComparisonCorpusError ? error.code : "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      "actual comparison collection unavailable");
  }
}

async function collectActualContributions(input: ComparisonProviderInputV2): Promise<readonly ComparisonContributionV2[]> {
  const { database, pool, managementClient, cutoverRunId } = input;
  const target = structuredClone(input.target);
  const verifyBoundary = input.verifyBoundary;
  const context = comparisonContextV2Schema.parse({ phase: input.phase, inventoryMode: input.inventoryMode,
    candidateSha: input.candidateSha, planPin: input.planPin, mappingSnapshot: structuredClone(input.mappingSnapshot),
    catalogSnapshotChecksum: input.catalogSnapshotChecksum });
  assertComparisonDatabaseSource({ database, pool, managementClient, cutoverRunId, target, planPin: context.planPin, verifyBoundary });
  if (getRootPostgresPool(database) !== pool) throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "actual root pool differs");
  await verifyBoundary();
  const plan = await readCommittedComparisonPlan({ client: managementClient, runId: cutoverRunId,
    planDigest: context.planPin, candidateSha: context.candidateSha });
  const { facts, native, context: actualContext } = await readActualContext({ ...context, database, pool, managementClient,
    cutoverRunId, target, verifyBoundary });
  const snapshot = await readMappingSnapshot(managementClient);
  if (!isDeepStrictEqual(actualContext, context) || snapshot.headDigest !== facts.mapping.headDigest ||
    snapshot.versionInventoryDigest !== facts.versionInventoryDigest || facts.candidateSha !== context.candidateSha ||
    facts.sourceSnapshotFingerprint !== plan.sourceSnapshotFingerprint || !isDeepStrictEqual(plan.comparisonRules.inventory.binding.target, target) ||
    context.phase === "pre-activation" && (facts.runPhase !== "P10" || facts.runState !== "completed" || facts.currentBinding?.intent.runId === cutoverRunId) ||
    context.phase === "post-p13" && (!facts.currentBinding || facts.currentBinding.intent.runId !== cutoverRunId || !/^P1[3-6]$/.test(facts.runPhase))) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "actual P0 mapping or phase association differs");
  }
  if (snapshot.members.some(member => member.sourceIdentity.sourceSystem !== plan.comparisonRules.inventory.binding.sourceSystem ||
    member.head.version.cutoverRunId !== cutoverRunId || member.head.version.graphFingerprint !== plan.sourceSnapshotFingerprint)) {
    throw corpusRefusal("PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE", "mapping belongs to another source or run");
  }
  const source = await readComparisonSourceInventory(database, snapshot.members.map(member => member.sourceIdentity));
  await verifyBoundary();
  const output: ComparisonContributionV2[] = [];
  for (const family of COMPARISON_FAMILIES) {
    const records = source[family];
    const original = plan.comparisonRules.inventory.families.find(row => row.family === family)!;
    if (records.length !== original.sourceInventoryCount || inventoryChecksum(records) !== original.sourceInventoryChecksum) {
      throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "source inventory differs from its fixed P0 selection");
    }
    const cases: ComparisonCaseV2[] = [];
    for (const record of records) {
      for (const comparisonId of record.applicable) {
        const rules = plan.comparisonRules.cases.filter(rule => rule.family === family && rule.comparisonId === comparisonId &&
          rule.protectedReference.kind === record.kind && rule.protectedReference.id === record.id);
        const rule = rules[0];
        if (rules.length !== 1 || !rule || rule.inputChecksum !== digestOf(record)) throw corpusRefusal("PCAT-CMP-CORPUS-COVERAGE", "source case differs from its fixed P0 rule");
        const members = rule.identities.map(identity => {
          const matches = snapshot.members.filter(member => isDeepStrictEqual(member.sourceIdentity, identity.sourceIdentity));
          const member = matches[0];
          if (matches.length !== 1 || !member || member.head.version.rClass !== identity.rClass ||
            (identity.disposition === "archived") !== (member.head.version.archiveId !== null)) {
            throw corpusRefusal("PCAT-CMP-EXPECTED-DIFFERENCE-EVIDENCE", "source mapping disagrees with its P0 declaration");
          }
          return member;
        });
        const value = Object.hasOwn(record, "legacyValue") ? Reflect.get(record, "legacyValue") :
          Object.hasOwn(record, "sourceObservations") ? Reflect.get(record, "sourceObservations") : record;
        const legacyObservation: ComparisonCaseV2["legacyObservation"] = { status: "value",
          value: JSON.parse(serializeCanonical({ observation: value }).toString("utf8")) };
        let canonicalObservation = nativeObservation(record, members, native);
        let expectedDifference: ComparisonCaseV2["expectedDifference"] = null;
        // The CGH owner supplies the real D09 protocol observation. This does
        // not authorize a D01 semantic difference for the same source record.
        if (family === "CGH" && comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME" &&
          record.kind === "parameter-definition-spec" && members.length === 1 && canonicalObservation.status === "value") {
          const member = members[0]!;
          const sourceObservations = Reflect.get(record, "sourceObservations") as Array<{ organizationId: string }>;
          const observed = await readCghComparisonOperatorOutcome(database, record.id, sourceObservations.map(row => row.organizationId));
          const version = member.head.version;
          if (version.rClass !== "R0" && version.targetKind !== null && version.targetId !== null && observed.every(row => row.successor.kind === "mapped" &&
            row.successor.item.legacyType === member.sourceIdentity.sourceKind && row.successor.item.legacyId === member.sourceIdentity.sourceId &&
            row.successor.item.target.kind === version.targetKind && row.successor.item.target.id === version.targetId)) {
            canonicalObservation = { status: "value", value: JSON.parse(serializeCanonical({ outcomes: observed }).toString("utf8")) };
            expectedDifference = { sourceIdentity: structuredClone(member.sourceIdentity), rClass: version.rClass,
              mappingVersionId: member.head.currentVersionId, headVersion: member.head.casVersion, headDigest: member.headDigest,
              typedTarget: { kind: version.targetKind, id: version.targetId }, ruleId: rule.ruleId, planPin: context.planPin };
          } else canonicalObservation = unavailable("legacy-operator-successor-disagrees-with-current-head");
        }
        cases.push({ caseId: `${family}:${comparisonId}:${record.kind}:${record.id}`, comparisonId,
          protectedReference: { kind: record.kind, id: record.id }, legacyObservation, canonicalObservation,
          result: canonicalObservation.status === "query-failure" ? "unqueryable/protected-reference-missing" :
            isDeepStrictEqual(legacyObservation, canonicalObservation) ? "exact-equivalent" : expectedDifference ? "declared-expected-difference" : "unexplained-difference",
          expectedDifference });
      }
    }
    cases.sort(compareComparisonCases);
    const unsigned = { ...context, contractVersion: "pcat-comparison-contribution/v2" as const, family,
      sourceInventoryCount: records.length, sourceInventoryChecksum: inventoryChecksum(records), cases };
    output.push(parseComparisonContributionV2({ ...unsigned, checksum: checksumComparisonContributionV2(unsigned) }, context));
  }
  await verifyBoundary();
  if (!isDeepStrictEqual(snapshot, await readMappingSnapshot(managementClient)) ||
    !isDeepStrictEqual(plan, await readCommittedComparisonPlan({ client: managementClient, runId: cutoverRunId,
      planDigest: context.planPin, candidateSha: context.candidateSha }))) {
    throw corpusRefusal("PCAT-CMP-REPORT-INTEGRITY", "fixed comparison selection changed during collection");
  }
  await verifyBoundary();
  assertComparisonDatabaseSource({ database, pool, managementClient, cutoverRunId, target, planPin: context.planPin, verifyBoundary });
  return output;
}

export type ComparisonProviderInput = AggregationContext & {
  readonly database: Database;
  readonly pool: pg.Pool;
};

export type ComparisonProvider = {
  readonly family: ComparisonFamily;
  readonly comparisonIds: readonly ComparisonId[];
  readonly provide: (input: ComparisonProviderInput) => Promise<ComparisonContribution>;
};

const sharedPins = (input: ComparisonProviderInput) => ({
  phase: input.phase,
  inventoryMode: input.inventoryMode,
  candidateSha: input.candidateSha,
  planPin: input.planPin,
  mappingHeadId: input.mappingHeadId,
  mappingHeadVersion: input.mappingHeadVersion,
  mappingHeadChecksum: input.mappingHeadChecksum,
  catalogSnapshotChecksum: input.catalogSnapshotChecksum,
});

export const createProductionComparisonProviders = (): readonly ComparisonProvider[] => [
  {
    family: "CGH",
    comparisonIds: FAMILY_COMPARISON_IDS.CGH,
    provide: (input) =>
      provideCghParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "TOP",
    comparisonIds: FAMILY_COMPARISON_IDS.TOP,
    provide: (input) =>
      provideTopParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "PRJ",
    comparisonIds: FAMILY_COMPARISON_IDS.PRJ,
    provide: (input) =>
      providePrjParameterCatalogComparisonContribution({
        database: input.database,
        ...sharedPins(input),
      }),
  },
  {
    family: "FIL",
    comparisonIds: FAMILY_COMPARISON_IDS.FIL,
    provide: (input) =>
      provideFilParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "AGT",
    comparisonIds: FAMILY_COMPARISON_IDS.AGT,
    provide: (input) =>
      provideAgtParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "LOG",
    comparisonIds: FAMILY_COMPARISON_IDS.LOG,
    provide: (input) =>
      provideLogParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "DBG",
    comparisonIds: FAMILY_COMPARISON_IDS.DBG,
    provide: (input) =>
      provideDbgParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "DTS",
    comparisonIds: FAMILY_COMPARISON_IDS.DTS,
    provide: (input) =>
      provideDtsParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "KNW",
    comparisonIds: FAMILY_COMPARISON_IDS.KNW,
    provide: (input) =>
      provideKnwParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "MOD",
    comparisonIds: FAMILY_COMPARISON_IDS.MOD,
    provide: (input) =>
      provideModParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
  {
    family: "OPS",
    comparisonIds: FAMILY_COMPARISON_IDS.OPS,
    provide: (input) =>
      provideOpsParameterCatalogComparisonContribution({
        database: input.database,
        pool: input.pool,
        ...sharedPins(input),
      }),
  },
];
