import type {
  CatalogReleasePin,
  CatalogSubjectId,
  LegacyRowClass,
  ReviewReason,
} from "../../parameter-catalog-contract/index";
import { groupReviewEvidence } from "../review/group";
import type {
  ExistingOpenReviewItem,
  ReviewEvidenceRecord,
  StoredReviewEvidenceBody,
} from "../review/types";

import { isUsableToken } from "./client";
import type { GovernanceQueryable } from "./types";

const reviewReasons = new Set<ReviewReason>([
  "unknown",
  "ambiguous",
  "placement-conflict",
  "retired-registration-observed",
]);

type EvidenceRow = {
  id: string;
  organization_id: string;
  reason: ReviewReason;
  candidate_safe_digest: string;
  r_class: LegacyRowClass | null;
  source_graph_ref: string | null;
  evidence: unknown;
};

type ReviewItemRow = {
  id: string;
  evidence_fingerprint: string;
  status: string;
};

const parseStoredEvidence = (value: unknown): StoredReviewEvidenceBody | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isUsableToken(body.sourceIdentity) || !isUsableToken(body.catalogReleaseId)) return null;
  if (!isUsableToken(body.matcherRevision)) return null;
  if (typeof body.reason !== "string" || !reviewReasons.has(body.reason as ReviewReason)) {
    return null;
  }
  const payload =
    body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as StoredReviewEvidenceBody["payload"])
      : {};
  return {
    sourceIdentity: body.sourceIdentity,
    catalogReleaseId: body.catalogReleaseId,
    matcherRevision: body.matcherRevision,
    matcherOutput: typeof body.matcherOutput === "string" ? body.matcherOutput : "",
    reason: body.reason as ReviewReason,
    rClass: (body.rClass as LegacyRowClass | null) ?? null,
    sourceGraphRef: typeof body.sourceGraphRef === "string" ? body.sourceGraphRef : null,
    payload,
  };
};

const subjectIdFromPayload = (payload: { readonly [key: string]: unknown }): string | null => {
  const subjectId = payload.subjectId;
  return isUsableToken(subjectId) ? subjectId : null;
};

export const loadReviewCountsBySubject = async (
  client: GovernanceQueryable,
  organizationId: string,
  subjectIds: readonly CatalogSubjectId[],
  observedRelease: CatalogReleasePin,
): Promise<ReadonlyMap<CatalogSubjectId, number>> => {
  const counts = new Map<CatalogSubjectId, number>();
  for (const subjectId of subjectIds) {
    counts.set(subjectId, 0);
  }
  if (subjectIds.length === 0) {
    return counts;
  }

  const evidenceResult = await client.query<EvidenceRow>(
    `select id, organization_id, reason, candidate_safe_digest, r_class, source_graph_ref, evidence
       from parameter_catalog.parameter_review_evidence
      where organization_id = $1`,
    [organizationId],
  );
  const itemResult = await client.query<ReviewItemRow>(
    `select id, evidence_fingerprint, status
       from parameter_catalog.parameter_review_items
      where organization_id = $1`,
    [organizationId],
  );

  const records: ReviewEvidenceRecord[] = [];
  for (const row of evidenceResult.rows) {
    const evidence = parseStoredEvidence(row.evidence);
    if (!evidence) continue;
    records.push({
      id: row.id,
      organizationId: row.organization_id,
      reason: row.reason,
      candidateSafeDigest: row.candidate_safe_digest,
      rClass: row.r_class,
      sourceGraphRef: row.source_graph_ref,
      evidence,
    });
  }

  const existingOpen: ExistingOpenReviewItem[] = itemResult.rows
    .filter((row) => row.status === "open")
    .map((row) => ({ id: row.id, groupingFingerprint: row.evidence_fingerprint }));
  const statusByFingerprint = new Map<string, string[]>();
  for (const row of itemResult.rows) {
    const statuses = statusByFingerprint.get(row.evidence_fingerprint) ?? [];
    statuses.push(row.status);
    statusByFingerprint.set(row.evidence_fingerprint, statuses);
  }

  const grouped = groupReviewEvidence(records, observedRelease, {
    existingOpenItems: existingOpen,
  });
  if (!grouped.ok) {
    return counts;
  }

  const allowed = new Set(subjectIds as readonly string[]);
  for (const group of grouped.value) {
    const statuses = statusByFingerprint.get(group.groupingFingerprint) ?? [];
    const hasOpen = statuses.includes("open");
    const unresolved = statuses.length === 0;
    if (!hasOpen && !unresolved) {
      continue;
    }
    const subjectId =
      group.evidence
        .map((record) => subjectIdFromPayload(record.evidence.payload as { readonly [key: string]: unknown }))
        .find((id): id is string => id !== null && allowed.has(id)) ?? null;
    if (!subjectId) {
      continue;
    }
    const key = subjectId as CatalogSubjectId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
};
