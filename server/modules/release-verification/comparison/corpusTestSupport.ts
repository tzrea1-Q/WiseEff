import { createHash } from "node:crypto";

import pg from "pg";

import { getRootPostgresPool, type Database } from "../../../shared/database/client";
import {
  COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
  COMPARISON_FAMILIES,
  FAMILY_COMPARISON_IDS,
  checksumComparisonContribution,
  compareComparisonCases,
  type AggregationContext,
  type ComparisonCase,
  type ComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
  type ComparisonResultClass,
} from "./corpusContributionSchema";

export const FRESH_PRE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FRESH_POST_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const POP_PRE_SHA = "cccccccccccccccccccccccccccccccccccccccc";
export const POP_POST_SHA = "dddddddddddddddddddddddddddddddddddddddd";

export function aggregationContext(
  inventoryMode: AggregationContext["inventoryMode"],
  phase: AggregationContext["phase"],
  candidateSha: string,
): AggregationContext {
  return {
    phase,
    inventoryMode,
    candidateSha,
    planPin: `plan-${phase}-${inventoryMode}`,
    mappingHeadId: `map-${phase}-${inventoryMode}`,
    mappingHeadVersion: phase === "pre-activation" ? 1 : 2,
    mappingHeadChecksum: createHash("sha256").update(`${phase}:${inventoryMode}`).digest("hex"),
    catalogSnapshotChecksum: createHash("sha256")
      .update(`catalog:${phase}:${inventoryMode}`)
      .digest("hex"),
  };
}

function emptyInventoryChecksum(): string {
  return createHash("sha256").update("[]\n").digest("hex");
}

export function makeCase(
  family: ComparisonFamily,
  comparisonId: ComparisonId,
  context: AggregationContext,
  id = "ref-1",
  result: ComparisonResultClass = "declared-expected-difference",
): ComparisonCase {
  const protectedReference = { kind: `kind-${family.toLowerCase()}`, id };
  if (result === "unqueryable/protected-reference-missing") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: {
        status: "query-failure",
        code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        detail: "missing",
      },
      canonicalObservation: { status: "value", value: { id } },
      result,
      expectedDifference: null,
    };
  }
  if (result === "unexplained-difference") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: { status: "value", value: { side: "legacy" } },
      canonicalObservation: { status: "value", value: { side: "canonical" } },
      result,
      expectedDifference: null,
    };
  }
  if (result === "exact-equivalent") {
    return {
      caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
      comparisonId,
      protectedReference,
      legacyObservation: { status: "value", value: { id, family } },
      canonicalObservation: { status: "value", value: { id, family } },
      result,
      expectedDifference: null,
    };
  }
  return {
    caseId: `${family}:${comparisonId}:${protectedReference.kind}:${id}`,
    comparisonId,
    protectedReference,
    legacyObservation: { status: "value", value: { id, family, side: "legacy" } },
    canonicalObservation: { status: "value", value: { id, family, side: "canonical" } },
    result,
    expectedDifference: {
      rClass: "R9",
      mappingHeadId: context.mappingHeadId,
      mappingHeadVersion: context.mappingHeadVersion,
      typedTarget: protectedReference,
      ruleId: comparisonId,
      planPin: context.planPin,
    },
  };
}

export function makeContribution(
  family: ComparisonFamily,
  context: AggregationContext,
  options: {
    readonly cases?: readonly ComparisonCase[];
    readonly sourceInventoryCount?: number;
    readonly checksum?: string;
  } = {},
): ComparisonContribution {
  const mappedIds = FAMILY_COMPARISON_IDS[family];
  const cases = [
    ...(options.cases ??
      (context.inventoryMode === "fresh"
        ? []
        : mappedIds.map((comparisonId) => makeCase(family, comparisonId, context)))),
  ].sort((left, right) => compareComparisonCases({ ...left, family }, { ...right, family }));
  const uniqueRefs = new Set(
    cases.map((item) => `${item.protectedReference.kind}\0${item.protectedReference.id}`),
  );
  const unsigned: Omit<ComparisonContribution, "checksum"> = {
    contractVersion: COMPARISON_CONTRIBUTION_CONTRACT_VERSION,
    family,
    phase: context.phase,
    inventoryMode: context.inventoryMode,
    candidateSha: context.candidateSha,
    planPin: context.planPin,
    mappingHeadId: context.mappingHeadId,
    mappingHeadVersion: context.mappingHeadVersion,
    mappingHeadChecksum: context.mappingHeadChecksum,
    catalogSnapshotChecksum: context.catalogSnapshotChecksum,
    sourceInventoryCount: options.sourceInventoryCount ?? uniqueRefs.size,
    sourceInventoryChecksum: emptyInventoryChecksum(),
    cases,
  };
  return {
    ...unsigned,
    checksum: options.checksum ?? checksumComparisonContribution(unsigned),
  };
}

export function makeFamilyContributions(
  context: AggregationContext,
): ComparisonContribution[] {
  return COMPARISON_FAMILIES.map((family) => makeContribution(family, context));
}

/** Locked rehearsal lists empty orgs before `wf671-org`. S12 observers use organizations[0]. */
export const POPULATED_REHEARSAL_OWNER_ORGANIZATION_ID = "wf671-org";

const isOrganizationIdOrderQuery = (text: string): boolean => {
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  return normalized.includes("from organizations") && normalized.includes("order by id");
};

export function preferPopulatedRehearsalOrganization<T extends Database>(database: T): T {
  const pool = getRootPostgresPool(database);
  if (!pool) {
    throw new Error("populated rehearsal organization scope requires a root PostgreSQL pool");
  }
  const originalQuery = pool.query.bind(pool) as typeof pool.query;
  pool.query = ((queryText: unknown, values?: unknown, callback?: unknown) => {
    if (typeof callback === "function") {
      return originalQuery(queryText as string, values as never, callback as never);
    }
    const text = typeof queryText === "string" ? queryText : String(queryText);
    const result = originalQuery(queryText as never, values as never) as Promise<pg.QueryResult>;
    return result.then((queryResult) => {
      if (!isOrganizationIdOrderQuery(text) || !Array.isArray(queryResult.rows)) {
        return queryResult;
      }
      const rows = [...queryResult.rows].sort((left, right) => {
        const leftId = (left as { id?: unknown }).id;
        const rightId = (right as { id?: unknown }).id;
        if (leftId === POPULATED_REHEARSAL_OWNER_ORGANIZATION_ID) {
          return -1;
        }
        if (rightId === POPULATED_REHEARSAL_OWNER_ORGANIZATION_ID) {
          return 1;
        }
        return 0;
      });
      return { ...queryResult, rows };
    });
  }) as typeof pool.query;
  return database;
}
