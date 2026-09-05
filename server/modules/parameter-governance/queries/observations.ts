import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  ParameterObservationId,
} from "../../parameter-catalog-contract/index";
import { groupReviewEvidence, reviewItemIdFor } from "../review/group";
import type {
  ExistingOpenReviewItem,
  ReviewEvidenceRecord,
  StoredReviewEvidenceBody,
} from "../review/types";

import { assertOrgScope, fail, isUsableToken, runQuery } from "./client";
import { emptyReasonForView, mapObservationRecognition } from "./mapping";
import type {
  GetObservationQuery,
  GovernanceObservationRecord,
  GovernanceQueryable,
  GovernanceQueryFailure,
  ListObservationsQuery,
  ObservationList,
  Result,
} from "./types";
import { GOVERNANCE_CURRENT_PROJECTION_SEMANTICS } from "./types";

type ObservationRow = {
  id: string;
  organization_id: string;
  source_identity: string;
  source_locator: unknown;
};

type EvidenceRow = {
  id: string;
  organization_id: string;
  observation_id: string | null;
  reason: string;
  candidate_safe_digest: string;
  r_class: string | null;
  source_graph_ref: string | null;
  evidence: unknown;
};

type OpenItemRow = {
  id: string;
  evidence_fingerprint: string;
};

const propertyKeyFromLocator = (locator: unknown, fallback: string): string => {
  if (locator !== null && typeof locator === "object" && !Array.isArray(locator)) {
    const record = locator as Record<string, unknown>;
    if (isUsableToken(record.propertyKey)) return record.propertyKey;
    if (isUsableToken(record.property)) return record.property;
  }
  return fallback;
};

const parseStoredEvidence = (value: unknown): StoredReviewEvidenceBody | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isUsableToken(body.sourceIdentity) || !isUsableToken(body.catalogReleaseId)) return null;
  if (!isUsableToken(body.matcherRevision) || typeof body.reason !== "string") return null;
  const payload =
    body.payload !== null && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as StoredReviewEvidenceBody["payload"])
      : {};
  return {
    sourceIdentity: body.sourceIdentity,
    catalogReleaseId: body.catalogReleaseId,
    matcherRevision: body.matcherRevision,
    matcherOutput: typeof body.matcherOutput === "string" ? body.matcherOutput : "",
    reason: body.reason as StoredReviewEvidenceBody["reason"],
    rClass: (body.rClass as StoredReviewEvidenceBody["rClass"]) ?? null,
    sourceGraphRef: typeof body.sourceGraphRef === "string" ? body.sourceGraphRef : null,
    payload,
  };
};

const loadObservationRecords = async (
  client: GovernanceQueryable,
  organizationId: string,
  observedCatalogReleaseId: string,
): Promise<Result<GovernanceObservationRecord[], GovernanceQueryFailure>> => {
  const observations = await client.query<ObservationRow>(
    `select id, organization_id, source_identity, source_locator
       from parameter_catalog.parameter_observations
      where organization_id = $1
      order by id asc`,
    [organizationId],
  );
  const evidence = await client.query<EvidenceRow>(
    `select id, organization_id, observation_id, reason, candidate_safe_digest, r_class,
            source_graph_ref, evidence
       from parameter_catalog.parameter_review_evidence
      where organization_id = $1
      order by id asc`,
    [organizationId],
  );
  const openItems = await client.query<OpenItemRow>(
    `select id, evidence_fingerprint
       from parameter_catalog.parameter_review_items
      where organization_id = $1
        and status = 'open'`,
    [organizationId],
  );

  const records: ReviewEvidenceRecord[] = [];
  for (const row of evidence.rows) {
    const body = parseStoredEvidence(row.evidence);
    if (!body) continue;
    records.push({
      id: row.id,
      organizationId: row.organization_id,
      reason: row.reason as ReviewEvidenceRecord["reason"],
      candidateSafeDigest: row.candidate_safe_digest,
      rClass: row.r_class as ReviewEvidenceRecord["rClass"],
      sourceGraphRef: row.source_graph_ref,
      evidence: body,
    });
  }
  const existingOpen: ExistingOpenReviewItem[] = openItems.rows.map((row) => ({
    id: row.id,
    groupingFingerprint: row.evidence_fingerprint,
  }));
  const grouped = groupReviewEvidence(
    records,
    {
      id: CatalogReleaseId(observedCatalogReleaseId),
      digest: CatalogReleaseDigest(observedCatalogReleaseId),
    },
    { existingOpenItems: existingOpen },
  );
  const reviewItemByEvidenceId = new Map<string, string>();
  if (grouped.ok) {
    for (const group of grouped.value) {
      const itemId = group.existingItemId ?? reviewItemIdFor(group.groupingFingerprint);
      for (const record of group.evidence) {
        reviewItemByEvidenceId.set(record.id, itemId);
      }
    }
  }

  const items: GovernanceObservationRecord[] = [];
  for (const row of observations.rows) {
    items.push({
      id: ParameterObservationId(row.id),
      organizationId: row.organization_id,
      propertyKey: propertyKeyFromLocator(row.source_locator, row.source_identity),
      sourceRef: { kind: "observation", id: row.id },
      recognition: "matched",
      reviewItemId: null,
    });
  }
  for (const row of evidence.rows) {
    if (row.observation_id) continue;
    const recognition = mapObservationRecognition(row.reason);
    if (!recognition) {
      return fail({ kind: "invalid-query", reason: "recognition-literal" });
    }
    const body = parseStoredEvidence(row.evidence);
    items.push({
      id: row.id,
      organizationId: row.organization_id,
      propertyKey: propertyKeyFromLocator(body?.payload ?? {}, body?.sourceIdentity ?? row.id),
      sourceRef: { kind: "review-evidence", id: row.id },
      recognition,
      reviewItemId: reviewItemByEvidenceId.get(row.id) ?? null,
    });
  }
  items.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { ok: true, value: items };
};

export const listObservations = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: ListObservationsQuery,
): Promise<Result<ObservationList, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "observedCatalogReleaseId" });
  }
  return runQuery(source, "listObservations", async (client) => {
    const loaded = await loadObservationRecords(client, query.organizationId, query.observedCatalogReleaseId);
    if (!loaded.ok) return loaded;
    return {
      ok: true,
      value: {
        semantics: GOVERNANCE_CURRENT_PROJECTION_SEMANTICS,
        items: loaded.value,
        emptyReason: emptyReasonForView("observations", loaded.value.length, false),
      },
    };
  });
};

export const getObservation = async (
  source: import("pg").Pool | import("pg").PoolClient | GovernanceQueryable,
  query: GetObservationQuery,
): Promise<Result<GovernanceObservationRecord, GovernanceQueryFailure>> => {
  const scoped = assertOrgScope(query.organizationId, query.authScope);
  if (!scoped.ok) return scoped;
  if (!isUsableToken(query.observationId) || !isUsableToken(query.observedCatalogReleaseId)) {
    return fail({ kind: "invalid-query", reason: "observationId" });
  }
  return runQuery<GovernanceObservationRecord>(source, "getObservation", async (client) => {
    const loaded = await loadObservationRecords(client, query.organizationId, query.observedCatalogReleaseId);
    if (!loaded.ok) return loaded;
    const record = loaded.value.find((item) => item.id === query.observationId);
    if (!record) {
      return fail({ kind: "not-found", resource: "observation" });
    }
    return { ok: true, value: record };
  });
};
