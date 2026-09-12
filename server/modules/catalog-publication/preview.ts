import { randomUUID } from "node:crypto";

import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseId,
  CatalogReleaseVersion,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
} from "../parameter-catalog-contract/index";
import type { Database } from "../../shared/database/client";
import { classifyImpact } from "./authorization/classify";
import type { ImpactFacts, PublicationRiskClass } from "./authorization/types";
import { buildCompleteSuccessor } from "./builder/completeSuccessor";
import { parseBundleBytes, targetReleaseOf } from "./builder/bundleCodec";
import type {
  CatalogChange,
  CreateDefinitionChange,
  FrozenPublicationIdentity,
  SupportedDefinitionContent,
} from "./builder/types";
import { persistCandidate as storePersistCandidate } from "./persistence/store";
import { getArtifactByDigest } from "./persistence/store";
import type { JsonObject, PublicationCandidateRecord } from "./persistence/types";

export const PUBLICATION_REQUEST_SCOPE = "instance:catalog-publication";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const mintToken = (): string => randomUUID().replace(/-/g, "").slice(0, 16);

const mintPrefixed = (prefix: string): string => `${prefix}_${mintToken()}`;

const canonicalUtcSeconds = (date = new Date()): string =>
  date.toISOString().replace(/\.\d{3}Z$/u, "Z");

const bumpReleaseVersion = (version: string): string => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) {
    return `${version}.1`;
  }
  return `${match[1]}.${Number(match[2]) + 1}.0`;
};

export type PreviewPublicationError =
  | { readonly kind: "artifact-missing" }
  | { readonly kind: "predecessor-incomplete"; readonly detail?: string }
  | { readonly kind: "unsupported-catalog-capability"; readonly detail: string }
  | { readonly kind: "unsupported-change-op"; readonly op: string }
  | { readonly kind: "invalid-input"; readonly reason: string }
  | { readonly kind: "subject-not-found"; readonly subjectId: string }
  | { readonly kind: "persist-failed"; readonly detail: string };

export type PreviewPublicationValue = {
  readonly candidate: PublicationCandidateRecord;
  readonly riskClass: PublicationRiskClass;
  readonly impactFacts: ImpactFacts;
  readonly impactSummary: {
    readonly addedDefinitionCount: number;
    readonly changedDefinitionCount: number;
    readonly addedSubjectCount: number;
  };
};

const asSupportedContent = (value: unknown): SupportedDefinitionContent | null => {
  if (!isRecord(value) || typeof value.displayName !== "string" || typeof value.documentation !== "string") {
    return null;
  }
  if (!isRecord(value.valueSchema) || typeof value.valueSchema.type !== "string") {
    return null;
  }
  return value as unknown as SupportedDefinitionContent;
};

export function parseM1ChangeSet(value: unknown): CreateDefinitionChange[] | { error: PreviewPublicationError } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: { kind: "invalid-input", reason: "changeSet" } };
  }
  const changes: CreateDefinitionChange[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.op !== "string") {
      return { error: { kind: "invalid-input", reason: "changeSet" } };
    }
    if (entry.op !== "create-definition") {
      return { error: { kind: "unsupported-change-op", op: entry.op } };
    }
    const content = asSupportedContent(entry.content);
    if (typeof entry.subjectId !== "string" || typeof entry.propertyKey !== "string" || content === null) {
      return { error: { kind: "invalid-input", reason: "changeSet" } };
    }
    changes.push({
      op: "create-definition",
      subjectId: entry.subjectId,
      propertyKey: entry.propertyKey,
      content,
    });
  }
  return changes;
}

export function m1ImpactFacts(
  authorPrincipalId: string,
  changeSet: readonly CatalogChange[],
): ImpactFacts {
  return {
    authorPrincipalId,
    operations: changeSet.map((change) =>
      change.op === "create-definition"
        ? { op: "create-definition" as const, supported: true }
        : change.op === "revise-definition"
          ? { op: "revise-definition" as const, class: change.class }
          : { op: "create-subject-with-definitions" as const },
    ),
    introducesNewSubject: changeSet.some((change) => change.op === "create-subject-with-definitions"),
    changesSelector: false,
    changesAlias: false,
    changesFallback: false,
    tightensExistingContract: false,
    changesUnitOrSemantic: changeSet.some(
      (change) => change.op === "revise-definition" && change.class === "semantic",
    ),
    retiresIdentity: false,
    unknownImpact: false,
    sourceKind: "typed-changeset",
  };
}

