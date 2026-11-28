import { randomUUID } from "node:crypto";

import { timeCatalogStage } from "../../observability/catalogPublicationStages";
import { artifactReadFailure, type ArtifactReadFailure } from "./persistence/artifactReadFailure";
import {
  CatalogArtifactId,
  CatalogCandidateId,
  CatalogReleaseId,
  CatalogReleaseVersion,
  DefinitionProposalId,
  DefinitionProposalRevisionId,
} from "../parameter-catalog-contract/index";
import type { Database } from "../../shared/database/client";
import { isSubjectIdentityOp, isSubjectRulesOp, subjectIdentityChangeSchema,
  type SubjectIdentityChange, type SubjectIdentityImpact } from "../contracts/dtoSchemas/catalogSubjectIdentity";
import { inspectSubjectRulesImpact } from "./subjectRulesImpact";
import { classifyImpact } from "./authorization/classify";
import type { OwnerDeclaration } from "./claimedOwners";
import type { ImpactFacts, PublicationRiskClass } from "./authorization/types";
import {
  buildCompleteSuccessor,
  buildSuccessorFromSnapshot,
  impactSummaryFromReport,
  persistSuccessorBuild,
} from "./builder/completeSuccessor";
import { targetReleaseOf } from "./builder/bundleCodec";
import { appendPreviewSnapshot, canAppendPreviewSnapshot, checkDriverSpellingHistory, identitySnapshotOf, onlyDefinitionEdits, onlyDriverCreations, withPreviewBaseline } from "./builder/identitySnapshot";
import {
  readPreparedPredecessor,
  preparedPredecessorBundle,
  type PreparedPredecessorArtifact,
} from "./builder/preparedPredecessor";
import type { CatalogReleaseNode } from "../catalog-kernel/compiler/types";
import { freezeCatalogJson, INSTALL_CHAIN_COMPILER, INSTALL_CHAIN_SOURCE_FORMAT } from "../catalog-kernel/compiler/index";
import { CATALOG_BASELINE_READER_ROLE } from "../catalog-kernel/security/catalogRoleManifest";
import type {
  BuildCompleteSuccessorInput,
  CatalogChange,
  CatalogImpactReport,
  CreateDefinitionChange,
  CreateSubjectWithDefinitionsChange,
  FrozenPublicationIdentity,
  ReviseDefinitionChange,
  SupportedDefinitionContent,
} from "./builder/types";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "./builder/types";
import { persistCandidate as storePersistCandidate } from "./persistence/store";
import { persistArtifact as storePersistArtifact } from "./persistence/store";
import { getValidatedPreviewSnapshot, putValidatedPreviewSnapshot } from "./persistence/store";
import type { JsonObject, PreviewSnapshot, PublicationCandidateRecord } from "./persistence/types";

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
  | ArtifactReadFailure
  | { readonly kind: "predecessor-incomplete"; readonly detail?: string }
  | { readonly kind: "unsupported-catalog-capability"; readonly detail: string }
  | { readonly kind: "unsupported-change-op"; readonly op: string }
  | { readonly kind: "invalid-input"; readonly reason: string }
  | { readonly kind: "subject-not-found"; readonly subjectId: string }
  | { readonly kind: "subject-not-active"; readonly subjectId: string }
  | { readonly kind: "definition-already-exists" }
  | { readonly kind: "subject-selector-occupied" }
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
    readonly ownerDeclarations?: readonly OwnerDeclaration[];
    readonly ownerPublicationOnly?: boolean;
    readonly subjectIdentity?: SubjectIdentityImpact;
    readonly definitionSuccessorChange?: {
      readonly definitionId: string;
      readonly successorDefinitionId: string | null;
      readonly successorLabel: string | null;
      readonly reason: string | null;
    };
    readonly definitionReplacement?: {
      readonly definitionId: string;
      readonly propertyKey: string;
      readonly subjectId: string;
    };
  };
};

const asSupportedContent = (value: unknown): SupportedDefinitionContent | null => {
  if (!isRecord(value) || typeof value.displayName !== "string" || typeof value.documentation !== "string") {
    return null;
  }
  if (!isRecord(value.valueSchema) || (typeof value.valueSchema.type !== "string" &&
    (value.valueSchema.type !== undefined || typeof value.valueSchema.description !== "string"))) {
    return null;
  }
  if (value.description != null && typeof value.description !== "string") {
    return null;
  }
  if (value.lifecycle !== undefined && value.lifecycle !== "active" && value.lifecycle !== "retired") {
    return null;
  }
  return value as unknown as SupportedDefinitionContent;
};

