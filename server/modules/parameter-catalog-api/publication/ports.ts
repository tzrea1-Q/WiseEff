import { catalogApiFailureReasonSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  PublicationJobId,
  ParameterDefinitionId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import { classifyImpact } from "../../catalog-publication/authorization/classify";
import { createUsageQueries } from "../../parameter-bindings/usage";
import { createUsageProjectionFromQueries } from "../read/ports";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../catalog-publication/builder/capabilities";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import { enqueuePublicationJob } from "../../catalog-publication/enqueue";
import { impactFactsFromAllocation } from "../../catalog-publication/jobs/execute";
import { parsePublicationChangeSet, previewPublicationCandidate } from "../../catalog-publication/preview";
import { parseBundleBytes, targetReleaseOf } from "../../catalog-publication/builder/bundleCodec";
import { planMarkdownImport } from "../../catalog-publication/import/markdownImport";

import { modulePath, readPlacementHintEvidence } from "../../parameter-governance/registration/readRepository";
import {
  getCandidate,
  getArtifactByDigest,
  getJob,
  getReceiptByJobId,
  listJobs,
} from "../../catalog-publication/persistence/store";
import { collectPublicationPolicyControlFacts } from "../../catalog-publication/authorization/instanceSnapshot";
import type { PublicationCandidateRecord, PublicationJobRecord } from "../../catalog-publication/persistence/types";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import type { Database } from "../../../shared/database/client";

type CatalogPointerPool = Parameters<typeof readCurrentCatalogPointer>[0];
import type {
  CatalogPublicationFailure,
  CatalogPublicationPorts,
  PlacementHintWithWarnings,
  PublicationCandidateView,
  PublicationJobView,
  PublicationSurfaceView,
} from "./types";

function publicImportEntries(entries: ReturnType<typeof planMarkdownImport>["entries"]) {
  return entries.map((entry) => {
    const result = { ...entry };
    delete result.definitionId;
    delete result.operationIndex;
    delete result.tightensExistingContract;
    return result;
  });
}

const authorOrganizationIdOf = (candidate: PublicationCandidateRecord): string | null => {
  const value = candidate.identityAllocation.authorOrganizationId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const capabilityOf = (candidate: PublicationCandidateRecord): PublicationCandidateView["capabilityContract"] => {
  const contract = candidate.capabilityContract;
  const revision =
    typeof contract.revision === "string" ? contract.revision : CATALOG_CAPABILITY_CONTRACT_REVISION;
  const allowListId = typeof contract.allowListId === "string" ? contract.allowListId : "page-historical-definition-content";
  return { revision, allowListId };
};

const isSummaryCount = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const nonnegativeCount = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

const allocatedSubjectIds = (allocation: PublicationCandidateRecord["identityAllocation"]): string[] => {
  if (!Array.isArray(allocation.subjects)) {
    return [];
  }
  return allocation.subjects.flatMap((entry) =>
    isSummaryCount(entry) && typeof entry.subjectId === "string" ? [entry.subjectId] : [],
  );
};

const impactSummaryOf = (
  candidate: PublicationCandidateRecord,
): PublicationCandidateView["impactSummary"] => {
  const summary = candidate.identityAllocation.impactSummary;
  const record = isSummaryCount(summary) ? summary : null;
  const allocatedIds = allocatedSubjectIds(candidate.identityAllocation);
  const addedDefinitionCount = nonnegativeCount(record?.addedDefinitionCount) ?? 0;
  const changedDefinitionCount = nonnegativeCount(record?.changedDefinitionCount) ?? 0;
  const addedSubjectCount = nonnegativeCount(record?.addedSubjectCount) ?? allocatedIds.length;
  const addedSubjectIds = Array.isArray(record?.addedSubjectIds)
    ? record.addedSubjectIds.filter((id): id is string => typeof id === "string")
    : allocatedIds;
  return {
    addedDefinitionCount,
    changedDefinitionCount,
    addedSubjectCount,
    ...(addedSubjectIds.length > 0 ? { addedSubjectIds } : {}),
  };
};

const candidateView = (
  candidate: PublicationCandidateRecord,
): PublicationCandidateView | null => {
  const authorOrganizationId = authorOrganizationIdOf(candidate);
  const facts = impactFactsFromAllocation(candidate.identityAllocation);
  if (authorOrganizationId === null || facts === null) {
    return null;
  }
  const classified = classifyImpact(facts);
  if (!classified.ok) {
    return null;
  }
  return {
    id: candidate.id,
    expectedBaseReleaseId: candidate.expectedBaseReleaseId,
    expectedBaseReleaseDigest: candidate.expectedBaseReleaseDigest,
    riskClass: classified.value,
    impactSummary: impactSummaryOf(candidate),
    capabilityContract: capabilityOf(candidate),
    authorOrganizationId,
  };
};

const inScope = (
  authorOrganizationId: string,
  organizationId: string,
): boolean => authorOrganizationId === organizationId;

const jobFailure = (
  job: PublicationJobRecord,
): PublicationJobView["failure"] => {
  if (!job.lastErrorClass || !job.lastErrorReason) {
    return null;
  }
  const parsed = catalogApiFailureReasonSchema.safeParse(job.lastErrorReason);
  if (!parsed.success) {
    return null;
  }
  return { class: job.lastErrorClass, reason: parsed.data };
};

const jobView = async (input: {
  readonly db: Database;
  readonly pool: CatalogPointerPool | undefined;
  readonly job: PublicationJobRecord;
  readonly artifactId: string;
  readonly authorOrganizationId: string;
}): Promise<PublicationJobView> => {
  const receipt = await withPublicationCoordinator(input.db, (tx) => getReceiptByJobId(tx, input.job.id));
  const rewrites = await input.db.query<{ erased_at: Date | string; old_digest: string; new_digest: string }>(
    `select erasure.erased_at, artifact->>'oldDigest' as old_digest, artifact->>'newDigest' as new_digest
       from parameter_catalog.definition_erasures erasure
       cross join lateral jsonb_array_elements(erasure.catalog_rewrite->'artifacts') artifact
      where artifact->>'id'=$1 and artifact->>'oldDigest' is distinct from artifact->>'newDigest'
      order by erasure.erased_at, erasure.definition_id`,
    [input.artifactId],
  );
  const pointer = input.pool ? await readCurrentCatalogPointer(input.pool) : { kind: "absent" as const };
  const matched =
    receipt.ok &&
    receipt.value.publicationJobId === input.job.id &&
    receipt.value.candidateId === input.job.candidateId &&
    receipt.value.authorizationId === input.job.authorizationId &&
    receipt.value.kind === "online-publication";
  const currentness =
    matched && pointer.kind === "installed"
      ? pointer.current.id === receipt.value.releaseId && pointer.current.digest === receipt.value.releaseDigest
        ? ("active" as const)
        : ("active-superseded" as const)
      : matched
        ? ("active-superseded" as const)
        : null;
  return {
    id: input.job.id,
    candidateId: input.job.candidateId,
    status: input.job.status,
    attemptCount: input.job.attemptCount,
    effective: matched,
    isCurrent: currentness === "active",
    currentness,
    failure: matched ? null : jobFailure(input.job),
    authorOrganizationId: input.authorOrganizationId,
    ...(rewrites.rows.length > 0 ? { maintenanceRewrites: rewrites.rows.map(rewrite => ({
      kind: "definition-erasure" as const,
      erasedAt: new Date(rewrite.erased_at).toISOString(),
      previousArtifactDigest: rewrite.old_digest,
      currentArtifactDigest: rewrite.new_digest,
      originalApprovalRetained: true as const,
    })) } : {}),
  };
};

const mapPreviewError = (kind: string, detail?: string): CatalogPublicationFailure => {
  if (kind === "artifact-missing") {
    return { kind: "reason", reason: "artifact-missing" };
  }
  if (kind === "predecessor-incomplete") {
    return { kind: "reason", reason: "predecessor-incomplete" };
  }
  if (kind === "unsupported-catalog-capability") {
    return { kind: "reason", reason: "unsupported-catalog-capability" };
  }
  if (kind === "unsupported-change-op") {
    return { kind: "reason", reason: "unsupported-catalog-capability" };
  }
  if (kind === "subject-not-found") {
    return { kind: "reason", reason: "candidate-stale" };
  }
  if (kind === "subject-not-active") {
    return { kind: "reason", reason: "subject-retired" };
  }
  if (kind === "definition-already-exists") {
    return { kind: "reason", reason: "definition-already-exists" };
  }
  if (kind === "invalid-input") {
    return { kind: "validation", field: detail ?? "changeSet" };
  }
  return { kind: "reason", reason: "candidate-stale" };
};

export function bindCatalogPublicationCommands(input: {
  readonly db: Database;
  readonly pool?: CatalogPointerPool;
}): Pick<
  CatalogPublicationPorts,
  | "previewCandidate"
  | "getCandidate"
  | "publishCandidate"
  | "getPublication"
  | "getPublicationSurface"
  | "listPublications"
> {
  const { db, pool } = input;
  return {
    async previewCandidate(command) {
      if (command.markdownImport && !command.permissions.includes("catalog:author")) {
        return { ok: false, error: { kind: "forbidden", reason: "publication-capability-missing" } };
      }
      if (
        !command.permissions.includes("catalog:author") &&
        !command.permissions.includes("catalog:publish")
      ) {
        return {
          ok: false,
          error: { kind: "forbidden", reason: "publication-capability-missing" },
        };
      }
      const pointer = pool ? await readCurrentCatalogPointer(pool) : { kind: "absent" as const };
      if (pointer.kind !== "installed" || pointer.current.id !== command.catalogReleaseId) {
        return { ok: false, error: { kind: "reason", reason: "candidate-stale" } };
      }
      let plan: ReturnType<typeof planMarkdownImport> | undefined;
      let placementHints: PlacementHintWithWarnings[] = [];
      if (command.markdownImport) {
        const artifact = await getArtifactByDigest(db, pointer.current.digest);
        if (!artifact.ok) return { ok: false, error: { kind: "reason", reason: "artifact-missing" } };
        const bundle = parseBundleBytes(artifact.value.artifactBytes);
        const snapshot = bundle.ok ? targetReleaseOf(bundle.bundle) : null;
        if (!snapshot) return { ok: false, error: { kind: "reason", reason: "predecessor-incomplete" } };
        plan = planMarkdownImport(command.markdownImport.document, command.markdownImport.fileName, snapshot);
        const semanticIds = plan.entries.flatMap((entry) => {
          if (entry.outcome !== "revise" || entry.revisionClass !== "semantic" || !entry.definitionId) return [];
          return [ParameterDefinitionId(entry.definitionId)];
        });
        const usage = pool && semanticIds.length ? await createUsageProjectionFromQueries(createUsageQueries(pool)).summarizeMany({
          organizationId: command.organizationId, principalId: command.principalId,
          projectScope: command.projectScope ?? { kind: "only", ids: [] }, definitionIds: semanticIds,
        }) : new Map();
        plan.entries = plan.entries.map((entry) => {
          if (entry.outcome !== "revise" || entry.revisionClass !== "semantic") return entry;
          const summary = entry.definitionId ? usage.get(ParameterDefinitionId(entry.definitionId)) : undefined;
          return { ...entry, ...(summary ? { usageSummary: summary } : {}) };
        });
        if (plan.placementHints.length && pool) {
          const { modules, registrations } = await readPlacementHintEvidence(pool, command.organizationId);
          placementHints = plan.placementHints.map((hint) => {
            const warnings: string[] = [];
            const registered = registrations.find((item) => item.subjectId === hint.subjectId);
            const subject = snapshot.documents.find((item) => item.kind === "subject" && item.content.id === hint.subjectId);
            const canonicalName = subject?.kind === "subject" ? subject.content.canonicalKey : `${hint.kind}:${hint.selector}`;
            if (registered) warnings.push(`已登记于 ${modulePath(registered.moduleId, modules)}，未改动`);
            else if (hint.categoryPath) {
              const parents = modules.filter((item) => (item.kind === "business" || (item.kind === "unclassified" && hint.categoryPath === "未分类")) && modulePath(item.id, modules) === hint.categoryPath);
              if (!parents.length) warnings.push("业务分类不存在。");
              else if (parents.length > 1) warnings.push("业务分类路径不唯一。");
              else if (modules.some((item) => item.parentId === parents[0]!.id && item.name === (hint.moduleName ?? canonicalName))) warnings.push("同一分类下已有同名模块。");
            }
            return { ...hint, warnings };
          });
        }
        if (!plan.changeSet) return { ok: true, value: { candidate: null, noChange: plan.noChange, entries: publicImportEntries(plan.entries), source: plan.source, placementHints } };
      }
      const parsed = plan?.changeSet ?? parsePublicationChangeSet(command.changeSet);
      if ("error" in parsed) return { ok: false, error: mapPreviewError(parsed.error.kind, parsed.error.kind) };
      const previewed = await previewPublicationCandidate({
        db,
        predecessorDigest: pointer.current.digest,
        changeSet: parsed,
        authorPrincipalId: command.principalId,
        authorOrganizationId: command.organizationId,
        proposalId: command.proposalId,
        proposalRevisionId: command.proposalRevisionId,
        markdownSource: plan?.source,
      });
      if (!previewed.ok) {
        return { ok: false, error: mapPreviewError(previewed.error.kind) };
      }
      if (plan?.changeSet) {
        const facts = previewed.value.impactFacts;
        plan.entries = plan.entries.map((entry) => {
          if (entry.outcome !== "create" && entry.outcome !== "revise") return entry;
          const operation = facts.operations[entry.operationIndex ?? -1];
          if (!operation) return entry;
          const semantic = operation.op === "revise-definition" && operation.class === "semantic";
          const newSubject = operation.op === "create-subject-with-definitions";
          const classified = classifyImpact({ ...facts, operations: [operation], introducesNewSubject: newSubject,
            changesSelector: newSubject && facts.changesSelector, changesAlias: false, changesFallback: false,
            tightensExistingContract: semantic && Boolean(entry.tightensExistingContract), changesUnitOrSemantic: semantic,
            retiresIdentity: false });
          return { ...entry, ...(classified.ok ? { riskClass: classified.value } : {}) };
        });
      }
      const candidate = {
        id: previewed.value.candidate.id,
        expectedBaseReleaseId: previewed.value.candidate.expectedBaseReleaseId,
        expectedBaseReleaseDigest: previewed.value.candidate.expectedBaseReleaseDigest,
        riskClass: previewed.value.riskClass,
        impactSummary: previewed.value.impactSummary,
        capabilityContract: capabilityOf(previewed.value.candidate),
        authorOrganizationId: command.organizationId,
      };
      return { ok: true, value: plan ? { candidate, noChange: plan.noChange, entries: publicImportEntries(plan.entries), source: plan.source, placementHints } : candidate };
    },
    async getCandidate(query) {
      let candidateId: ReturnType<typeof CatalogCandidateId>;
      try {
        candidateId = CatalogCandidateId(query.candidateId);
      } catch {
        return { ok: false, error: { kind: "not-found" } };
      }
      const loaded = await withPublicationCoordinator(db, (tx) => getCandidate(tx, candidateId));
      if (!loaded.ok) {
        return { ok: false, error: { kind: "not-found" } };
      }
      const view = candidateView(loaded.value);
      if (!view || !inScope(view.authorOrganizationId, query.organizationId)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return { ok: true, value: view };
    },
    async publishCandidate(command) {
      const loaded = await withPublicationCoordinator(db, (tx) => {
        try {
          return getCandidate(tx, CatalogCandidateId(command.candidateId));
        } catch {
          return Promise.resolve({ ok: false as const, error: { kind: "not-found" as const, entity: "candidate" as const } });
        }
      });
      if (!loaded.ok) {
        return { ok: false, error: { kind: "not-found" } };
      }
      const authorOrganizationId = authorOrganizationIdOf(loaded.value);
      if (authorOrganizationId === null || !inScope(authorOrganizationId, command.organizationId)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      if (impactFactsFromAllocation(loaded.value.identityAllocation) === null) {
        return { ok: false, error: { kind: "reason", reason: "candidate-tampered" } };
      }
      const view = candidateView(loaded.value);
      if (!view) {
        return { ok: false, error: { kind: "reason", reason: "candidate-tampered" } };
      }
      const enqueued = await enqueuePublicationJob({
        db,
        candidateId: command.candidateId,
        idempotencyKey: command.idempotencyKey,
        trustedActor: command.trustedActor,
      });
      if (!enqueued.ok) {
        if (enqueued.error.kind === "not-found") {
          return { ok: false, error: { kind: "not-found" } };
        }
        if (enqueued.error.kind === "idempotency-key-conflict") {
          return { ok: false, error: { kind: "reason", reason: "idempotency-key-conflict" } };
        }
        if (enqueued.error.kind === "authorization") {
          return { ok: false, error: { kind: "reason", reason: enqueued.error.reason } };
        }
        return { ok: false, error: { kind: "validation", field: "idempotencyKey" } };
      }
      return {
        ok: true,
        replayed: enqueued.value.replayed,
        value: await jobView({
          db,
          pool,
          job: enqueued.value.job,
          artifactId: loaded.value.artifactId,
          authorOrganizationId: view.authorOrganizationId,
        }),
      };
    },
    async getPublicationSurface(query) {
      const pointer = pool ? await readCurrentCatalogPointer(pool) : { kind: "absent" as const };
      const current =
        pointer.kind === "installed"
          ? { id: pointer.current.id, digest: pointer.current.digest }
          : { id: null, digest: null };
      const snapshot = await withPublicationCoordinator(db, (tx) =>
        collectPublicationPolicyControlFacts(tx, current),
      );
      const canAuthor = query.permissions.includes("catalog:author");
      const canPublish = query.permissions.includes("catalog:publish");
      const canReview = query.permissions.includes("catalog:review-high-risk");
      const blockers: PublicationSurfaceView["blockers"][number][] = [];
      if (query.actorKind === "agent") {
        blockers.push("publication-not-authorized");
      }
      if (!snapshot.publicationEnabled) {
        blockers.push("publication-policy-disabled");
      }
      if (snapshot.frozen) {
        blockers.push("publication-frozen");
      }
      if (!snapshot.adopted) {
        blockers.push("catalog-not-adopted");
      }
      if (!canAuthor && !canPublish && !canReview) {
        blockers.push("publication-capability-missing");
      }
      return {
        ok: true as const,
        value: {
          publicationEnabled: snapshot.publicationEnabled,
          lowRiskSingleActorPublish: snapshot.lowRiskSingleActorPublish,
          policyRevision: snapshot.policyRevision,
          frozen: snapshot.frozen,
          adopted: snapshot.adopted,
          currentReleaseId: snapshot.currentReleaseId,
          authoringAllowed: canAuthor && snapshot.publicationEnabled && !snapshot.frozen && snapshot.adopted,
          publishingAllowed:
            canPublish && snapshot.publicationEnabled && !snapshot.frozen && snapshot.adopted,
          reviewHighRiskAllowed:
            canReview && snapshot.publicationEnabled && !snapshot.frozen && snapshot.adopted,
          blockers,
        },
      };
    },
    async listPublications(query) {
      if (
        !query.permissions.includes("catalog:author") &&
        !query.permissions.includes("catalog:publish") &&
        !query.permissions.includes("catalog:review-high-risk")
      ) {
        return { ok: false as const, error: { kind: "forbidden" as const, reason: "publication-capability-missing" } };
      }
      const loaded = await withPublicationCoordinator(db, (tx) => listJobs(tx, query.limit ?? 20));
      if (!loaded.ok) {
        return { ok: false as const, error: { kind: "not-found" as const } };
      }
      const views: PublicationJobView[] = [];
      for (const job of loaded.value) {
        const candidate = await withPublicationCoordinator(db, (tx) => getCandidate(tx, job.candidateId));
        if (!candidate.ok) continue;
        const authorOrganizationId = authorOrganizationIdOf(candidate.value);
        if (authorOrganizationId === null || !inScope(authorOrganizationId, query.organizationId)) {
          continue;
        }
        views.push(
          await jobView({
            db,
            pool,
            job,
            artifactId: candidate.value.artifactId,
            authorOrganizationId,
          }),
        );
      }
      return { ok: true as const, value: views };
    },
    async getPublication(query) {
      let jobId: ReturnType<typeof PublicationJobId>;
      try {
        jobId = PublicationJobId(query.jobId);
      } catch {
        return { ok: false, error: { kind: "not-found" } };
      }
      const loaded = await withPublicationCoordinator(db, (tx) => getJob(tx, jobId));
      if (!loaded.ok) {
        return { ok: false, error: { kind: "not-found" } };
      }
      const candidate = await withPublicationCoordinator(db, (tx) => getCandidate(tx, loaded.value.candidateId));
      if (!candidate.ok) {
        return { ok: false, error: { kind: "not-found" } };
      }
      const authorOrganizationId = authorOrganizationIdOf(candidate.value);
      if (authorOrganizationId === null || !inScope(authorOrganizationId, query.organizationId)) {
        return { ok: false, error: { kind: "not-found" } };
      }
      return {
        ok: true,
        value: await jobView({
          db,
          pool,
          job: loaded.value,
          artifactId: candidate.value.artifactId,
          authorOrganizationId,
        }),
      };
    },
  };
}

export const unavailablePublicationCommandPorts: Pick<
  CatalogPublicationPorts,
  | "previewCandidate"
  | "getCandidate"
  | "publishCandidate"
  | "getPublication"
  | "getPublicationSurface"
  | "listPublications"
> = {
  previewCandidate: async () => ({ ok: false, error: { kind: "reason", reason: "catalog-not-ready" } }),
  getCandidate: async () => ({ ok: false, error: { kind: "not-found" } }),
  publishCandidate: async () => ({ ok: false, error: { kind: "reason", reason: "catalog-not-ready" } }),
  getPublication: async () => ({ ok: false, error: { kind: "not-found" } }),
  getPublicationSurface: async () => ({ ok: false, error: { kind: "reason", reason: "catalog-not-ready" } }),
  listPublications: async () => ({ ok: false, error: { kind: "not-found" } }),
};

export const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});
