/**
 * Definition identity correction migration (#847) — service.
 *
 * Orchestrates existing capabilities; it owns no Catalog truth.  Preview mints
 * a successor Candidate through `catalog-publication`'s complete-successor path
 * and freezes the exact preview fingerprint.  Create binds to that fingerprint,
 * inserts the replacement record and per-project manifest, and mints the
 * publication job through the existing Candidate/Authorization enqueue path.
 * Continue/advance migrates only the approved manifest, per project, reporting
 * `completed` / `blocked` / `failed` / `pending` separately.
 */
import { createHash } from "node:crypto";

import {
  CatalogReleaseId,
  serializeContract,
  type CatalogReleasePin,
  type ContractJsonValue,
  type Result,
} from "../parameter-catalog-contract/index";
import type { AuthContext } from "../auth/types";
import { classifyImpact } from "../catalog-publication/authorization/classify";
import { previewPublicationCandidate } from "../catalog-publication/preview";
import type { SupportedDefinitionContent } from "../catalog-publication/builder/types";
import type { Database, Queryable } from "../../shared/database/client";
import { ApiError } from "../../shared/http/errors";
import { withAuditedWrite, type AuditSpec } from "../audit/auditedWrite";
import { getAuthContext } from "../auth/repository";
import { deriveDtsSourceRef } from "../dts/sourceRef";
import { dtsValueToPayload } from "../parameter-bindings/catalogProjectValueSync";
import { digestProjectValuePayload } from "../parameter-bindings/values/repositories";
import {
  proveExactDtsProperty,
  type ExactDtsSourceIdentity,
} from "../parameter-topology/sourcePropertyProof";
import { lockExactSourceRevisionsForProof } from "../parameter-files/sourceVersion";

import {
  evaluateValueCompatibility,
  resolveSourceLocation,
  type ResolvedSourceLocation,
  type SourceProvenanceFacts,
} from "./evaluate";
import { fingerprintReplacementPreview } from "./fingerprint";
import {
  commitGovernanceIdempotency,
  countBindingForDefinition,
  countCurrentReferences,
  countOpenCutovers,
  countOpenDrafts,
  countOpenReviewItems,
  insertReplacement,
  insertReplacementBinding,
  insertReplacementHistoryEvent,
  insertReplacementSourcePin,
  insertReplacementPreview,
  insertReplacementProjects,
  insertReplacementValue,
  listCurrentReferenceProjects,
  listReplacements,
  loadCandidate,
  loadCurrentBindingTips,
  loadCurrentReleasePin,
  loadDefinitionInRelease,
  loadPolicyRevision,
  loadProjects,
  loadReplacement,
  loadReplacementPreview,
  loadReplacementProjects,
  lockReplacementSourceRows,
  lockReplacementWorkflowRows,
  loadRegistration,
  loadSiblingSourceFacts,
  loadSourcePropertyProvenance,
  loadSubjectById,
  loadSubjectInRelease,
  markReplacementProjectBlocked,
  markReplacementProjectCompleted,
  reserveGovernanceIdempotency,
  updateReplacementStatus,
  consumeReplacementPreview,
  type MigrationClient,
  type CurrentTipRow,
  type ReplacementProjectRow,
  type ReplacementRow,
  type SourcePropertyProvenanceRow,
} from "./repositories";
import {
  DEFINITION_REPLACEMENT_CONTINUE_FAMILY,
  DEFINITION_REPLACEMENT_EXECUTE_FAMILY,
  DEFINITION_REPLACEMENT_MAX_PROJECTS,
  DEFINITION_REPLACEMENT_PREVIEW_TTL_MS,
  isControlFree,
  mintReplacementId,
  mintReplacementPreviewId,
  mintReplacementValueId,
  toContractJson,
  type ContinueDefinitionReplacementCommand,
  type CreateDefinitionReplacementCommand,
  type DefinitionReplacementFailure,
  type DefinitionReplacementPreviewView,
  type DefinitionReplacementServiceInput,
  type DefinitionReplacementView,
  type FrozenProjectTip,
  type FrozenSourceProof,
  type GetDefinitionReplacementQuery,
  type ListDefinitionReplacementsQuery,
  type PreviewDefinitionReplacementCommand,
  type ReplacementIdentityView,
  type ReplacementProjectView,
  type ReplacementStatus,
  type TrustedMigrationContext,
} from "./types";

export type CatalogDefinitionMigrationPorts = {
  readonly previewDefinitionReplacement: (
    command: PreviewDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementPreviewView, DefinitionReplacementFailure>>;
  readonly createDefinitionReplacement: (
    command: CreateDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementView, DefinitionReplacementFailure>>;
  readonly continueDefinitionReplacement: (
    command: ContinueDefinitionReplacementCommand,
  ) => Promise<Result<DefinitionReplacementView, DefinitionReplacementFailure>>;
  readonly getDefinitionReplacement: (
    query: GetDefinitionReplacementQuery,
  ) => Promise<Result<DefinitionReplacementView, DefinitionReplacementFailure>>;
  readonly listDefinitionReplacements: (
    query: ListDefinitionReplacementsQuery,
  ) => Promise<Result<{ readonly items: readonly DefinitionReplacementView[] }, DefinitionReplacementFailure>>;
  /** Retirement evidence: an org-wide current-reference count, never manifest-scoped. */
  readonly loadDefinitionRetirementEvidence: (query: {
    readonly organizationId: string;
    readonly definitionId: string;
  }) => Promise<
    Result<
      { readonly remainingCurrentReferenceCount: number; readonly projectIds: readonly string[]; readonly authoritative: true },
      DefinitionReplacementFailure
    >
  >;
};

export type { DefinitionReplacementServiceInput };

const ok = <T>(value: T): Result<T, DefinitionReplacementFailure> => ({ ok: true, value });
const fail = (error: DefinitionReplacementFailure): Result<never, DefinitionReplacementFailure> => ({
  ok: false,
  error,
});

const sha256 = (value: unknown): string =>
  `sha256:${createHash("sha256").update(serializeContract(toContractJson(value))).digest("hex")}`;

const authorizeOrganizationWrite = (
  context: TrustedMigrationContext,
  organizationId: string,
): DefinitionReplacementFailure | null => {
  if (context.actorKind !== "org-admin") {
    return { kind: "permission-denied" };
  }
  if (context.organizationId !== organizationId) {
    return { kind: "permission-denied" };
  }
  if (!isControlFree(context.principalId)) {
    return { kind: "invalid-command", reason: "principalId" };
  }
  return null;
};

const createCommandFingerprint = (command: CreateDefinitionReplacementCommand): string =>
  sha256({
    kind: "create-definition-replacement",
    organizationId: command.organizationId,
    previewId: command.previewId,
    previewFingerprint: command.previewFingerprint,
    context: { actorKind: command.context.actorKind, principalId: command.context.principalId },
  });

const continueCommandFingerprint = (command: ContinueDefinitionReplacementCommand): string =>
  sha256({
    kind: "continue-definition-replacement",
    organizationId: command.organizationId,
    replacementId: command.replacementId,
    projectIds: command.projectIds ? [...command.projectIds].sort() : null,
    context: { actorKind: command.context.actorKind, principalId: command.context.principalId },
  });

type AllocationDefinition = {
  readonly subjectId: string;
  readonly propertyKey: string;
  readonly definitionId: string;
  readonly revisionId: string;
};

const allocationDefinitions = (allocation: Record<string, unknown>): readonly AllocationDefinition[] => {
  const definitions = allocation.definitions;
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (
      typeof record.subjectId !== "string" ||
      typeof record.propertyKey !== "string" ||
      typeof record.definitionId !== "string" ||
      typeof record.revisionId !== "string"
    ) {
      return [];
    }
    return [
      {
        subjectId: record.subjectId,
        propertyKey: record.propertyKey,
        definitionId: record.definitionId,
        revisionId: record.revisionId,
      },
    ];
  });
};

