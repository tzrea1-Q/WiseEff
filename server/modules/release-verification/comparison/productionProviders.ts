import type pg from "pg";

import { provideAgtParameterCatalogComparisonContribution } from "../../agent/parameterCatalogComparisonContribution";
import { provideDbgParameterCatalogComparisonContribution } from "../../debugging/parameterCatalogComparisonContribution";
import { provideDtsParameterCatalogComparisonContribution } from "../../dts-reload/parameterCatalogComparisonContribution";
import { provideKnwParameterCatalogComparisonContribution } from "../../knowledge/parameterCatalogComparisonContribution";
import { provideLogParameterCatalogComparisonContribution } from "../../logs/parameterCatalogComparisonContribution";
import { provideOpsParameterCatalogComparisonContribution } from "../../operations/parameterCatalogComparisonContribution";
import { provideFilParameterCatalogComparisonContribution } from "../../parameter-files/parameterCatalogComparisonContribution";
import { provideModParameterCatalogComparisonContribution } from "../../parameter-modules/parameterCatalogComparisonContribution";
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
} from "./corpusContributionSchema";

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
