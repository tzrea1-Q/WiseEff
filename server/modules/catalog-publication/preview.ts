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
import { buildCompleteSuccessor, persistSuccessorBuild } from "./builder/completeSuccessor";
import { parseBundleBytes, targetReleaseOf } from "./builder/bundleCodec";
import type { CatalogReleaseNode } from "../catalog-kernel/compiler/types";
import type {
  CatalogChange,
  CatalogImpactReport,
  CreateDefinitionChange,
  CreateSubjectWithDefinitionsChange,
  FrozenPublicationIdentity,
  ReviseDefinitionChange,
  SupportedDefinitionContent,
} from "./builder/types";
import { persistCandidate as storePersistCandidate } from "./persistence/store";
import { persistArtifact as storePersistArtifact } from "./persistence/store";
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
    readonly addedSubjectIds?: readonly string[];
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

const parseSelector = (
  value: unknown,
): CreateSubjectWithDefinitionsChange["selector"] | null => {
  if (!isRecord(value) || typeof value.value !== "string") {
    return null;
  }
  if (value.kind !== "driver-compatible" && value.kind !== "node-type-name") {
    return null;
  }
  return { kind: value.kind, value: value.value };
};

export function parsePublicationChangeSet(
  value: unknown,
): CatalogChange[] | { error: PreviewPublicationError } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: { kind: "invalid-input", reason: "changeSet" } };
  }
  const changes: CatalogChange[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.op !== "string") {
      return { error: { kind: "invalid-input", reason: "changeSet" } };
    }
    if (entry.op === "create-definition") {
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
      continue;
    }
    if (entry.op === "revise-definition") {
      const content = asSupportedContent(entry.content);
      if (
        typeof entry.definitionId !== "string" ||
        (entry.class !== "documentation" && entry.class !== "semantic") ||
        content === null
      ) {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      changes.push({
        op: "revise-definition",
        definitionId: entry.definitionId,
        class: entry.class,
        content,
      });
      continue;
    }
    if (entry.op === "create-subject-with-definitions") {
      const selector = parseSelector(entry.selector);
      if (
        (entry.kind !== "driver" && entry.kind !== "node-type") ||
        typeof entry.canonicalKey !== "string" ||
        selector === null ||
        !Array.isArray(entry.definitions)
      ) {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      const nested: CreateSubjectWithDefinitionsChange["definitions"][number][] = [];
      for (const definition of entry.definitions) {
        if (!isRecord(definition) || "subjectId" in definition) {
          return { error: { kind: "invalid-input", reason: "changeSet" } };
        }
        const content = asSupportedContent(definition.content);
        if (typeof definition.propertyKey !== "string" || content === null) {
          return { error: { kind: "invalid-input", reason: "changeSet" } };
        }
        nested.push({ propertyKey: definition.propertyKey, content });
      }
      const nature =
        entry.nature === "physical-device" || entry.nature === "logical-service"
          ? entry.nature
          : undefined;
      const cardinality =
        entry.cardinality === "multiple" || entry.cardinality === "singleton-per-project"
          ? entry.cardinality
          : undefined;
      changes.push({
        op: "create-subject-with-definitions",
        kind: entry.kind,
        canonicalKey: entry.canonicalKey,
        selector,
        ...(nature ? { nature } : {}),
        ...(cardinality ? { cardinality } : {}),
        definitions: nested,
      });
      continue;
    }
    return { error: { kind: "unsupported-change-op", op: entry.op } };
  }
  return changes;
}

export function parseM1ChangeSet(value: unknown): CreateDefinitionChange[] | { error: PreviewPublicationError } {
  const parsed = parsePublicationChangeSet(value);
  if ("error" in parsed) {
    return parsed;
  }
  const unsupported = parsed.find((change) => change.op !== "create-definition");
  if (unsupported) {
    return { error: { kind: "unsupported-change-op", op: unsupported.op } };
  }
  return parsed as CreateDefinitionChange[];
}

export function publicationImpactFacts(
  authorPrincipalId: string,
  changeSet: readonly CatalogChange[],
  impact: CatalogImpactReport,
): ImpactFacts {
  const confirmedClass = new Map(
    impact.definitions.changed.map((entry) => [entry.definitionId, entry.contentClass]),
  );
  return {
    authorPrincipalId,
    operations: changeSet.map((change) => {
      if (change.op === "create-definition") {
        return { op: "create-definition" as const, supported: true };
      }
      if (change.op === "revise-definition") {
        return {
          op: "revise-definition" as const,
          class: confirmedClass.get(change.definitionId) ?? change.class,
        };
      }
      return { op: "create-subject-with-definitions" as const };
    }),
    introducesNewSubject: impact.subjects.added.length > 0,
    changesSelector:
      impact.selectors.added.length > 0 ||
      impact.selectors.changed.length > 0 ||
      impact.selectors.removed.length > 0,
    changesAlias: impact.aliases.added.length > 0 || impact.aliases.changed.length > 0,
    changesFallback: impact.matcher.fallbackImpact,
    tightensExistingContract: impact.existingContractsTighten,
    changesUnitOrSemantic: impact.definitions.changed.some((entry) => entry.contentClass === "semantic"),
    retiresIdentity: false,
    unknownImpact: false,
    sourceKind: "typed-changeset",
  };
}