const mintFrozenIdentity = (
  predecessorVersion: string,
  toolchain: FrozenPublicationIdentity["toolchain"],
  changeSet: readonly CreateDefinitionChange[],
): FrozenPublicationIdentity => ({
  candidateId: CatalogCandidateId(mintPrefixed("ccand")),
  artifactId: CatalogArtifactId(mintPrefixed("cart")),
  releaseId: CatalogReleaseId(mintPrefixed("crel")),
  releaseVersion: CatalogReleaseVersion(bumpReleaseVersion(predecessorVersion)),
  publishedAt: canonicalUtcSeconds(),
  toolchain,
  definitions: changeSet.map((change) => {
    const token = mintToken();
    return {
      subjectId: change.subjectId,
      propertyKey: change.propertyKey,
      definitionId: `pdef_${token}`,
      revisionId: `drev_${token}`,
    };
  }),
});

export async function previewPublicationCandidate(input: {
  readonly db: Database;
  readonly predecessorDigest: string;
  readonly changeSet: readonly CreateDefinitionChange[];
  readonly authorPrincipalId: string;
  readonly authorOrganizationId: string;
  readonly proposalId?: string;
  readonly proposalRevisionId?: string;
}): Promise<{ ok: true; value: PreviewPublicationValue } | { ok: false; error: PreviewPublicationError }> {
  const artifact = await getArtifactByDigest(input.db, input.predecessorDigest);
  if (!artifact.ok) {
    return { ok: false, error: { kind: "artifact-missing" } };
  }
  const parsed = parseBundleBytes(artifact.value.artifactBytes);
  if (!parsed.ok) {
    return { ok: false, error: { kind: "predecessor-incomplete", detail: parsed.detail } };
  }
  const predecessorTarget = targetReleaseOf(parsed.bundle);
  if (!predecessorTarget) {
    return { ok: false, error: { kind: "predecessor-incomplete", detail: "predecessor-target-missing" } };
  }
  const toolchain = predecessorTarget.manifest.toolchain;
  const frozen = mintFrozenIdentity(
    predecessorTarget.manifest.release.version,
    {
      compiler: toolchain.compiler,
      jsonSchemaDialect: toolchain.jsonSchemaDialect,
      sourceFormat: toolchain.sourceFormat,
    },
    input.changeSet,
  );
  const facts = m1ImpactFacts(input.authorPrincipalId, input.changeSet);
  const classified = classifyImpact(facts);
  if (!classified.ok) {
    return {
      ok: false,
      error: { kind: "unsupported-catalog-capability", detail: classified.error.reason },
    };
  }

  const proposal =
    input.proposalId && input.proposalRevisionId
      ? {
          proposalId: DefinitionProposalId(input.proposalId),
          proposalRevisionId: DefinitionProposalRevisionId(input.proposalRevisionId),
        }
      : null;

  const built = await buildCompleteSuccessor({
    predecessorArtifact: { digest: input.predecessorDigest, bytes: artifact.value.artifactBytes },
    changeSet: input.changeSet,
    frozenIdentity: frozen,
    proposal,
    productPath: "m1",
    persist: {
      db: input.db,
      ports: {
        persistCandidate: async (db, candidateInput) =>
          storePersistCandidate(db, {
            ...candidateInput,
            identityAllocation: {
              ...candidateInput.identityAllocation,
              authorPrincipalId: input.authorPrincipalId,
              authorOrganizationId: input.authorOrganizationId,
              impactFacts: facts as unknown as JsonObject,
            },
          }),
      },
    },
  });

  if (!built.ok) {
    if (built.error.kind === "artifact-missing") {
      return { ok: false, error: { kind: "artifact-missing" } };
    }
    if (built.error.kind === "predecessor-incomplete") {
      return { ok: false, error: { kind: "predecessor-incomplete" } };
    }
    if (built.error.kind === "unsupported-catalog-capability") {
      return { ok: false, error: { kind: "unsupported-catalog-capability", detail: built.error.detail } };
    }
    if (built.error.kind === "unsupported-change-op") {
      return { ok: false, error: { kind: "unsupported-change-op", op: built.error.op } };
    }
    if (built.error.kind === "subject-not-found") {
      return { ok: false, error: { kind: "subject-not-found", subjectId: built.error.subjectId } };
    }
    if (built.error.kind === "persist-failed") {
      return { ok: false, error: { kind: "persist-failed", detail: built.error.stage } };
    }
    return { ok: false, error: { kind: "invalid-input", reason: built.error.kind } };
  }
  if (built.value.kind !== "successor" || built.value.persistence.kind !== "persisted") {
    return { ok: false, error: { kind: "persist-failed", detail: "candidate-not-persisted" } };
  }

  return {
    ok: true,
    value: {
      candidate: built.value.persistence.candidate,
      riskClass: classified.value,
      impactFacts: facts,
      impactSummary: {
        addedDefinitionCount: built.value.impact.definitions.added.length,
        changedDefinitionCount: built.value.impact.definitions.changed.length,
        addedSubjectCount: built.value.impact.subjects.added.length,
      },
    },
  };
}
