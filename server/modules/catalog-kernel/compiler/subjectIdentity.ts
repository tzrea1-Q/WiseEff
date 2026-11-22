import {
  parseCanonicalCompatibleSelector,
  parseCanonicalConfigurationSchemaId,
  parseCanonicalNodeName,
} from "../../parameter-catalog-contract";
import type { CatalogReleaseDocument, CatalogReleaseNode, CatalogReleaseSubjectDocument } from "./types";

export const SUBJECT_IDENTITY_CORRECTION = "catalog-subject-identity-correction";
export const SUBJECT_RULES_CORRECTION = "catalog-subject-rules-correction";
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

export function subjectRulesProvenance(document: CatalogReleaseDocument) {
  return document.kind === "subject" && document.content.selector.provenance.source === SUBJECT_RULES_CORRECTION
    ? document.content.selector.provenance : undefined;
}

export function isCorrectedSubjectRules(document: CatalogReleaseDocument, release: CatalogReleaseNode): boolean {
  return document.source.path === TYPED_CHANGESET_SOURCE_PATH &&
    subjectRulesProvenance(document)?.reviewReference === release.manifest.release.id;
}

export function subjectRulesSnapshot(subject: CatalogReleaseSubjectDocument["content"]) {
  return {
    ownerSubjectId: subject.ownerSubjectId ?? null,
    ...("nature" in subject.subtype ? { defaults: {
      nature: subject.subtype.nature, cardinality: subject.subtype.cardinality.kind,
    } } : {}),
  };
}