/** @deprecated Use publicationImpactFacts with the builder impact report. */
export function m1ImpactFacts(
  authorPrincipalId: string,
  changeSet: readonly CatalogChange[],
): ImpactFacts {
  return publicationImpactFacts(authorPrincipalId, changeSet, {
    schemaVersion: "catalog-impact/v1",
    predecessor: { releaseId: "", digest: "" },
    successor: { releaseId: "", digest: "" },
    definitions: { added: [], changed: [], unchanged: [] },
    subjects: {
      added: changeSet.some((change) => change.op === "create-subject-with-definitions") ? ["new"] : [],
      changed: [],
      unchanged: [],
    },
    aliases: { added: [], changed: [], unchanged: [] },
    selectors: { added: [], changed: [], removed: [] },
    matcher: {
      existingMatchRulesChanged: false,
      fallbackImpact: false,
      newMatchableProperties: [],
    },
    existingContractsTighten: false,
    capabilityContractRevision: "catalog-capability/v1",
  });
}

const mintFrozenIdentity = (
  predecessorVersion: string,
  toolchain: FrozenPublicationIdentity["toolchain"],
  changeSet: readonly CatalogChange[],
  predecessorTarget: CatalogReleaseNode,
): FrozenPublicationIdentity => {
  const definitions: FrozenPublicationIdentity["definitions"][number][] = [];
  const subjects: NonNullable<FrozenPublicationIdentity["subjects"]>[number][] = [];
  const predecessorDefinitions = predecessorTarget.documents.filter(
    (document) => document.kind === "definition",
  );
  for (const change of changeSet) {
    if (change.op === "create-definition") {
      const token = mintToken();
      definitions.push({
        subjectId: change.subjectId,
        propertyKey: change.propertyKey,
        definitionId: `pdef_${token}`,
        revisionId: `drev_${token}`,
      });
      continue;
    }
    if (change.op === "create-subject-with-definitions") {
      const subjectId = `csub_${mintToken()}`;
      subjects.push({ canonicalKey: change.canonicalKey, subjectId });
      for (const nested of change.definitions) {
        const token = mintToken();
        definitions.push({
          subjectId,
          propertyKey: nested.propertyKey,
          definitionId: `pdef_${token}`,
          revisionId: `drev_${token}`,
        });
      }
      continue;
    }
    const current = predecessorDefinitions.find(
      (document) => document.kind === "definition" && document.content.id === change.definitionId,
    );
    if (current?.kind !== "definition") {
      continue;
    }
    definitions.push({
      subjectId: current.content.subjectId,
      propertyKey: current.content.propertyKey,
      definitionId: current.content.id,
      revisionId: `drev_${mintToken()}`,
    });
  }
  return {
    candidateId: CatalogCandidateId(mintPrefixed("ccand")),
    artifactId: CatalogArtifactId(mintPrefixed("cart")),
    releaseId: CatalogReleaseId(mintPrefixed("crel")),
    releaseVersion: CatalogReleaseVersion(bumpReleaseVersion(predecessorVersion)),
    publishedAt: canonicalUtcSeconds(),
    toolchain,
    definitions,
    subjects,
  };
};

export async function previewPublicationCandidate(input: {
  readonly db: Database;
  readonly predecessorDigest: string;
  readonly changeSet: readonly CatalogChange[];
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
    predecessorTarget,
  );
  const proposal =
    input.proposalId && input.proposalRevisionId
      ? {
          proposalId: DefinitionProposalId(input.proposalId),
          proposalRevisionId: DefinitionProposalRevisionId(input.proposalRevisionId),
        }
      : null;
  const productPath = input.changeSet.some((change) => change.op !== "create-definition")
    ? "m2-core"
    : "m1";

  const built = await buildCompleteSuccessor({
    predecessorArtifact: { digest: input.predecessorDigest, bytes: artifact.value.artifactBytes },
    changeSet: input.changeSet,
    frozenIdentity: frozen,
    proposal,
    productPath,
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
    if (built.error.kind === "conflict") {
      return {
        ok: false,
        error: { kind: "unsupported-catalog-capability", detail: built.error.reason },
      };
    }
    if (built.error.kind === "persist-failed") {
      return { ok: false, error: { kind: "persist-failed", detail: built.error.stage } };
    }
    return { ok: false, error: { kind: "invalid-input", reason: built.error.kind } };
  }
  if (built.value.kind !== "successor") {
    return { ok: false, error: { kind: "invalid-input", reason: "noop-revise" } };
  }

  const facts = publicationImpactFacts(input.authorPrincipalId, input.changeSet, built.value.impact);
  const classified = classifyImpact(facts);
  if (!classified.ok) {
    return {
      ok: false,
      error: { kind: "unsupported-catalog-capability", detail: classified.error.reason },
    };
  }

  const impactSummary = {
    addedDefinitionCount: built.value.impact.definitions.added.length,
    changedDefinitionCount: built.value.impact.definitions.changed.length,
    addedSubjectCount: built.value.impact.subjects.added.length,
    ...(built.value.impact.subjects.added.length > 0
      ? { addedSubjectIds: built.value.impact.subjects.added }
      : {}),
  };
  const persisted = await persistSuccessorBuild(
    {
      db: input.db,
      ports: {
        persistArtifact: storePersistArtifact,
        persistCandidate: async (db, candidateInput) =>
          storePersistCandidate(db, {
            ...candidateInput,
            identityAllocation: {
              ...candidateInput.identityAllocation,
              authorPrincipalId: input.authorPrincipalId,
              authorOrganizationId: input.authorOrganizationId,
              impactFacts: facts as unknown as JsonObject,
              impactSummary,
            },
          }),
      },
    },
    built.value.artifact,
    built.value.candidate,
  );
  if ("ok" in persisted) {
    return { ok: false, error: { kind: "persist-failed", detail: persisted.error.kind } };
  }
  if (persisted.kind !== "persisted") {
    return { ok: false, error: { kind: "persist-failed", detail: "candidate-not-persisted" } };
  }

  return {
    ok: true,
    value: {
      candidate: persisted.candidate,
      riskClass: classified.value,
      impactFacts: facts,
      impactSummary,
    },
  };
}
