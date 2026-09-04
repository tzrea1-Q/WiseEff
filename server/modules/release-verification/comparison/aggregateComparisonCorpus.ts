import { corpusRefusal } from "./errors";
import {
  COMPARISON_CORPUS_CONTRACT_VERSION,
  COMPARISON_FAMILIES,
  FAMILY_COMPARISON_IDS,
  assertExactFamilySet,
  checksumCanonicalBytes,
  compareComparisonCases,
  parseComparisonContribution,
  serializeCanonical,
  type AggregationContext,
  type ComparisonContribution,
} from "./corpusContributionSchema";
import {
  checksumComparisonCorpus,
  countResults,
  familyChecksumRecord,
  type AggregatedComparisonCase,
  type AggregatedComparisonCorpus,
  type FamilyInventoryBinding,
} from "./corpusResultSchema";
import {
  createProductionComparisonProviders,
  type ComparisonProvider,
  type ComparisonProviderInput,
} from "./productionProviders";

export const registerComparisonProviders = (
  providers: readonly ComparisonProvider[],
): readonly ComparisonProvider[] => {
  assertExactFamilySet(providers.map((provider) => provider.family));
  const ordered = COMPARISON_FAMILIES.map((family) => {
    const provider = providers.find((item) => item.family === family);
    if (!provider) {
      throw corpusRefusal("PCAT-CMP-MISSING-FAMILY", `missing family provider ${family}`);
    }
    const expected = new Set<string>(FAMILY_COMPARISON_IDS[family]);
    const actual = new Set<string>(provider.comparisonIds);
    if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) {
      throw corpusRefusal(
        "PCAT-CMP-UNKNOWN-COMPARISON-ID",
        `family ${family} provider comparison IDs drifted from the S10-DCP mapping`,
      );
    }
    return provider;
  });
  return Object.freeze(ordered);
};

export const productionComparisonProviders = (): readonly ComparisonProvider[] =>
  registerComparisonProviders(createProductionComparisonProviders());

export const collectComparisonContributions = async (
  input: ComparisonProviderInput,
  providers: readonly ComparisonProvider[] = productionComparisonProviders(),
): Promise<readonly ComparisonContribution[]> => {
  const registered = registerComparisonProviders(providers);
  const contributions: ComparisonContribution[] = [];
  for (const provider of registered) {
    contributions.push(await provider.provide(input));
  }
  return contributions;
};

const sortAggregatedCases = (
  cases: readonly AggregatedComparisonCase[],
): AggregatedComparisonCase[] =>
  [...cases].sort((left, right) => compareComparisonCases(left, right));

export const aggregateComparisonCorpus = (
  contributions: readonly ComparisonContribution[],
  context: AggregationContext,
): AggregatedComparisonCorpus => {
  assertExactFamilySet(contributions.map((item) => item.family));
  const parsed = COMPARISON_FAMILIES.map((family) => {
    const contribution = contributions.find((item) => item.family === family);
    if (!contribution) {
      throw corpusRefusal("PCAT-CMP-MISSING-FAMILY", `missing family contribution ${family}`);
    }
    return parseComparisonContribution(contribution, context);
  });

  const cases = sortAggregatedCases(
    parsed.flatMap((contribution) =>
      contribution.cases.map((item) => ({ ...item, family: contribution.family })),
    ),
  );

  const resultCounts = countResults(cases);

  const familyBindings: FamilyInventoryBinding[] = parsed.map((contribution) => ({
    family: contribution.family,
    sourceInventoryCount: contribution.sourceInventoryCount,
    sourceInventoryChecksum: contribution.sourceInventoryChecksum,
    checksum: contribution.checksum,
  }));
  const sourceInventoryCount = familyBindings.reduce(
    (total, binding) => total + binding.sourceInventoryCount,
    0,
  );
  const sourceInventoryChecksum = checksumCanonicalBytes(
    serializeCanonical(
      familyBindings.map((binding) => ({
        family: binding.family,
        sourceInventoryCount: binding.sourceInventoryCount,
        sourceInventoryChecksum: binding.sourceInventoryChecksum,
      })),
    ),
  );

  const unsigned: Omit<AggregatedComparisonCorpus, "checksum"> = {
    contractVersion: COMPARISON_CORPUS_CONTRACT_VERSION,
    phase: context.phase,
    inventoryMode: context.inventoryMode,
    candidateSha: context.candidateSha,
    planPin: context.planPin,
    mappingHeadId: context.mappingHeadId,
    mappingHeadVersion: context.mappingHeadVersion,
    mappingHeadChecksum: context.mappingHeadChecksum,
    catalogSnapshotChecksum: context.catalogSnapshotChecksum,
    sourceInventoryCount,
    sourceInventoryChecksum,
    familyBindings,
    familyChecksums: familyChecksumRecord(parsed),
    cases,
    resultCounts,
  };
  const checksum = checksumComparisonCorpus(unsigned);
  return { ...unsigned, checksum };
};

export const aggregateLiveComparisonCorpus = async (
  input: ComparisonProviderInput,
  providers: readonly ComparisonProvider[] = productionComparisonProviders(),
): Promise<AggregatedComparisonCorpus> => {
  const contributions = await collectComparisonContributions(input, providers);
  return aggregateComparisonCorpus(contributions, input);
};