const allocationReleaseId = (allocation: Record<string, unknown>): string | null =>
  typeof allocation.releaseId === "string" && allocation.releaseId.length > 0
    ? allocation.releaseId
    : null;

const valueSchemaOf = (content: unknown): SupportedDefinitionContent["valueSchema"] | null => {
  if (content === null || typeof content !== "object") return null;
  const schema = (content as Record<string, unknown>).valueSchema;
  if (schema === null || typeof schema !== "object") return null;
  return schema as SupportedDefinitionContent["valueSchema"];
};

type TipEvaluation = {
  readonly status: "pending" | "blocked";
  readonly reason: string | null;
  readonly compatible: boolean;
};

const exactSourceIdentityOf = (
  row: SourcePropertyProvenanceRow | null,
  organizationId: string,
  projectId: string,
  propertyKey: string,
): ExactDtsSourceIdentity | null => {
  if (
    !row ||
    Number(row.occurrence_count) !== 1 ||
    !row.property_occurrence_id ||
    !row.node_occurrence_id ||
    !row.file_id ||
    !row.file_version_id ||
    !row.source_name ||
    !row.node_locator
  ) {
    return null;
  }
  return {
    organizationId,
    projectId,
    configSetId: row.config_set_id,
    configRevisionId: row.config_revision_id,
    logicalNodeId: row.logical_node_id,
    fileId: row.file_id,
    fileVersionId: row.file_version_id,
    propertyOccurrenceId: row.property_occurrence_id,
    nodeOccurrenceId: row.node_occurrence_id,
    propertyName: propertyKey,
  };
};

const exactSourceProofOf = async (
  client: MigrationClient,
  objectStore: DefinitionReplacementServiceInput["objectStore"],
  row: SourcePropertyProvenanceRow | null,
  organizationId: string,
  projectId: string,
  propertyKey: string,
): Promise<FrozenSourceProof | null> => {
  if (!objectStore) {
    return null;
  }
  const identity = exactSourceIdentityOf(row, organizationId, projectId, propertyKey);
  if (!identity) return null;
  try {
    const proof = await proveExactDtsProperty(client as unknown as Queryable, objectStore, identity);
    const locator = {
      kind: "dts-property",
      propertyOccurrenceId: proof.propertyOccurrenceId,
      nodeOccurrenceId: proof.nodeOccurrenceId,
      fileVersionId: proof.fileVersionId,
      propertyName: proof.propertyName,
    };
    return {
      sourceOccurrenceId: row!.source_occurrence_id,
      configRevisionId: proof.configRevisionId,
      propertyOccurrenceId: proof.propertyOccurrenceId,
      nodeOccurrenceId: proof.nodeOccurrenceId,
      fileId: proof.fileId,
      fileVersionId: proof.fileVersionId,
      sourceRef: deriveDtsSourceRef({ fileName: proof.sourceName, nodeLocator: proof.nodeLocator }),
      locator,
      locatorDigest: sha256(locator),
      sourceDigest: proof.sourceDigest,
      revisionDigest: proof.revisionDigest,
      sourceSpan: proof.sourceSpan,
      payload: dtsValueToPayload(proof.value),
    };
  } catch {
    return null;
  }
};

const sourceFactsOf = (row: {
  readonly source_ref: string | null;
  readonly config_revision_id: string | null;
  readonly source_occurrence_count: string | number;
  readonly source_file_name: string | null;
  readonly source_node_locator: string | null;
}): SourceProvenanceFacts => ({
  recordedSourceRef: row.source_ref ?? "",
  configRevisionId: row.config_revision_id ?? "",
  occurrenceCount: Number(row.source_occurrence_count ?? 0),
  fileName: row.source_file_name,
  nodeLocator: row.source_node_locator,
});

const evaluateTip = (input: {
  readonly tip: FrozenProjectTip;
  readonly source: ResolvedSourceLocation;
  readonly value: unknown;
  readonly schema: SupportedDefinitionContent["valueSchema"] | null;
}): TipEvaluation => {
  const { tip } = input;
  if (input.source.status === "blocked") {
    return { status: "blocked", reason: input.source.reason, compatible: false };
  }
  if (tip.coupledBindingIds.length > 0) {
    return { status: "blocked", reason: "coupled-source-impact", compatible: false };
  }
  if (input.schema) {
    const compatibility = evaluateValueCompatibility(input.value, input.schema);
    if (!compatibility.compatible) {
      return { status: "blocked", reason: "incompatible-value", compatible: false };
    }
  }
  return { status: "pending", reason: null, compatible: true };
};

