import type pg from "pg";
import type { CatalogReleasePin } from "../../parameter-catalog-contract";
import type { TrustedInvocationContext } from "../../auth/trustedInvocation";

import { provideAgtParameterCatalogComparisonContribution } from "../../agent/parameterCatalogComparisonContribution";
import { provideDbgParameterCatalogComparisonContribution } from "../../debugging/parameterCatalogComparisonContribution";
import { provideDtsParameterCatalogComparisonContribution } from "../../dts-reload/parameterCatalogComparisonContribution";
import { provideKnwParameterCatalogComparisonContribution } from "../../knowledge/parameterCatalogComparisonContribution";
import { provideLogParameterCatalogComparisonContribution } from "../../logs/parameterCatalogComparisonContribution";
import { provideOpsParameterCatalogComparisonContribution } from "../../operations/parameterCatalogComparisonContribution";
import { provideFilParameterCatalogComparisonContribution } from "../../parameter-files/parameterCatalogComparisonContribution";
import {
  provideModParameterCatalogComparisonContribution,
  provideModParameterCatalogComparisonCaseBatchV2,
} from "../../parameter-modules/parameterCatalogComparisonContribution";
import { provideCghParameterCatalogComparisonContribution } from "../../parameter-specs/parameterCatalogComparisonContribution";
import { provideTopParameterCatalogComparisonContribution } from "../../parameter-topology/parameterCatalogComparisonContribution";
import { providePrjParameterCatalogComparisonContribution } from "../../parameters/parameterCatalogComparisonContribution";
import type { Database } from "../../../shared/database/client";
import {
  FAMILY_COMPARISON_IDS,
  type AggregationContext,
  type ComparisonContribution,
  type ComparisonFamily,
  type ComparisonId,
  type ComparisonCaseBatchV2,
} from "./corpusContributionSchema";

export type ComparisonProviderInput = AggregationContext & {
  readonly database: Database;
  readonly pool: pg.Pool;
  /** The comparison input's captured release identity; MOD rejects absence or drift. */
  readonly expectedCatalogReleasePin?: CatalogReleasePin;
};

export type ComparisonProvider = {
  readonly family: ComparisonFamily;
  readonly comparisonIds: readonly ComparisonId[];
  readonly provide: (input: ComparisonProviderInput) => Promise<ComparisonContribution>;
};

/** Scoped v2 intentionally exposes only the MOD D02 organization projection. */
export type ComparisonCaseProviderInputV2 = {
  readonly database: Database;
  readonly pool: pg.Pool;
  readonly runId: string;
  readonly invocation: TrustedInvocationContext;
};

export type ComparisonCaseProviderV2 = {
  readonly family: "MOD";
  readonly comparisonIds: readonly ["PCAT-CMP-D02-SUBJECT-IDENTITY"];
  readonly coverage: "organization-projection";
  readonly provide: (input: ComparisonCaseProviderInputV2) => Promise<ComparisonCaseBatchV2>;
};

export const createProductionComparisonCaseProvidersV2 = (): readonly ComparisonCaseProviderV2[] => [
  {
    family: "MOD",
    comparisonIds: ["PCAT-CMP-D02-SUBJECT-IDENTITY"],
    coverage: "organization-projection",
    provide: provideModParameterCatalogComparisonCaseBatchV2,
  },
];

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
        expectedCatalogReleasePin: input.expectedCatalogReleasePin,
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
