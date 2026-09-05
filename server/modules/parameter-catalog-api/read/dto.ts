import type {
  CatalogDefinitionPublicationFact,
  CatalogSnapshot,
  CatalogSubjectDetailSnapshot,
  CatalogSubjectSnapshot,
  DefinitionRevisionSnapshot,
  ParameterDefinitionSnapshot,
  SubjectAliasSnapshot,
} from "../../catalog-kernel/interface";
import {
  catalogDefinitionDtoSchema,
  catalogDefinitionRevisionDtoSchema,
  catalogDocumentDtoSchema,
  catalogSubjectDtoSchema,
  catalogTimelineFactDtoSchema,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogCursor, OptionalValue } from "../../parameter-catalog-contract/index";
import type {
  CatalogDocumentFacts,
  CatalogRegistrationProjection,
  CatalogUsageSummary,
  ComposedTimelineFact,
  LoadedCatalogSnapshot,
} from "./types";

const optionalString = (value: { kind: "present"; value: string } | { kind: "absent" }): string | null =>
  value.kind === "present" ? value.value : null;

const aliasValue = (alias: SubjectAliasSnapshot): string => alias.selector.value;

const subjectAliases = (subject: CatalogSubjectSnapshot): readonly string[] => {
  if (!("aliases" in subject) || !Array.isArray(subject.aliases)) {
    return [];
  }
  return (subject.aliases as readonly SubjectAliasSnapshot[]).map(aliasValue);
};

const subjectDefinitionCounts = (
  subject: CatalogSubjectSnapshot,
): { active: number; deprecated: number; retired: number } => {
  if ("definitionCounts" in subject && subject.definitionCounts) {
    return subject.definitionCounts as { active: number; deprecated: number; retired: number };
  }
  return { active: 0, deprecated: 0, retired: 0 };
};

export function mapCatalogDocument(
  snapshot: LoadedCatalogSnapshot,
  facts: CatalogDocumentFacts,
): ReturnType<typeof catalogDocumentDtoSchema.parse> {
  const fingerprint =
    snapshot.snapshotKind === "current"
      ? snapshot.materializationFingerprint
      : facts.materializationFingerprint;
  return catalogDocumentDtoSchema.parse({
    catalogReleaseId: snapshot.release.id,
    releaseName: snapshot.release.version,
    releaseSequence: facts.releaseSequence,
    publishedAt: facts.publishedAt,
    materializedAt: facts.materializedAt,
    status: "ready",
    digest: snapshot.release.digest,
    materializationFingerprint: fingerprint,
    links: {
      subjects: "/api/v2/catalog/subjects",
      definitions: "/api/v2/catalog/definitions",
    },
  });
}

export function mapCatalogSubject(
  subject: CatalogSubjectSnapshot | CatalogSubjectDetailSnapshot,
  registration: CatalogRegistrationProjection,
  options: { readonly reviewCount?: number; readonly availableActions?: ReadonlyArray<"register"> } = {},
): ReturnType<typeof catalogSubjectDtoSchema.parse> {
  return catalogSubjectDtoSchema.parse({
    id: subject.id,
    type: subject.kind,
    canonicalName: subject.canonicalKey,
    aliases: subjectAliases(subject),
    membership: {
      status: subject.membership.lifecycle,
      catalogReleaseId: subject.membership.release.id,
    },
    registration,
    definitionCounts: subjectDefinitionCounts(subject),
    ...(options.reviewCount !== undefined ? { reviewCount: options.reviewCount } : {}),
    ...(options.availableActions && options.availableActions.length > 0
      ? { availableActions: [...options.availableActions] }
      : {}),
  });
}

export function mapDefinitionRevision(
  revision: DefinitionRevisionSnapshot,
): ReturnType<typeof catalogDefinitionRevisionDtoSchema.parse> {
  return catalogDefinitionRevisionDtoSchema.parse({
    id: revision.id,
    definitionId: revision.definitionId,
    revisionNumber: revision.revisionNumber,
    contentDigest: revision.contentDigest,
    valueShape: revision.content.valueShape,
    constraints: revision.content.constraints,
    documentation: optionalString(revision.content.documentation),
    publishedInCatalogReleaseId: revision.publishedIn.id,
  });
}

export function mapCatalogDefinition(
  snapshot: CatalogSnapshot,
  definition: ParameterDefinitionSnapshot,
  registration: CatalogRegistrationProjection,
  usage: CatalogUsageSummary,
): ReturnType<typeof catalogDefinitionDtoSchema.parse> | null {
  if (!definition.selectedRevision?.content) {
    return null;
  }
  const owner = snapshot.getSubject(definition.subjectId);
  if (owner.status !== "found" && owner.status !== "retired") {
    return null;
  }
  const subject = owner.subject;
  return catalogDefinitionDtoSchema.parse({
    id: definition.id,
    subject: {
      id: subject.id,
      type: subject.kind,
      canonicalName: subject.canonicalKey,
    },
    propertyKey: definition.propertyKey,
    lifecycle: definition.selectedRevision.content.lifecycle,
    currentRevision: mapDefinitionRevision(definition.selectedRevision),
    registration,
    usageSummary: usage,
    links: {
      revisions: `/api/v2/catalog/definitions/${definition.id}/revisions`,
      timeline: `/api/v2/catalog/definitions/${definition.id}/timeline`,
    },
  });
}

export function mapPublicationFact(fact: CatalogDefinitionPublicationFact): ComposedTimelineFact {
  return catalogTimelineFactDtoSchema.parse({
    id: fact.id,
    kind: "catalog-publication",
    definitionId: fact.definitionId,
    revisionId: fact.revisionId,
    revisionNumber: fact.revisionNumber,
    catalogReleaseId: fact.release.id,
    publishedAt: fact.publishedAt,
    changes: [...fact.changes],
  });
}

export function nextCursorValue(next: OptionalValue<CatalogCursor>): string | null {
  return next.kind === "present" ? next.value : null;
}

export function emptyReasonFor(
  itemCount: number,
  kind: "subjects" | "definitions" | "revisions" | "timeline",
  filtered: boolean,
  options?: { readonly noRegistrations?: boolean },
): "no-definitions" | "no-filter-match" | "no-registrations" | undefined {
  if (itemCount > 0) {
    return undefined;
  }
  if (options?.noRegistrations) {
    return "no-registrations";
  }
  if (filtered) {
    return "no-filter-match";
  }
  return kind === "definitions" ? "no-definitions" : "no-filter-match";
}
