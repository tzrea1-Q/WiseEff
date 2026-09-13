import { catalogApiFailureReasonSchema } from "../../contracts/dtoSchemas/parameterCatalog";
import {
  CatalogCandidateId,
  CatalogReleaseDigest,
  CatalogReleaseId,
  PublicationJobId,
  type CatalogReleasePin,
} from "../../parameter-catalog-contract/index";
import { classifyImpact } from "../../catalog-publication/authorization/classify";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../../catalog-publication/builder/capabilities";
import { withPublicationCoordinator } from "../../catalog-publication/coordinator";
import { enqueuePublicationJob } from "../../catalog-publication/enqueue";
import { impactFactsFromAllocation } from "../../catalog-publication/jobs/execute";
import { parsePublicationChangeSet, previewPublicationCandidate } from "../../catalog-publication/preview";
import {
  getCandidate,
  getJob,
  getReceiptByJobId,
} from "../../catalog-publication/persistence/store";
import type { PublicationCandidateRecord, PublicationJobRecord } from "../../catalog-publication/persistence/types";
import { readCurrentCatalogPointer } from "../../catalog-kernel/install/currentPointer";
import type { Database } from "../../../shared/database/client";

type CatalogPointerPool = Parameters<typeof readCurrentCatalogPointer>[0];
import type {
  CatalogPublicationFailure,
  CatalogPublicationPorts,
  PublicationCandidateView,
  PublicationJobView,
} from "./types";

const authorOrganizationIdOf = (candidate: PublicationCandidateRecord): string | null => {
  const value = candidate.identityAllocation.authorOrganizationId;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const capabilityOf = (candidate: PublicationCandidateRecord): PublicationCandidateView["capabilityContract"] => {
  const contract = candidate.capabilityContract;
  const revision =
    typeof contract.revision === "string" ? contract.revision : CATALOG_CAPABILITY_CONTRACT_REVISION;
  const allowListId = typeof contract.allowListId === "string" ? contract.allowListId : "page-m1-definition-content";
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
  readonly authorOrganizationId: string;
}): Promise<PublicationJobView> => {
  const receipt = await withPublicationCoordinator(input.db, (tx) => getReceiptByJobId(tx, input.job.id));
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
  "previewCandidate" | "getCandidate" | "publishCandidate" | "getPublication"
> {
  const { db, pool } = input;
  return {
    async previewCandidate(command) {
      if (
        !command.permissions.includes("catalog:author") &&
        !command.permissions.includes("catalog:publish")
      ) {
        return {
          ok: false,
          error: { kind: "forbidden", reason: "publication-capability-missing" },
        };
      }
      const parsed = parsePublicationChangeSet(command.changeSet);
      if ("error" in parsed) {
        return { ok: false, error: mapPreviewError(parsed.error.kind, parsed.error.kind) };
      }
      const pointer = pool ? await readCurrentCatalogPointer(pool) : { kind: "absent" as const };
      if (pointer.kind !== "installed" || pointer.current.id !== command.catalogReleaseId) {
        return { ok: false, error: { kind: "reason", reason: "candidate-stale" } };
      }
      const previewed = await previewPublicationCandidate({
        db,
        predecessorDigest: pointer.current.digest,
        changeSet: parsed,
        authorPrincipalId: command.principalId,
        authorOrganizationId: command.organizationId,
        proposalId: command.proposalId,
        proposalRevisionId: command.proposalRevisionId,
      });
      if (!previewed.ok) {
        return { ok: false, error: mapPreviewError(previewed.error.kind) };
      }
      return {
        ok: true,
        value: {
          id: previewed.value.candidate.id,
          expectedBaseReleaseId: previewed.value.candidate.expectedBaseReleaseId,
          expectedBaseReleaseDigest: previewed.value.candidate.expectedBaseReleaseDigest,
          riskClass: previewed.value.riskClass,
          impactSummary: previewed.value.impactSummary,
          capabilityContract: capabilityOf(previewed.value.candidate),
          authorOrganizationId: command.organizationId,
        },
      };
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
          authorOrganizationId: view.authorOrganizationId,
        }),
      };
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
          authorOrganizationId,
        }),
      };
    },
  };
}

export const unavailablePublicationCommandPorts: Pick<
  CatalogPublicationPorts,
  "previewCandidate" | "getCandidate" | "publishCandidate" | "getPublication"
> = {
  previewCandidate: async () => ({ ok: false, error: { kind: "reason", reason: "catalog-not-ready" } }),
  getCandidate: async () => ({ ok: false, error: { kind: "not-found" } }),
  publishCandidate: async () => ({ ok: false, error: { kind: "reason", reason: "catalog-not-ready" } }),
  getPublication: async () => ({ ok: false, error: { kind: "not-found" } }),
};

export const pinOf = (id: string, digest: string): CatalogReleasePin => ({
  id: CatalogReleaseId(id),
  digest: CatalogReleaseDigest(digest),
});