const parseSelector = (
  value: unknown,
  configurationSchema = false,
): CreateSubjectWithDefinitionsChange["selector"] | null => {
  if (!isRecord(value) || typeof value.value !== "string") {
    return null;
  }
  if (value.kind !== "driver-compatible" && value.kind !== "node-type-name"
    && !(configurationSchema && value.kind === "configuration-schema-id")) {
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
    if (isSubjectIdentityOp(entry.op)) {
      const parsed = subjectIdentityChangeSchema.safeParse(entry);
      if (!parsed.success) return { error: { kind: "invalid-input", reason: "changeSet" } };
      changes.push(parsed.data);
      continue;
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
    if (entry.op === "retire-definition" || entry.op === "restore-definition") {
      const content = asSupportedContent(entry.content);
      if (
        typeof entry.definitionId !== "string" ||
        (entry.class !== undefined && entry.class !== "documentation" && entry.class !== "semantic") ||
        (entry.reason !== undefined && typeof entry.reason !== "string") ||
        content === null
      ) {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      changes.push({
        op: entry.op,
        definitionId: entry.definitionId,
        ...(entry.class !== undefined ? { class: entry.class } : {}),
        ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        content,
      });
      continue;
    }
    if (entry.op === "revise-definition") {
      const content = entry.content === undefined ? undefined : asSupportedContent(entry.content);
      const successor = entry.successorDefinitionId;
      if (
        typeof entry.definitionId !== "string" ||
        (entry.class !== "documentation" && entry.class !== "semantic") ||
        content === null || (content === undefined && successor === undefined) ||
        (successor !== undefined && successor !== null && (typeof successor !== "string" || !successor)) ||
        (entry.reason !== undefined && typeof entry.reason !== "string")
      ) {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      changes.push({
        op: "revise-definition",
        definitionId: entry.definitionId,
        class: entry.class,
        ...(content === undefined ? {} : { content }),
        ...(successor === undefined ? {} : { successorDefinitionId: successor }),
        ...(typeof entry.reason === "string" ? { reason: entry.reason } : {}),
      });
      continue;
    }
    if (entry.op === "declare-subject-owner") {
      if (typeof entry.subjectId !== "string" || typeof entry.ownerSubjectId !== "string") {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      changes.push({ op: entry.op, subjectId: entry.subjectId, ownerSubjectId: entry.ownerSubjectId });
      continue;
    }
    if (entry.op === "create-subject-with-definitions" || entry.op === "create-subject") {
      const selector = parseSelector(entry.selector, entry.op === "create-subject");
      if (
        (entry.kind !== "driver" && entry.kind !== "node-type" && !(entry.op === "create-subject" && entry.kind === "configuration-schema")) ||
        typeof entry.canonicalKey !== "string" ||
        (entry.ownerSubjectId !== undefined && typeof entry.ownerSubjectId !== "string") ||
        selector === null ||
        (entry.op === "create-subject" ? "definitions" in entry : !Array.isArray(entry.definitions))
      ) {
        return { error: { kind: "invalid-input", reason: "changeSet" } };
      }
      const nested: CreateSubjectWithDefinitionsChange["definitions"][number][] = [];
      for (const definition of entry.op === "create-subject" ? [] : entry.definitions as unknown[]) {
        if (!isRecord(definition) || "subjectId" in definition) {
          return { error: { kind: "invalid-input", reason: "changeSet" } };
        }
        const content = asSupportedContent(definition.content);
        if (typeof definition.propertyKey !== "string" || content === null) {
          return { error: { kind: "invalid-input", reason: "changeSet" } };
        }
        nested.push({ propertyKey: definition.propertyKey, content });
      }
      const nature: CreateSubjectWithDefinitionsChange["nature"] =
        entry.nature === "physical-device" || entry.nature === "logical-service"
          ? entry.nature
          : undefined;
      const cardinality: CreateSubjectWithDefinitionsChange["cardinality"] =
        entry.cardinality === "multiple" || entry.cardinality === "singleton-per-project"
          ? entry.cardinality
          : undefined;
      const subject = {
        kind: entry.kind,
        canonicalKey: entry.canonicalKey,
        ...(typeof entry.ownerSubjectId === "string" ? { ownerSubjectId: entry.ownerSubjectId } : {}),
        selector,
        ...(nature ? { nature } : {}),
        ...(cardinality ? { cardinality } : {}),
      } as const;
      changes.push(entry.op === "create-subject"
        ? { ...subject, op: "create-subject" }
        : { ...subject, op: "create-subject-with-definitions", definitions: nested });
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
      if (isSubjectIdentityOp(change.op)) return { op: "correct-subject-identity" as const };
      if (change.op === "create-definition") {
        return { op: "create-definition" as const, supported: true };
      }
      if (change.op === "revise-definition") {
        return {
          op: "revise-definition" as const,
          class: confirmedClass.get(change.definitionId) ?? change.class,
        };
      }
      if (change.op === "retire-definition" || change.op === "restore-definition") {
        return {
          op: "revise-definition" as const,
          class: confirmedClass.get(change.definitionId) ?? change.class ?? "semantic",
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
    changesFallback: impact.matcher.fallbackImpact || changeSet.some((change) => change.op === "declare-subject-owner"),
    tightensExistingContract: impact.existingContractsTighten,
    changesUnitOrSemantic: impact.definitions.changed.some((entry) => entry.contentClass === "semantic"),
    retiresIdentity: changeSet.some(
      (change) => change.op === "retire-definition",
    ),
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
      added: changeSet.some((change) => change.op === "create-subject-with-definitions" || change.op === "create-subject") ? ["new"] : [],
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
    capabilityContractRevision: CATALOG_CAPABILITY_CONTRACT_REVISION,
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
    if (change.op === "create-subject-with-definitions" || change.op === "create-subject") {
      const subjectId = `csub_${mintToken()}`;
      subjects.push({ canonicalKey: change.canonicalKey, subjectId,
        ...(change.ownerSubjectId ? { ownerSubjectId: change.ownerSubjectId } : {}) });
      for (const nested of change.op === "create-subject" ? [] : change.definitions) {
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
    if (!("definitionId" in change)) continue;
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

type PreviewInput = {
  readonly db: Database;
  readonly predecessorDigest: string;
  readonly predecessorArtifact?: PreparedPredecessorArtifact;
  readonly changeSet: readonly CatalogChange[];
  readonly authorPrincipalId: string;
  readonly authorOrganizationId: string;
  readonly replacementSourceDefinitionId?: string;
  readonly proposalId?: string;
  readonly proposalRevisionId?: string;
  readonly markdownSource?: { readonly fileName: string; readonly sha256: string; readonly parserVersion: string };
};

type PreviewResult = { ok: true; value: PreviewPublicationValue } | { ok: false; error: PreviewPublicationError };
type PreparedPreview = { ok: true; value: { persist(db: Database): Promise<PreviewResult> } }
  | { ok: false; error: PreviewPublicationError };

/** Pure candidate preparation and database reads. The import rechecks its base before persisting. */
export const preparePublicationCandidate = (input: PreviewInput & { readonly moduleDriverImport?: true }) => prepare(input, true);
export const previewPublicationCandidate = (input: PreviewInput) => preview(input);

const previewSnapshotAccess = async (db: Database) => (await db.query<{ available: boolean; can_read: boolean; checkpoint_format: boolean }>(
  `select exists (select from pg_catalog.pg_attribute where attrelid=to_regclass('catalog_publication.preview_snapshots')
    and attname='has_dts_examples' and not attisdropped) as available,
    to_regclass('catalog_publication.activation_checkpoints') is not null as checkpoint_format,
    pg_catalog.pg_has_role(session_user, to_regrole($1), 'SET') as can_read`,
  [CATALOG_BASELINE_READER_ROLE],
)).rows[0];

const loadPreviewSnapshot = (db: Database, digest: string, scope?: "definitions" | "spellings") =>
  withPreviewBaseline(db, tx => getValidatedPreviewSnapshot(tx, digest, scope));

/** The planner and builder share the exact snapshot verified against this artifact. */
export async function prepareMarkdownPlanningSnapshot(db: Database, predecessorDigest: string) {
  const access = await previewSnapshotAccess(db);
  if (!access?.available || !access.can_read) return { ok: true as const, value: null };
  const found = await loadPreviewSnapshot(db, predecessorDigest);
  if (!found.ok) return found.error.kind === "not-found" ? { ok: true as const, value: null }
    : { ok: false as const, error: artifactReadFailure(found.error) };
  const snapshot = freezeCatalogJson(found.value);
  return { ok: true as const, value: {
    target: snapshot.target,
    previewCandidate: (input: PreviewInput) => preview({ ...input, db, predecessorDigest }, snapshot, access.checkpoint_format),
  } };
}

async function preview(input: PreviewInput, planningSnapshot?: PreviewSnapshot, checkpointFormat = false): Promise<PreviewResult> {
  const ready = await prepare(input, true, planningSnapshot, undefined, checkpointFormat);
  return ready.ok ? ready.value.persist(input.db) : ready;
}

async function prepare(input: PreviewInput & { readonly moduleDriverImport?: true }, useSnapshot: boolean, planningSnapshot?: PreviewSnapshot,
  fallbackIdentity?: FrozenPublicationIdentity, planningCheckpointFormat = false):
  Promise<PreparedPreview> {
  const [first] = input.changeSet;
  const spelling = input.changeSet.length === 1 && (first?.op === "rename-subject" || first?.op === "set-subject-alias") ? first : undefined;
  const standaloneDrivers = onlyDriverCreations(input.changeSet);
  // The general publication API preserves its existing capability contract.
  // Only the module import opts into driver checkpoint compilation.
  const drivers = input.moduleDriverImport === true && standaloneDrivers;
  const definitions = Boolean(input.markdownSource && onlyDefinitionEdits(input.changeSet));
  const compactEligible = Boolean(spelling || drivers || definitions);
  // Only compact writers need the storage format before building. Other edits
  // can reject invalid changes before checking whether to save a preview snapshot.
  const access = !planningSnapshot && (spelling || standaloneDrivers || input.markdownSource) ? await previewSnapshotAccess(input.db) : undefined;
  let snapshotsAvailable = planningSnapshot ? true : access?.available;
  let snapshot = useSnapshot && compactEligible && (!spelling || planningSnapshot?.coversSubjectSpellings) ? planningSnapshot : undefined;
  if (snapshotsAvailable && access?.can_read && useSnapshot && compactEligible && !snapshot && !input.predecessorArtifact) {
    const found = await loadPreviewSnapshot(input.db, input.predecessorDigest, spelling ? "spellings" : "definitions");
    if (found.ok) snapshot = found.value;
    else if (found.error.kind !== "not-found") return { ok: false, error: { kind: "predecessor-incomplete", detail: found.error.kind } };
  }
  let predecessorArtifact = input.predecessorArtifact;
  if (!snapshot && !predecessorArtifact) {
    const prepared = await readPreparedPredecessor(input.db, input.predecessorDigest);
    if (!prepared.ok) return { ok: false, error: artifactReadFailure(prepared.error) };
    predecessorArtifact = prepared.value;
  }
  const bundle = predecessorArtifact && preparedPredecessorBundle(predecessorArtifact);
  if (!snapshot && (!bundle || predecessorArtifact?.digest !== input.predecessorDigest)) {
    return { ok: false, error: { kind: "invalid-input", reason: "predecessor-artifact-mismatch" } };
  }
  const predecessorTarget = snapshot?.target ?? (bundle && targetReleaseOf(bundle));
  if (!predecessorTarget) {
    return { ok: false, error: { kind: "predecessor-incomplete", detail: "predecessor-target-missing" } };
  }
  const toolchain = predecessorTarget.manifest.toolchain;
  const useInstallChain = (planningCheckpointFormat || access?.checkpoint_format) && (definitions || drivers);
  const frozen = fallbackIdentity ?? mintFrozenIdentity(
    predecessorTarget.manifest.release.version,
    {
      compiler: useInstallChain ? INSTALL_CHAIN_COMPILER : toolchain.compiler,
      jsonSchemaDialect: toolchain.jsonSchemaDialect,
      sourceFormat: useInstallChain ? INSTALL_CHAIN_SOURCE_FORMAT : toolchain.sourceFormat,
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
  const productPath: "m1" | "m2-core" = input.changeSet.some((change) => change.op !== "create-definition")
    ? "m2-core"
    : "m1";

  const buildInput: BuildCompleteSuccessorInput = {
    predecessorArtifact: predecessorArtifact ?? { digest: input.predecessorDigest },
    changeSet: input.changeSet,
    frozenIdentity: frozen,
    storageFormat: snapshotsAvailable ? "successor-v1" : undefined,
    proposal,
    productPath,
  };
  const built = await timeCatalogStage("candidate-build", () =>
    snapshot ? buildSuccessorFromSnapshot(buildInput, snapshot) : buildCompleteSuccessor(buildInput));
  // Reviewed historical retirements may rely on an earlier successor state.
  // Resolve ambiguous diagnostics against the original complete lineage.
  if (snapshot && !built.ok && built.error.kind === "invalid-release") return prepare(input, false, undefined, frozen);

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
    if (built.error.kind === "subject-not-active") {
      return { ok: false, error: { kind: "subject-not-active", subjectId: built.error.subjectId } };
    }
    if (built.error.kind === "conflict") {
      if (built.error.reason === "duplicate-natural-key") {
        return { ok: false, error: { kind: "definition-already-exists" } };
      }
      if (input.changeSet.some(change => isSubjectIdentityOp(change.op))) {
        return { ok: false, error: { kind: "subject-selector-occupied" } };
      }
      return {
        ok: false,
        error: { kind: "unsupported-catalog-capability", detail: built.error.reason },
      };
    }
    if (built.error.kind === "persist-failed") {
      return { ok: false, error: { kind: "persist-failed", detail: built.error.stage } };
    }
    if (built.error.kind === "invalid-input") return { ok: false, error: built.error };
    if (built.error.kind === "invalid-release") {
      const detail = built.error.violations?.find(violation => violation.detail?.startsWith("definition-successor-"))?.detail;
      if (detail) return { ok: false, error: { kind: "invalid-input", reason: detail } };
      if (input.changeSet.some(change => isSubjectIdentityOp(change.op)) &&
        built.error.violations.some(violation => ["alias-collision", "duplicate-stable-identity", "stable-key-reassigned"].includes(violation.code))) {
        return { ok: false, error: { kind: "subject-selector-occupied" } };
      }
    }
    return { ok: false, error: { kind: "invalid-input", reason: built.error.kind } };
  }
  if (built.value.kind !== "successor") {
    return { ok: false, error: { kind: "invalid-input", reason: "noop-revise" } };
  }
  if (snapshot && drivers) {
    const history = await checkDriverSpellingHistory(input.db, snapshot.target, frozen.subjects ?? []);
    if (history === "occupied") return { ok: false, error: { kind: "subject-selector-occupied" } };
    if (history === "unknown") return prepare(input, false, undefined, frozen);
  }
  if (snapshot && !await canAppendPreviewSnapshot(input.db, snapshot, spelling, frozen, built.value.artifact.artifactDigest)) {
    return prepare(input, false, undefined, frozen);
  }

  const facts = { ...publicationImpactFacts(input.authorPrincipalId, input.changeSet, built.value.impact),
    ...(input.markdownSource ? { sourceKind: "markdown-import" as const } : {}) };
  const classified = classifyImpact(facts);
  if (!classified.ok) {
    return {
      ok: false,
      error: { kind: "unsupported-catalog-capability", detail: classified.error.reason },
    };
  }

  const ownerDeclarations = input.changeSet.flatMap(change => {
    if (change.op !== "declare-subject-owner") return [];
    const subject = predecessorTarget.documents.find(document => document.kind === "subject" && document.content.id === change.subjectId);
    const owner = predecessorTarget.documents.find(document => document.kind === "subject" && document.content.id === change.ownerSubjectId);
    return [{ subjectId: change.subjectId, ownerSubjectId: change.ownerSubjectId,
      subjectName: subject?.kind === "subject" ? subject.content.selector.value : change.subjectId,
      ownerName: owner?.kind === "subject" ? owner.content.selector.value : change.ownerSubjectId }];
  });
  const [change] = input.changeSet;
  const successorChange = input.changeSet.length === 1 && change?.op === "revise-definition" &&
    change.content === undefined && change.successorDefinitionId !== undefined ? change : null;
  const successor = successorChange && predecessorTarget.documents.find(document =>
    document.kind === "definition" && document.content.id === successorChange.successorDefinitionId);
  const replacementChange = input.replacementSourceDefinitionId && input.changeSet.length === 1 && change?.op === "create-definition"
    ? { definitionId: input.replacementSourceDefinitionId, propertyKey: change.propertyKey, subjectId: change.subjectId } : null;
  const identity = input.changeSet.find((change): change is SubjectIdentityChange => isSubjectIdentityOp(change.op));
  const identityIds = identity ? [identity.subjectId, ...(identity.op === "set-subject-alias" && identity.fromSubjectId ? [identity.fromSubjectId] : [])] : [];
  const target = targetReleaseOf(built.value.artifact.bundle);
  const rulesReview = identity && isSubjectRulesOp(identity.op) && target ? await inspectSubjectRulesImpact(input.db, {
    subjectId: identity.subjectId, before: predecessorTarget.documents, after: target.documents,
    includeNatureOverride: true,
  }) : undefined;
  const subjectIdentity = identity ? { change: identity, ...(rulesReview ? { rules: rulesReview.impact } : {}),
    subjects: predecessorTarget.documents.flatMap(document =>
    document.kind === "subject" && identityIds.includes(document.content.id)
      ? [{ id: document.content.id, canonicalName: document.content.selector.value,
          ...(document.content.ownerSubjectId ? { ownerSubjectId: document.content.ownerSubjectId } : {}),
          definitionCount: predecessorTarget.documents.filter(item => item.kind === "definition" && item.content.subjectId === document.content.id).length }]
      : []) } : undefined;
  const impactSummary = { ...impactSummaryFromReport(built.value.impact),
    ...(subjectIdentity ? { subjectIdentity } : {}),
    ...(ownerDeclarations.length ? { ownerDeclarations,
      ownerPublicationOnly: ownerDeclarations.length === input.changeSet.length } : {}),
    ...(successorChange ? { definitionSuccessorChange: {
      definitionId: successorChange.definitionId,
      successorDefinitionId: successorChange.successorDefinitionId ?? null,
      successorLabel: successor?.kind === "definition" ? successor.content.revision.displayName || successor.content.propertyKey : null,
      reason: successorChange.reason ?? null,
    } } : {}),
    ...(replacementChange ? { definitionReplacement: replacementChange } : {}) };
  snapshotsAvailable ??= (await previewSnapshotAccess(input.db))?.available;
  const baseSnapshot = snapshotsAvailable && compactEligible && bundle ? identitySnapshotOf(bundle, predecessorTarget) : undefined;
  // A cold build may reconstruct the entire release history. The deferred write
  // retains only the encoded artifact and the snapshots it will actually store.
  const { bundle: builtBundle, ...artifact } = built.value.artifact;
  const verifiedBase = snapshot ?? baseSnapshot;
  const successorSnapshot = snapshotsAvailable && target && (verifiedBase ?
    appendPreviewSnapshot(verifiedBase, target) : identitySnapshotOf(builtBundle, target));
  const candidate = built.value.candidate;
  const riskClass = classified.value;
  async function persist(writer: Database): Promise<PreviewResult> {
    const persisted = await timeCatalogStage("candidate-persist", () => persistSuccessorBuild(
      {
        db: writer,
        ports: {
          persistArtifact: async (db, artifactInput) => {
            if (baseSnapshot) {
              const saved = await putValidatedPreviewSnapshot(db, input.predecessorDigest, baseSnapshot);
              if (!saved.ok) return saved;
            }
            const stored = await storePersistArtifact(db, artifactInput);
            if (stored.ok && successorSnapshot) {
              const saved = await putValidatedPreviewSnapshot(db, artifact.artifactDigest, successorSnapshot, stored.value.storageFormat);
              if (!saved.ok) return saved;
            }
            return stored;
          },
          persistCandidate: async (db, candidateInput) =>
            storePersistCandidate(db, {
              ...candidateInput,
              identityAllocation: {
                ...candidateInput.identityAllocation,
                authorPrincipalId: input.authorPrincipalId,
                authorOrganizationId: input.authorOrganizationId,
                impactFacts: facts as unknown as JsonObject,
                impactSummary,
                ...(rulesReview && identity && isSubjectRulesOp(identity.op) ? { subjectRulesReview: {
                  subjectId: identity.subjectId, fingerprint: rulesReview.fingerprint,
                } } : {}),
              },
            }),
        },
      },
      input.markdownSource ? { ...artifact, sourceKind: "markdown-import", toolchain: { ...artifact.toolchain, markdownImport: input.markdownSource } } : artifact,
      candidate,
    ));
    if ("ok" in persisted) {
      const failure = persisted.error;
      const cause = failure.kind === "persist-failed" ? failure.cause : undefined;
      const detail = cause && "kind" in cause && cause.kind === "invalid-input" && cause.reason === "artifact-too-large"
        ? cause.reason : failure.kind === "persist-failed" ? failure.stage : failure.kind;
      return { ok: false, error: { kind: "persist-failed", detail } };
    }
    if (persisted.kind !== "persisted") {
      return { ok: false, error: { kind: "persist-failed", detail: "candidate-not-persisted" } };
    }

    return {
      ok: true,
      value: {
        candidate: persisted.candidate,
        riskClass,
        impactFacts: facts,
        impactSummary,
      },
    };
  }
  return { ok: true, value: { persist } };
}
