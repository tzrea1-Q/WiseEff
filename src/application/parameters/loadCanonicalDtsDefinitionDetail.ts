import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CanonicalDtsDefinitionDetail } from "@/domain/parameter-topology/types";

export type LoadCanonicalDtsDefinitionDetailInput = {
  definitionId: string;
  revisionId: string;
  propertyKey: string;
};

/** Read exactly the Definition revision pinned by the binding. */
export async function loadCanonicalDtsDefinitionDetail(
  repository: Pick<ParameterCatalogRepository, "getDefinitionRevision">,
  input: LoadCanonicalDtsDefinitionDetailInput
): Promise<CanonicalDtsDefinitionDetail> {
  const response = await repository.getDefinitionRevision(input.definitionId, input.revisionId);
  const revision = response.item;
  if (revision.definitionId !== input.definitionId || revision.id !== input.revisionId) {
    throw new Error("canonical definition revision identity mismatch");
  }
  return {
    definitionId: revision.definitionId,
    revisionId: revision.id,
    revisionNumber: revision.revisionNumber,
    propertyKey: input.propertyKey,
    contentDigest: revision.contentDigest,
    displayName: revision.displayName,
    valueShape: revision.valueShape,
    constraints: revision.constraints,
    documentation: revision.documentation,
    unit: revision.unit?.symbol ?? null,
    catalogReleaseId: revision.publishedInCatalogReleaseId
  };
}
