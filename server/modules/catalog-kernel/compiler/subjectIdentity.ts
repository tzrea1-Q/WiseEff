import {
  parseCanonicalCompatibleSelector,
  parseCanonicalConfigurationSchemaId,
  parseCanonicalNodeName,
} from "../../parameter-catalog-contract";
import type { CatalogReleaseDocument, CatalogReleaseNode } from "./types";

export const SUBJECT_IDENTITY_CORRECTION = "catalog-subject-identity-correction";
export const TYPED_CHANGESET_SOURCE_PATH = "schemas/dts/catalog-release/typed-changeset.yaml";

export function parseCatalogSelector(kind: string, value: unknown) {
  if (kind === "driver-compatible") return parseCanonicalCompatibleSelector(value);
  if (kind === "configuration-schema-id") return parseCanonicalConfigurationSchemaId(value);
  return parseCanonicalNodeName(value);
}

export function subjectIdentityProvenance(document: CatalogReleaseDocument) {
  const provenance = document.kind === "subject" ? document.content.selector.provenance
    : document.kind === "alias" ? document.content.selectorProvenance : undefined;
  return provenance?.source === SUBJECT_IDENTITY_CORRECTION ? provenance : undefined;
}

export function isCorrectedIdentity(document: CatalogReleaseDocument, release: CatalogReleaseNode): boolean {
  return document.source.path === TYPED_CHANGESET_SOURCE_PATH &&
    subjectIdentityProvenance(document)?.reviewReference === release.manifest.release.id;
}
