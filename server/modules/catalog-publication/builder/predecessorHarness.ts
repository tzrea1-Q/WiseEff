import { compileCatalogRelease } from "../../catalog-kernel/compiler/index";
import { validCatalogReleaseBundle } from "../../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseId,
  CatalogReleaseVersion,
  serializeContract,
  type ContractJsonValue,
} from "../../parameter-catalog-contract/index";
import type {
  CreateDefinitionChange,
  FrozenDefinitionAllocation,
  FrozenPublicationIdentity,
  SupportedDefinitionContent,
} from "./types";

export const integerContent = (
  displayName: string,
  documentation: string,
): SupportedDefinitionContent => ({
  displayName,
  documentation,
  unit: "mA",
  valueSchema: { type: "integer", minimum: 0 },
});

export const firstAcmePredecessor = () => {
  const first = validCatalogReleaseBundle().releases[0];
  if (!first) throw new Error("acme first release missing");
  const bundle = {
    schemaVersion: "1.0.0" as const,
    targetReleaseId: first.manifest.release.id,
    releases: [first],
  };
  const compiled = compileCatalogRelease(bundle);
  if (!compiled.ok) {
    throw new Error(`acme predecessor uncompilable:${compiled.error.kind}`);
  }
  const bytes = new TextEncoder().encode(
    serializeContract(bundle as unknown as ContractJsonValue),
  );
  return {
    bundle,
    compiled: compiled.value,
    bytes,
    digest: compiled.value.aggregateDigest,
    first,
  };
};

export const pageIntegerChange = (
  propertyKey: string,
  displayName: string,
): CreateDefinitionChange => ({
  op: "create-definition",
  subjectId: "csub_acme_power",
  propertyKey,
  content: integerContent(displayName, `${displayName} documentation.`),
});

export const allocationFor = (
  propertyKey: string,
): FrozenDefinitionAllocation => ({
  subjectId: "csub_acme_power",
  propertyKey,
  definitionId: `pdef_acme_power_${propertyKey}`,
  revisionId: `drev_acme_power_${propertyKey}_1`,
});

export const frozenPageIdentity = (
  defs: readonly FrozenDefinitionAllocation[],
  suffix = "1",
  releaseVersion = "1.1.0",
): FrozenPublicationIdentity => {
  const predecessor = firstAcmePredecessor();
  return {
    candidateId: CatalogCandidateId(`ccand_page_add_${suffix}`),
    artifactId: CatalogArtifactId(`cart_page_add_${suffix}`),
    releaseId: CatalogReleaseId(`crel_acme_page_${suffix}`),
    releaseVersion: CatalogReleaseVersion(releaseVersion),
    publishedAt: "2026-09-12T00:00:00Z",
    toolchain: predecessor.first.manifest.toolchain,
    definitions: defs,
  };
};