export function createParameterCatalogMigrationService(
  input: DefinitionReplacementServiceInput,
): CatalogDefinitionMigrationPorts {
  const { db } = input;
  const now = input.now ?? (() => new Date());

  const resolveAuthContext = async (
    principalId: string,
  ): Promise<AuthContext | null> => {
    try {
      return await getAuthContext(db, principalId);
    } catch {
      return null;
    }
  };

  const auditedTransaction = async <T>(
    principalId: string,
    requestId: string,
    fn: (tx: Database) => Promise<{ result: T; audit: AuditSpec }>,
  ): Promise<T> => {
    const auth = await resolveAuthContext(principalId);
    if (auth) {
      return withAuditedWrite(db, auth, { requestId }, (tx) =>
        fn(tx as unknown as Database),
      );
    }
    return db.transaction(async (tx) => (await fn(tx)).result);
  };

  const identityView = (
    definitionId: string,
    subjectId: string,
    subjectName: string,
    propertyKey: string,
    revisionId: string,
  ): ReplacementIdentityView => ({ definitionId, subjectId, subjectName, propertyKey, revisionId });

  const projectViews = async (
    client: MigrationClient,
    replacement: ReplacementRow,
    rows: readonly ReplacementProjectRow[],
    registrationRequired: boolean,
  ): Promise<readonly ReplacementProjectView[]> => {
    const projectRows = await loadProjects(
      client,
      replacement.organization_id,
      rows.map((row) => row.project_id),
    );
    const nameById = new Map(projectRows.map((row) => [row.id, row.name ?? row.id]));
    const manifestById = new Map(replacement.frozen_manifest.map((tip) => [tip.projectId, tip]));
    return rows.map((row) => {
      const tip = manifestById.get(row.project_id);
      return {
        projectId: row.project_id,
        projectName: nameById.get(row.project_id) ?? row.project_id,
        status: row.status,
        blockerReason: row.blocker_reason,
        oldBindingId: row.old_binding_id,
        oldValueId: row.old_value_id,
        newBindingId: row.new_binding_id,
        newValueId: row.new_value_id,
        valueKind: tip?.valueKind ?? "string",
        compatible: tip ? tip.coupledBindingIds.length === 0 && tip.sourceFormat === "dts" : false,
        attemptCount: row.attempt_count,
        registrationRequired: row.status === "blocked" && row.blocker_reason === "registration-required"
          ? true
          : registrationRequired && row.status !== "completed",
      };
    });
  };

  const replacementView = async (
    client: MigrationClient,
    replacement: ReplacementRow,
  ): Promise<DefinitionReplacementView> => {
    const rows = await loadReplacementProjects(client, replacement.id);
    const registration = await loadRegistration(
      client,
      replacement.organization_id,
      replacement.new_subject_id,
    );
    const oldSubject = await loadSubjectById(client, replacement.old_subject_id);
    const newSubject = await loadSubjectById(client, replacement.new_subject_id);
    return {
      id: replacement.id,
      status: replacement.status,
      organizationId: replacement.organization_id,
      oldIdentity: identityView(
        replacement.old_definition_id,
        replacement.old_subject_id,
        oldSubject?.canonical_key ?? replacement.old_subject_id,
        replacement.old_property_key,
        replacement.old_revision_id,
      ),
      newIdentity: identityView(
        replacement.new_definition_id,
        replacement.new_subject_id,
        newSubject?.canonical_key ?? replacement.new_subject_id,
        replacement.new_property_key,
        replacement.new_revision_id,
      ),
      previewFingerprint: replacement.preview_fingerprint,
      catalogReleaseId:
        replacement.successor_release_id ?? replacement.preview_catalog_release_id,
      candidateId: replacement.candidate_id,
      publicationJobId: replacement.publication_job_id,
      authorizationId: replacement.authorization_id,
      reason: replacement.reason,
      version: Number(replacement.replacement_version),
      projects: await projectViews(
        client,
        replacement,
        rows,
        registration === null || registration.status !== "active",
      ),
      createdAt: new Date(replacement.created_at).toISOString(),
    };
  };

  // -------------------------------------------------------------------------
  // Preview
  // -------------------------------------------------------------------------

  const previewDefinitionReplacement: CatalogDefinitionMigrationPorts["previewDefinitionReplacement"] =
    async (command) => {
      const denial = authorizeOrganizationWrite(command.context, command.organizationId);
      if (denial) return fail(denial);
      if (!isControlFree(command.reason)) {
        return fail({ kind: "invalid-command", reason: "reason" });
      }
      if (
        command.projectIds.length === 0 ||
        command.projectIds.length > DEFINITION_REPLACEMENT_MAX_PROJECTS
      ) {
        return fail({ kind: "invalid-command", reason: "projectIds" });
      }

      // The trusted actor may only select projects it can manage in the current
      // organization (default 1).  Cross-organization selection is refused here
      // and again by the composite FK `(project_id, organization_id)`.
      const selected = await loadProjects(db, command.organizationId, command.projectIds);
      if (selected.length !== new Set(command.projectIds).size) {
        return fail({ kind: "invalid-command", reason: "cross-organization-project" });
      }
      if (selected.some((project) => project.organization_id !== command.organizationId)) {
        return fail({ kind: "invalid-command", reason: "cross-organization-project" });
      }

      const release = command.expectedRelease;
      const current = await loadCurrentReleasePin(db);
      if (!current || current.id !== release.id) {
        return fail({
          kind: "release-drift",
          expected: release,
          actual: current ? { id: current.id, digest: current.digest } as CatalogReleasePin : release,
        });
      }

      const oldDefinition = await loadDefinitionInRelease(db, release.id, command.oldDefinitionId);
      if (!oldDefinition) {
        return fail({ kind: "preview-unavailable", reason: "subject-not-found" });
      }
      const lifecycle = (oldDefinition.revision_content?.lifecycle ?? "active") as
        | "active"
        | "deprecated"
        | "retired";
      if (lifecycle === "retired") {
        return fail({ kind: "preview-unavailable", reason: "subject-not-active" });
      }
      if (
        oldDefinition.subject_status !== null &&
        oldDefinition.subject_status !== "active"
      ) {
        return fail({ kind: "preview-unavailable", reason: "subject-not-active" });
      }
      if (oldDefinition.property_key === command.newPropertyKey) {
        return fail({ kind: "invalid-command", reason: "identity-unchanged" });
      }

      const targetSubject = await loadSubjectInRelease(db, release.id, command.newSubjectId);
      if (!targetSubject) {
        return fail({ kind: "preview-unavailable", reason: "subject-not-found" });
      }
      if (targetSubject.status !== "active") {
        return fail({ kind: "preview-unavailable", reason: "subject-not-active" });
      }

      const openCutovers = await countOpenCutovers(
        db,
        command.organizationId,
        oldDefinition.property_key,
      );
      if (openCutovers > 0) {
        return fail({
          kind: "pending-work-conflict",
          bindingId: "-",
          reason: "open-property-key-cutover",
        });
      }

      const openDrafts = await countOpenDrafts(
        db,
        command.organizationId,
        oldDefinition.revision_id,
        release.id,
      );
      const openReviews = await countOpenReviewItems(db, command.organizationId, release.id);
      const registration = await loadRegistration(db, command.organizationId, command.newSubjectId);
      const registrationRequired = registration === null || registration.status !== "active";

      const tips = await loadCurrentBindingTips(
        db,
        command.organizationId,
        command.projectIds,
        command.oldDefinitionId,
      );

      const siblingFacts = await loadSiblingSourceFacts(
        db,
        command.organizationId,
        command.projectIds,
      );

      const manifest: FrozenProjectTip[] = [];
      const blockers: string[] = [];
      const blockedByProject = new Map<string, string>();
      let compatibleCount = 0;
      let coupledDefinitionCount = 0;

      // Resolve every sibling's real source location first: coupling is defined
      // over the resolved location, and an opaque recorded ref (for example a
      // `config-set:` write) must compare equal to the location it stands for.
      const siblingSourceRefs = new Map<string, string>();
      for (const sibling of siblingFacts) {
        const resolved = resolveSourceLocation(sourceFactsOf(sibling));
        if (resolved.status === "resolved") {
          siblingSourceRefs.set(sibling.binding_id, resolved.sourceRef);
        }
      }

      // Gather every target source tuple before any proof read.  The helper is
      // intentionally lock-free: one deterministic lock set protects the
      // whole replacement cohort, so a multi-project preview cannot acquire
      // source locks in a different order on the next row.
      const targetProofsByBinding = await db.transaction(async (tx) => {
        const targetRowsByBinding = new Map<string, SourcePropertyProvenanceRow | null>();
        const sourceIdentities = new Map<string, ExactDtsSourceIdentity>();
        for (const tip of tips) {
          const targetRow = await loadSourcePropertyProvenance(tx, {
            bindingId: tip.binding_id,
            propertyKey: command.newPropertyKey,
          });
          targetRowsByBinding.set(tip.binding_id, targetRow);
          const identity = exactSourceIdentityOf(
            targetRow,
            command.organizationId,
            tip.project_id,
            command.newPropertyKey,
          );
          if (identity) {
            sourceIdentities.set(
              [identity.organizationId, identity.projectId, identity.configSetId,
                identity.configRevisionId, identity.fileId, identity.fileVersionId].join("\0"),
              identity,
            );
          }
        }
        await lockExactSourceRevisionsForProof(tx, [...sourceIdentities.values()]);
        const proofs = new Map<string, FrozenSourceProof | null>();
        for (const tip of tips) {
          proofs.set(
            tip.binding_id,
            await exactSourceProofOf(
              tx,
              input.objectStore,
              targetRowsByBinding.get(tip.binding_id) ?? null,
              command.organizationId,
              tip.project_id,
              command.newPropertyKey,
            ),
          );
        }
        return proofs;
      });

      for (const tip of tips) {
        const siblings = siblingFacts.filter((sibling) => sibling.project_id === tip.project_id);
        const recordedSource = resolveSourceLocation(sourceFactsOf(tip));
        const targetProof = targetProofsByBinding.get(tip.binding_id) ?? null;
        const source =
          targetProof &&
          (recordedSource.status !== "blocked" ||
            recordedSource.reason !== "unsupported-source-format")
            ? ({ status: "resolved", sourceRef: targetProof.sourceRef, format: "dts" } as const)
            : recordedSource;
        const sourceCutoverReason =
          oldDefinition.property_key !== command.newPropertyKey &&
          recordedSource.status === "resolved" &&
          !targetProof
            ? "source-key-cutover-required"
            : null;
        const resolvedRef = source.status === "resolved" ? source.sourceRef : (tip.source_ref ?? "");
        const coupled = siblings.filter(
          (sibling) =>
            sibling.binding_id !== tip.binding_id &&
            sibling.logical_node_id === tip.logical_node_id &&
            sibling.property_key !== oldDefinition.property_key &&
            (siblingSourceRefs.get(sibling.binding_id) === resolvedRef ||
              sibling.source_ref === (tip.source_ref ?? "")),
        );
        const frozen = {
          projectId: tip.project_id,
          bindingId: tip.binding_id,
          logicalNodeId: tip.logical_node_id,
          currentValueId: tip.current_value_id,
          configRevisionId: tip.config_revision_id ?? "",
          sourceRef: resolvedRef,
          // This is the actual source location observed under the requested
          // key.  Never derive it by replacing text in source_ref.
          rewrittenSourceRef: resolvedRef,
          valueKind: targetProof?.payload.kind ?? tip.value_kind ?? "string",
          valueDigest: targetProof ? digestProjectValuePayload(targetProof.payload) : (tip.value_digest ?? ""),
          sourceFormat: source.status === "resolved" && !sourceCutoverReason ? "dts" : "unsupported",
          coupledBindingIds: coupled.map((sibling) => sibling.binding_id),
          exactSourceProof: targetProof,
        } satisfies FrozenProjectTip;
        manifest.push(frozen);
        coupledDefinitionCount += frozen.coupledBindingIds.length;
        const evaluation = sourceCutoverReason
          ? { status: "blocked" as const, reason: sourceCutoverReason, compatible: false }
          : evaluateTip({
              tip: frozen,
              source,
              value: targetProof?.payload.value ?? tip.value,
              schema: command.proposedContent.valueSchema,
            });
        if (evaluation.status === "blocked") {
          blockedByProject.set(tip.project_id, evaluation.reason ?? "blocked");
          blockers.push(`${evaluation.reason}:${tip.project_id}`);
        } else {
          compatibleCount += 1;
        }
      }

      if (registrationRequired) blockers.push("registration-required");
      if (openDrafts > 0) blockers.push("pending-work-conflict:draft");
      if (openReviews > 0) blockers.push("pending-work-conflict:review");
      if (manifest.length < command.projectIds.length) {
        blockers.push("unbound-project");
      }

      // Mint the successor Candidate through the existing complete-successor
      // path.  Never inserts into any Catalog relation directly.
      const built = await previewPublicationCandidate({
        db,
        predecessorDigest: release.digest,
        changeSet: [
          {
            op: "create-definition",
            subjectId: targetSubject.id,
            propertyKey: command.newPropertyKey,
            content: command.proposedContent,
          },
        ],
        authorPrincipalId: command.context.principalId,
        authorOrganizationId: command.organizationId,
      });
      if (!built.ok) {
        switch (built.error.kind) {
          case "artifact-missing":
            return fail({ kind: "preview-unavailable", reason: "artifact-missing" });
          case "predecessor-incomplete":
            return fail({ kind: "preview-unavailable", reason: "predecessor-incomplete" });
          case "subject-not-found":
            return fail({ kind: "preview-unavailable", reason: "subject-not-found" });
          case "unsupported-catalog-capability":
            return fail({
              kind: "target-identity-conflict",
              reason: built.error.detail.includes("duplicate-natural-key")
                ? "duplicate-natural-key"
                : "duplicate-canonical-key",
            });
          default:
            return fail({ kind: "preview-unavailable", reason: "unsupported-catalog-capability" });
        }
      }

      const allocation = built.value.candidate.identityAllocation as Record<string, unknown>;
      const allocated = allocationDefinitions(allocation).find(
        (definition) => definition.propertyKey === command.newPropertyKey,
      );
      if (!allocated) {
        return fail({ kind: "preview-unavailable", reason: "unsupported-catalog-capability" });
      }
      const policyRevision = (await loadPolicyRevision(db)) ?? 1;
      const previewFingerprint = fingerprintReplacementPreview({
        oldDefinitionId: command.oldDefinitionId,
        oldRevisionId: oldDefinition.revision_id,
        newDefinitionId: allocated.definitionId,
        newSubjectId: allocated.subjectId,
        newPropertyKey: allocated.propertyKey,
        newRevisionId: allocated.revisionId,
        manifest,
        previewReleaseId: release.id,
        capabilityContractDigest: built.value.candidate.impactReportDigest,
        policyRevision,
      });

      const previewId = mintReplacementPreviewId();
      const expiresAt = new Date(now().getTime() + DEFINITION_REPLACEMENT_PREVIEW_TTL_MS);
      const impact = {
        selectedProjectCount: command.projectIds.length,
        compatibleProjectCount: compatibleCount,
        blockedProjectCount: blockedByProject.size,
        coupledDefinitionCount,
        sourceFormatSupported: manifest.every((tip) => tip.sourceFormat === "dts"),
        oldDefinitionLifecycle: lifecycle,
        oldDefinitionCurrentReferenceCount: await countCurrentReferences(
          db,
          command.organizationId,
          command.oldDefinitionId,
        ),
        targetRegistrationRequired: registrationRequired,
      };

      await insertReplacementPreview(db, {
        id: previewId,
        organization_id: command.organizationId,
        old_definition_id: command.oldDefinitionId,
        old_subject_id: oldDefinition.subject_id,
        old_property_key: oldDefinition.property_key,
        old_revision_id: oldDefinition.revision_id,
        new_definition_id: allocated.definitionId,
        new_subject_id: allocated.subjectId,
        new_property_key: allocated.propertyKey,
        new_revision_id: allocated.revisionId,
        preview_fingerprint: previewFingerprint,
        preview_catalog_release_id: release.id,
        preview_catalog_release_digest: release.digest,
        candidate_id: built.value.candidate.id,
        artifact_digest: built.value.candidate.artifactDigest,
        manifest,
        blockers,
        impact,
        approval_principal_id: command.context.principalId,
        reason: command.reason,
        expires_at: expiresAt,
      });

      const projects: ReplacementProjectView[] = manifest.map((tip) => {
        const blocked = blockedByProject.get(tip.projectId) ?? null;
        return {
          projectId: tip.projectId,
          projectName:
            selected.find((project) => project.id === tip.projectId)?.name ?? tip.projectId,
          status: blocked ? "blocked" : "pending",
          blockerReason: blocked,
          oldBindingId: tip.bindingId,
          oldValueId: tip.currentValueId,
          newBindingId: null,
          newValueId: null,
          valueKind: tip.valueKind,
          compatible: blocked === null,
          attemptCount: 0,
          registrationRequired,
        };
      });

      return ok({
        previewId,
        previewFingerprint,
        organizationId: command.organizationId,
        oldIdentity: identityView(
          command.oldDefinitionId,
          oldDefinition.subject_id,
          oldDefinition.subject_name ?? oldDefinition.subject_id,
          oldDefinition.property_key,
          oldDefinition.revision_id,
        ),
        newIdentity: identityView(
          allocated.definitionId,
          allocated.subjectId,
          targetSubject.canonical_key,
          allocated.propertyKey,
          allocated.revisionId,
        ),
        catalogReleaseId: release.id,
        impact,
        blockers,
        projects,
        expiresAt: expiresAt.toISOString(),
      });
    };

  // -------------------------------------------------------------------------
  // Advance (shared by create and continue)
  // -------------------------------------------------------------------------

  const advance = async (
    organizationId: string,
    principalId: string,
    replacementId: string,
    approvedProjectIds: readonly string[] | null,
    auditRequestId: string,
  ): Promise<Result<DefinitionReplacementView, DefinitionReplacementFailure>> => {
    const successor = await (async () => {
      const replacement = await loadReplacement(db, organizationId, replacementId);
      if (!replacement) return null;
      if (replacement.successor_release_id && replacement.successor_release_digest) {
        return {
          replacement,
          releaseId: replacement.successor_release_id,
          releaseDigest: replacement.successor_release_digest,
        };
      }
      if (!replacement.candidate_id) return { replacement, releaseId: null, releaseDigest: null };
      const candidate = await loadCandidate(db, replacement.candidate_id);
      if (!candidate) return { replacement, releaseId: null, releaseDigest: null };
      const releaseId = allocationReleaseId(candidate.identity_allocation);
      if (!releaseId) return { replacement, releaseId: null, releaseDigest: null };
      return { replacement, releaseId, releaseDigest: null };
    })();
    if (!successor) return fail({ kind: "not-found" });

    if (!successor.releaseId) {
      const view = await replacementView(db, successor.replacement);
      return ok(view);
    }

    const current = await loadCurrentReleasePin(db);
    const materialized = await db.query<{ release_digest: string }>(
      `select release.release_digest
         from parameter_catalog.catalog_materializations materialization
         join parameter_catalog.catalog_releases release on release.id = materialization.release_id
        where materialization.release_id = $1`,
      [successor.releaseId],
    );
    const releaseDigest = materialized.rows[0]?.release_digest ?? successor.releaseDigest;
    if (current?.id !== successor.releaseId || !releaseDigest) {
      const rows = await loadReplacementProjects(db, successor.replacement.id);
      if (rows.some((row) => row.status !== "completed")) {
        await db.transaction(async (tx) => {
          await updateReplacementStatus(tx, successor.replacement.id, {
            status: "pending",
            successorReleaseId: successor.releaseId,
            successorReleaseDigest: successor.releaseDigest,
          });
        });
      }
      return ok(await replacementView(db, (await loadReplacement(db, organizationId, replacementId))!));
    }

    let audited: DefinitionReplacementView;
    try {
      audited = await auditedTransaction(principalId, auditRequestId, async (tx) => {
        const discoveredReplacement = await loadReplacement(tx, organizationId, replacementId, { lock: "none" });
        if (!discoveredReplacement) {
          throw new Error("definition-replacement-vanished");
        }
        const discoveredRows = await loadReplacementProjects(tx, discoveredReplacement.id);
        const approved = approvedProjectIds === null ? null : new Set(approvedProjectIds);
        const collectSourceFacts = async (
          candidateRows: readonly ReplacementProjectRow[],
          candidateReplacement: ReplacementRow,
        ) => {
          const liveTipByProject = new Map<string, CurrentTipRow | null>();
          const liveTargetRowByProject = new Map<string, SourcePropertyProvenanceRow | null>();
          const sourceIdentityByProject = new Map<string, ExactDtsSourceIdentity | null>();
          const sourceIdentities = new Map<string, ExactDtsSourceIdentity>();
          for (const row of candidateRows) {
            if (row.status === "completed" || (approved && !approved.has(row.project_id))) continue;
            const live = await loadCurrentBindingTips(
              tx,
              organizationId,
              [row.project_id],
              candidateReplacement.old_definition_id,
            );
            const liveTip = live.find((tip) => tip.binding_id === row.old_binding_id) ?? live[0] ?? null;
            liveTipByProject.set(row.project_id, liveTip);
            const targetRow = liveTip
              ? await loadSourcePropertyProvenance(tx, {
                  bindingId: liveTip.binding_id,
                  propertyKey: candidateReplacement.new_property_key,
                })
              : null;
            liveTargetRowByProject.set(row.project_id, targetRow);
            const identity = exactSourceIdentityOf(
              targetRow,
              organizationId,
              row.project_id,
              candidateReplacement.new_property_key,
            );
            sourceIdentityByProject.set(row.project_id, identity);
            if (identity) {
              sourceIdentities.set(
                [identity.organizationId, identity.projectId, identity.configSetId,
                  identity.configRevisionId, identity.fileId, identity.fileVersionId].join("\0"),
                identity,
              );
            }
          }
          return { liveTipByProject, liveTargetRowByProject, sourceIdentityByProject, sourceIdentities };
        };

        // Discovery is deliberately unlocked.  Acquire the source prefix once,
        // then canonical/value/pin and workflow rows in the accepted order.
        const discoveredSources = await collectSourceFacts(discoveredRows, discoveredReplacement);
        await lockExactSourceRevisionsForProof(
          tx as unknown as Queryable,
          [...discoveredSources.sourceIdentities.values()],
        );
        await lockReplacementSourceRows(tx, {
          bindingIds: discoveredRows
            .filter((row) => row.status !== "completed" && (!approved || approved.has(row.project_id)))
            .map((row) => row.old_binding_id),
          valueIds: discoveredRows
            .filter((row) => row.status !== "completed" && (!approved || approved.has(row.project_id)))
            .map((row) => row.old_value_id),
        });
        await lockReplacementWorkflowRows(tx, {
          previewId: discoveredReplacement.source_preview_id,
          replacementId,
          projectRowIds: discoveredRows
            .filter((row) => row.status !== "completed" && (!approved || approved.has(row.project_id)))
            .map((row) => row.id),
        });

        // The complete discovered graph is stable only after the fence.  Re-read
        // it before proof or writes; a changed identity is a retryable conflict.
        const replacement = await loadReplacement(tx, organizationId, replacementId, { lock: "none" });
        if (!replacement) throw new Error("definition-replacement-vanished");
        const rows = await loadReplacementProjects(tx, replacement.id);
        const lockedSources = await collectSourceFacts(rows, replacement);
        for (const [projectId, discoveredIdentity] of discoveredSources.sourceIdentityByProject) {
          const lockedIdentity = lockedSources.sourceIdentityByProject.get(projectId) ?? null;
          const key = (identity: ExactDtsSourceIdentity | null): string =>
            identity
              ? [identity.organizationId, identity.projectId, identity.configSetId,
                  identity.configRevisionId, identity.fileId, identity.fileVersionId,
                  identity.propertyOccurrenceId, identity.nodeOccurrenceId, identity.propertyName].join("\0")
              : "";
          if (key(discoveredIdentity) !== key(lockedIdentity)) {
            throw new ApiError("CONFLICT", "The source cohort changed while replacement locks were acquired.", {
              reason: "source-proof-busy",
              projectId,
            });
          }
        }

        const newRevision = await tx.query<{ content: unknown }>(
          `select content from parameter_catalog.definition_revisions
            where definition_id = $1 and id = $2`,
          [replacement.new_definition_id, replacement.new_revision_id],
        );
        const schema = valueSchemaOf(newRevision.rows[0]?.content);
        const frozenById = new Map(replacement.frozen_manifest.map((tip) => [tip.projectId, tip]));
        const openDrafts = await countOpenDrafts(
          tx,
          organizationId,
          replacement.old_revision_id,
          replacement.preview_catalog_release_id,
        );
        const openReviews = await countOpenReviewItems(
          tx,
          organizationId,
          replacement.preview_catalog_release_id,
        );
        const registration = await loadRegistration(tx, organizationId, replacement.new_subject_id);
        const touched: string[] = [];
        const liveTipByProject = lockedSources.liveTipByProject;
        const liveTargetRowByProject = lockedSources.liveTargetRowByProject;

      for (const row of rows) {
        if (row.status === "completed") continue;
        if (approved && !approved.has(row.project_id)) continue;
        touched.push(row.project_id);

        const frozen = frozenById.get(row.project_id);
        const liveTip = liveTipByProject.get(row.project_id) ?? null;

        const block = async (reason: string, evidence: Record<string, unknown>) => {
          await markReplacementProjectBlocked(tx, row.id, { reason, evidence });
        };

        if (registration === null || registration.status !== "active") {
          await block("registration-required", { organizationId, subjectId: replacement.new_subject_id });
          continue;
        }
        const liveSource = liveTip ? resolveSourceLocation(sourceFactsOf(liveTip)) : null;
        const liveTargetProof = liveTip
          ? await exactSourceProofOf(
              tx,
              input.objectStore,
              liveTargetRowByProject.get(row.project_id) ?? null,
              organizationId,
              row.project_id,
              replacement.new_property_key,
            )
          : null;
        const staleEvidence = {
          frozenCurrentValueId: frozen?.currentValueId ?? null,
          liveCurrentValueId: liveTip?.current_value_id ?? null,
          frozenSourceRef: frozen?.sourceRef ?? null,
          liveSourceRef: liveSource?.status === "resolved" ? liveSource.sourceRef : null,
          liveSourceStatus: liveSource?.status ?? null,
          liveTargetSourceRef: liveTargetProof?.sourceRef ?? null,
          liveTargetOccurrenceId: liveTargetProof?.propertyOccurrenceId ?? null,
        };
        if (
          !frozen ||
          !liveTip ||
          liveTip.current_value_id !== frozen.currentValueId ||
          (liveTip.config_revision_id ?? "") !== frozen.configRevisionId
        ) {
          await block("stale-preview", staleEvidence);
          continue;
        }
        if (liveSource?.status === "blocked" && liveSource.reason === "unsupported-source-format") {
          await block("unsupported-source-format", staleEvidence);
          continue;
        }
        if (!liveTargetProof) {
          const preservedSourceBlocker =
            liveSource?.status === "blocked" && liveSource.reason !== "missing-source-provenance"
              ? liveSource.reason
              : null;
          await block(
            preservedSourceBlocker ??
              (replacement.old_property_key === replacement.new_property_key
                ? "missing-source-provenance"
                : "source-key-cutover-required"),
            staleEvidence,
          );
          continue;
        }
        // A project the preview blocked on its source keeps that reason while the
        // source is still what it was.  A blocked-to-resolved (or
        // resolved-to-blocked) flip is source drift, so the frozen preview no
        // longer holds and the project is stale.
        if (
          liveSource?.status === "blocked" &&
          liveSource.reason !== "missing-source-provenance"
        ) {
          await block("stale-preview", staleEvidence);
          continue;
        }
        if (
          frozen.sourceFormat !== "dts" ||
          liveTargetProof.sourceRef !== frozen.sourceRef ||
          !frozen.exactSourceProof ||
          liveTargetProof.sourceDigest !== frozen.exactSourceProof.sourceDigest ||
          liveTargetProof.revisionDigest !== frozen.exactSourceProof.revisionDigest ||
          liveTargetProof.locatorDigest !== frozen.exactSourceProof.locatorDigest
        ) {
          await block("stale-preview", staleEvidence);
          continue;
        }
        if (openDrafts > 0) {
          await block("pending-work-conflict", { reason: "draft" });
          continue;
        }
        if (openReviews > 0) {
          await block("pending-work-conflict", { reason: "review" });
          continue;
        }
        if (frozen.coupledBindingIds.length > 0) {
          await block("coupled-source-impact", { bindingIds: frozen.coupledBindingIds });
          continue;
        }
        const conflict = await countBindingForDefinition(
          tx,
          organizationId,
          row.project_id,
          replacement.new_definition_id,
        );
        if (conflict > 0) {
          await block("target-identity-conflict", { definitionId: replacement.new_definition_id });
          continue;
        }
        if (schema) {
          const compatibility = evaluateValueCompatibility(liveTip.value, schema);
          if (!compatibility.compatible) {
            await block("incompatible-value", { detail: compatibility.reason });
            continue;
          }
        }

        const newValueId = mintReplacementValueId();
        const newBindingId = `pbind_${newValueId.slice("pval_".length)}`;
        const rewrittenSourceRef = liveTargetProof.sourceRef;
        const successAuditRef = `definition-replacement:${replacement.id}:${row.project_id}`;

        await insertReplacementBinding(tx, {
          id: newBindingId,
          organizationId,
          catalogReleaseId: successor.releaseId!,
          projectId: row.project_id,
          logicalNodeId: liveTip.logical_node_id,
          sourceOccurrenceId: liveTargetProof.sourceOccurrenceId,
          registrationId: registration.registration_id,
          subjectId: replacement.new_subject_id,
          definitionId: replacement.new_definition_id,
          effectiveRevisionId: replacement.new_revision_id,
          currentValueId: newValueId,
        });
        await insertReplacementValue(tx, {
          id: newValueId,
          bindingId: newBindingId,
          definitionId: replacement.new_definition_id,
          definitionRevisionId: replacement.new_revision_id,
          sourceRef: rewrittenSourceRef,
          configRevisionId: frozen.configRevisionId,
          valueDigest: digestProjectValuePayload(liveTargetProof.payload),
          valueKind: liveTargetProof.payload.kind,
          value: liveTargetProof.payload.value,
          replacedFromValueId: row.old_value_id,
          replacedFromDefinitionId: replacement.old_definition_id,
        });
        await insertReplacementSourcePin(tx, {
          id: `src_pin_${newValueId.slice("pval_".length)}`,
          projectValueId: newValueId,
          bindingId: newBindingId,
          definitionId: replacement.new_definition_id,
          organizationId,
          projectId: row.project_id,
          sourceOccurrenceId: liveTargetProof.sourceOccurrenceId,
          configRevisionId: liveTargetProof.configRevisionId,
          fileId: liveTargetProof.fileId,
          fileVersionId: liveTargetProof.fileVersionId,
          propertyOccurrenceId: liveTargetProof.propertyOccurrenceId,
          locator: liveTargetProof.locator,
          locatorDigest: sha256(liveTargetProof.locator),
        });
        await insertReplacementHistoryEvent(tx, {
          id: `bhist_${newValueId.slice("pval_".length)}`,
          bindingId: newBindingId,
          newEffectiveRevisionId: replacement.new_revision_id,
          newCurrentValueId: newValueId,
          reason: "definition-replacement",
          successAuditRef,
          catalogReleaseId: successor.releaseId!,
        });
        await markReplacementProjectCompleted(tx, row.id, { newBindingId, newValueId });
      }

      const settled = await loadReplacementProjects(tx, replacementId);
      const status: ReplacementStatus = settled.every((row) => row.status === "completed")
        ? "completed"
        : settled.some((row) => row.status === "pending")
          ? "pending"
          : "blocked";
      await updateReplacementStatus(tx, replacementId, {
        status,
        successorReleaseId: successor.releaseId,
        successorReleaseDigest: releaseDigest,
        approverPrincipalId: principalId,
        successAuditRef: `definition-replacement:${replacementId}`,
      });
      const refreshed = await loadReplacement(tx, organizationId, replacementId, { lock: "none" });
      const view = await replacementView(tx, refreshed!);
      return {
        result: view,
        audit: {
          app: "parameter-catalog-migration",
          kind: "definition-replacement",
          action: "definition-replacement-advanced",
          severity: "Low" as const,
          projectId: null,
          targetType: "definition-replacement",
          targetId: replacementId,
          metadata: { status, touchedProjects: touched },
        },
      };
      });
    } catch (error) {
      if (
        (error as { readonly code?: string }).code === "55P03" ||
        (error instanceof ApiError &&
          error.code === "CONFLICT" &&
          error.details.reason === "source-proof-busy")
      ) {
        return fail({ kind: "synchronization-busy" });
      }
      throw error;
    }
    return ok(audited);
  };

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  const createDefinitionReplacement: CatalogDefinitionMigrationPorts["createDefinitionReplacement"] =
    async (command) => {
      const denial = authorizeOrganizationWrite(command.context, command.organizationId);
      if (denial) return fail(denial);
      if (!isControlFree(command.idempotencyKey)) {
        return fail({ kind: "invalid-command", reason: "idempotencyKey" });
      }
      const fingerprint = createCommandFingerprint(command);

      // Phase A: reserve the organization-scoped idempotency identity and
      // validate the frozen preview.  Nothing is consumed yet, so a retry with
      // the same key after a transient publication failure is safe.
      const preflight = await db.transaction(async (tx) => {
        const reserved = await reserveGovernanceIdempotency(tx, {
          organizationId: command.organizationId,
          family: DEFINITION_REPLACEMENT_EXECUTE_FAMILY,
          idempotencyKey: command.idempotencyKey,
          fingerprint,
        });
        if (reserved.request_fingerprint !== fingerprint) {
          return {
            kind: "conflict" as const,
            storedFingerprint: reserved.request_fingerprint,
            attemptedFingerprint: fingerprint,
          };
        }
        if (reserved.state === "committed" && reserved.result_ref) {
          return { kind: "replay" as const, replacementId: reserved.result_ref };
        }
        const preview = await loadReplacementPreview(tx, command.organizationId, command.previewId);
        if (!preview) return { kind: "missing-preview" as const };
        if (preview.consumed_by_replacement_id) {
          return { kind: "replay" as const, replacementId: preview.consumed_by_replacement_id };
        }
        if (preview.preview_fingerprint !== command.previewFingerprint) {
          return {
            kind: "stale" as const,
            expectedFingerprint: preview.preview_fingerprint,
            attemptedFingerprint: command.previewFingerprint,
          };
        }
        if (new Date(preview.expires_at).getTime() <= now().getTime()) {
          return { kind: "expired" as const };
        }
        const current = await loadCurrentReleasePin(tx);
        const successorCandidate = preview.candidate_id
          ? await loadCandidate(tx, preview.candidate_id)
          : null;
        const successorReleaseId = successorCandidate
          ? allocationReleaseId(successorCandidate.identity_allocation)
          : null;
        // The preview is still usable while its own base release is current, and
        // after the publication manager has activated the successor this preview
        // minted: a same-key retry must be able to persist the approved
        // replacement once the manager finished the install the API is not
        // allowed to perform (CP-07 isolation, ADR-0043 §5).
        if (
          !current ||
          (current.id !== preview.preview_catalog_release_id &&
            current.id !== successorReleaseId)
        ) {
          return { kind: "drift" as const, actualId: current?.id ?? null };
        }
        return { kind: "ready" as const, preview };
      });

      if (preflight.kind === "conflict") {
        return fail({
          kind: "revision-conflict",
          idempotencyKey: command.idempotencyKey,
          storedFingerprint: preflight.storedFingerprint,
          attemptedFingerprint: preflight.attemptedFingerprint,
        });
      }
      if (preflight.kind === "missing-preview") return fail({ kind: "not-found" });
      if (preflight.kind === "stale") {
        return fail({
          kind: "stale-preview",
          expectedFingerprint: preflight.expectedFingerprint,
          actualFingerprint: preflight.attemptedFingerprint,
        });
      }
      if (preflight.kind === "expired") {
        return fail({ kind: "preview-unavailable", reason: "preview-expired" });
      }
      if (preflight.kind === "drift") {
        return fail({
          kind: "release-drift",
          expected: command.expectedRelease,
          actual: {
            ...command.expectedRelease,
            id: CatalogReleaseId(preflight.actualId ?? command.expectedRelease.id),
          },
        });
      }
      if (preflight.kind === "replay") {
        const stored = await loadReplacement(db, command.organizationId, preflight.replacementId);
        if (!stored) return fail({ kind: "not-found" });
        return ok(await replacementView(db, stored));
      }

      const preview = preflight.preview;
      if (!input.publication || !command.trustedActor) {
        return fail({ kind: "publication-unavailable", jobId: null });
      }

      // Phase B: mint the publication job through the existing
      // Candidate/Authorization enqueue path and let the publication manager
      // (or the injected test driver) activate it.
      const enqueued = await input.publication.enqueueReplacementPublication({
        organizationId: command.organizationId,
        candidateId: preview.candidate_id,
        idempotencyKey: command.idempotencyKey,
        trustedActor: command.trustedActor,
      });
      if (!enqueued.ok) return fail(enqueued.error);
      const activation = input.publication.activateReplacementPublication
        ? await input.publication.activateReplacementPublication({
            jobId: enqueued.value.publicationJobId,
          })
        : { kind: "pending" as const, jobId: enqueued.value.publicationJobId };
      if (activation.kind === "blocked") {
        return fail({ kind: "preview-unavailable", reason: "needs-rebase" });
      }
      if (activation.kind !== "active") {
        // The replacement row has hard, deferred FKs to the minted definition
        // and revision, so it can only be written once the successor release is
        // published and materialized.  The frozen preview (and therefore the
        // operator's exact manifest) is retained for a same-key retry.
        return fail({ kind: "publication-unavailable", jobId: enqueued.value.publicationJobId });
      }

      // Phase C: record the approved replacement and its per-project manifest.
      const finalized = await db.transaction(async (tx) => {
        const reloaded = await loadReplacementPreview(tx, command.organizationId, command.previewId);
        if (!reloaded) return { kind: "missing-preview" as const };
        const registration = await loadRegistration(
          tx,
          command.organizationId,
          reloaded.new_subject_id,
        );
        const registrationRequired = registration === null || registration.status !== "active";
        const blockerByProject = new Map<
          string,
          { reason: string; evidence: Record<string, unknown> }
        >();
        if (registrationRequired) {
          for (const tip of reloaded.manifest) {
            blockerByProject.set(tip.projectId, {
              reason: "registration-required",
              evidence: {
                organizationId: command.organizationId,
                subjectId: reloaded.new_subject_id,
              },
            });
          }
        }
        const replacementId = mintReplacementId();
        await insertReplacement(tx, {
          id: replacementId,
          organizationId: command.organizationId,
          status: registrationRequired ? "blocked" : "pending",
          oldDefinitionId: reloaded.old_definition_id,
          oldSubjectId: reloaded.old_subject_id,
          oldPropertyKey: reloaded.old_property_key,
          oldRevisionId: reloaded.old_revision_id,
          newDefinitionId: reloaded.new_definition_id,
          newSubjectId: reloaded.new_subject_id,
          newPropertyKey: reloaded.new_property_key,
          newRevisionId: reloaded.new_revision_id,
          previewFingerprint: reloaded.preview_fingerprint,
          previewReleaseId: reloaded.preview_catalog_release_id,
          previewReleaseDigest: reloaded.preview_catalog_release_digest,
          sourcePreviewId: reloaded.id,
          manifest: reloaded.manifest,
          approvalPrincipalId: command.context.principalId,
          reason: reloaded.reason,
          candidateId: enqueued.value.candidateId,
          publicationJobId: enqueued.value.publicationJobId,
          authorizationId: enqueued.value.authorizationId,
          successorReleaseId: activation.releaseId,
          successorReleaseDigest: activation.releaseDigest,
        });
        await insertReplacementProjects(tx, {
          replacementId,
          organizationId: command.organizationId,
          oldDefinitionId: reloaded.old_definition_id,
          newDefinitionId: reloaded.new_definition_id,
          manifest: reloaded.manifest,
          blockerByProject,
        });
        await consumeReplacementPreview(tx, reloaded.id, replacementId);
        await commitGovernanceIdempotency(tx, {
          organizationId: command.organizationId,
          family: DEFINITION_REPLACEMENT_EXECUTE_FAMILY,
          idempotencyKey: command.idempotencyKey,
          resultKind: "definition-replacement",
          resultRef: replacementId,
        });
        return { kind: "created" as const, replacementId };
      });
      if (finalized.kind === "missing-preview") return fail({ kind: "not-found" });

      // Phase D: after an exact impact confirmation, eligible projects advance
      // automatically; blocked projects are retained for continuation.
      return advance(
        command.organizationId,
        command.context.principalId,
        finalized.replacementId,
        null,
        `definition-replacement:${finalized.replacementId}`,
      );
    };

  // -------------------------------------------------------------------------
  // Continue / get / list
  // -------------------------------------------------------------------------

  const continueDefinitionReplacement: CatalogDefinitionMigrationPorts["continueDefinitionReplacement"] =
    async (command) => {
      const denial = authorizeOrganizationWrite(command.context, command.organizationId);
      if (denial) return fail(denial);
      if (!isControlFree(command.idempotencyKey)) {
        return fail({ kind: "invalid-command", reason: "idempotencyKey" });
      }
      const fingerprint = continueCommandFingerprint(command);

      const reserved = await db.transaction(async (tx) => {
        const row = await reserveGovernanceIdempotency(tx, {
          organizationId: command.organizationId,
          family: DEFINITION_REPLACEMENT_CONTINUE_FAMILY,
          idempotencyKey: command.idempotencyKey,
          fingerprint,
        });
        return row;
      });
      if (reserved.request_fingerprint !== fingerprint) {
        return fail({
          kind: "revision-conflict",
          idempotencyKey: command.idempotencyKey,
          storedFingerprint: reserved.request_fingerprint,
          attemptedFingerprint: fingerprint,
        });
      }
      if (reserved.state === "committed" && reserved.result_ref) {
        const stored = await loadReplacement(db, command.organizationId, reserved.result_ref);
        if (stored) return ok(await replacementView(db, stored));
        return fail({ kind: "not-found" });
      }

      const replacement = await loadReplacement(db, command.organizationId, command.replacementId);
      if (!replacement) return fail({ kind: "not-found" });
      const rows = await loadReplacementProjects(db, command.replacementId);
      if (command.projectIds) {
        const manifestIds = new Set(rows.map((row) => row.project_id));
        for (const projectId of command.projectIds) {
          if (!manifestIds.has(projectId)) {
            return fail({ kind: "invalid-command", reason: "project-outside-approved-manifest" });
          }
        }
      }

      const advanced = await advance(
        command.organizationId,
        command.context.principalId,
        command.replacementId,
        command.projectIds,
        `definition-replacement-continue:${command.replacementId}`,
      );
      if (!advanced.ok) return advanced;
      await db.transaction(async (tx) => {
        await commitGovernanceIdempotency(tx, {
          organizationId: command.organizationId,
          family: DEFINITION_REPLACEMENT_CONTINUE_FAMILY,
          idempotencyKey: command.idempotencyKey,
          resultKind: "definition-replacement",
          resultRef: command.replacementId,
        });
      });
      return ok(advanced.value);
    };

  const getDefinitionReplacement: CatalogDefinitionMigrationPorts["getDefinitionReplacement"] =
    async (query) => {
      if (!isControlFree(query.replacementId)) return fail({ kind: "not-found" });
      const replacement = await loadReplacement(db, query.organizationId, query.replacementId);
      if (!replacement) return fail({ kind: "not-found" });
      return ok(await replacementView(db, replacement));
    };

  const listDefinitionReplacements: CatalogDefinitionMigrationPorts["listDefinitionReplacements"] =
    async (query) => {
      const rows = await listReplacements(db, query.organizationId);
      const items: DefinitionReplacementView[] = [];
      for (const row of rows) items.push(await replacementView(db, row));
      return ok({ items });
    };

  const loadDefinitionRetirementEvidence: CatalogDefinitionMigrationPorts["loadDefinitionRetirementEvidence"] =
    async (query) => {
      const projectIds = await listCurrentReferenceProjects(
        db,
        query.organizationId,
        query.definitionId,
      );
      return ok({
        remainingCurrentReferenceCount: projectIds.length,
        projectIds,
        authoritative: true,
      });
    };

  return {
    previewDefinitionReplacement,
    createDefinitionReplacement,
    continueDefinitionReplacement,
    getDefinitionReplacement,
    listDefinitionReplacements,
    loadDefinitionRetirementEvidence,
  };
}

export const unavailableDefinitionMigrationPorts: CatalogDefinitionMigrationPorts = {
  previewDefinitionReplacement: async () =>
    fail({ kind: "preview-unavailable", reason: "artifact-missing" }),
  createDefinitionReplacement: async () =>
    fail({ kind: "preview-unavailable", reason: "artifact-missing" }),
  continueDefinitionReplacement: async () =>
    fail({ kind: "preview-unavailable", reason: "artifact-missing" }),
  getDefinitionReplacement: async () => fail({ kind: "not-found" }),
  listDefinitionReplacements: async () => ok({ items: [] }),
  loadDefinitionRetirementEvidence: async () =>
    ok({ remainingCurrentReferenceCount: 0, projectIds: [], authoritative: true as const }),
};

export { classifyImpact };
