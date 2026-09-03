import pg from "pg";

import {
  CatalogReleaseDigest,
  CatalogReleaseId,
  ReviewItemId,
  type CatalogReleasePin,
  type LegacyRowClass,
  type ReviewReason,
} from "../../parameter-catalog-contract/index";
import { createCatalogKernel } from "../../catalog-kernel/interface";

import { authorizeReviewQueueRead } from "./authorize";
import { groupReviewEvidence, projectReviewQueueItem, reviewItemIdFor } from "./group";
import type {
  ExistingOpenReviewItem,
  GetReviewItemQuery,
  GroupedReview,
  ListReviewQueueQuery,
  Result,
  ReviewEvidenceRecord,
  ReviewQueueFailure,
  ReviewQueueItem,
  ReviewQueueList,
  ReviewQueueReader,
  StoredReviewEvidenceBody,
} from "./types";

const isUsableToken = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  !/[\u0000-\u001F\u007F-\u009F]/u.test(value);

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
  matcher_revision: string;
  catalog_release_id: string;
  reason: ReviewReason;
  status: string;
  etag_version: string;
};

const invalid = (reason: string): Result<never, ReviewQueueFailure> => ({
  ok: false,
  error: { kind: "invalid-query", reason },
});

const validatePin = (pin: CatalogReleasePin): Result<CatalogReleasePin, ReviewQueueFailure> => {
  if (!isUsableToken(pin?.id) || !isUsableToken(pin?.digest)) {
    return invalid("capturedRelease");
  }
  return { ok: true, value: pin };
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

const loadEvidence = async (
  client: pg.PoolClient,
  organizationId: string,
): Promise<ReviewEvidenceRecord[]> => {
  const result = await client.query<EvidenceRow>(
    `select id, organization_id, reason, candidate_safe_digest, r_class, source_graph_ref, evidence
       from parameter_catalog.parameter_review_evidence
      where organization_id = $1`,
    [organizationId],
  );
  const records: ReviewEvidenceRecord[] = [];
  for (const row of result.rows) {
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
  return records;
};

const loadOpenItems = async (
  client: pg.PoolClient,
  organizationId: string,
): Promise<{ records: ReviewItemRow[]; existing: ExistingOpenReviewItem[] }> => {
  const result = await client.query<ReviewItemRow>(
    `select id, evidence_fingerprint, matcher_revision, catalog_release_id, reason, status, etag_version
       from parameter_catalog.parameter_review_items
      where organization_id = $1 and status = 'open'`,
    [organizationId],
  );
  return {
    records: result.rows,
    existing: result.rows.map((row) => ({
      id: row.id,
      groupingFingerprint: row.evidence_fingerprint,
    })),
  };
};

const insertOpenItem = async (
  client: pg.PoolClient,
  input: {
    id: string;
    organizationId: string;
    groupingFingerprint: string;
    matcherRevision: string;
    catalogReleaseId: string;
    reason: ReviewReason;
  },
): Promise<void> => {
  await client.query(
    `insert into parameter_catalog.parameter_review_items (
       id, organization_id, evidence_fingerprint, matcher_revision,
       catalog_release_id, reason, status, etag_version
     ) values ($1,$2,$3,$4,$5,$6,'open',1)
     on conflict (id) do nothing`,
    [
      input.id,
      input.organizationId,
      input.groupingFingerprint,
      input.matcherRevision,
      input.catalogReleaseId,
      input.reason,
    ],
  );
};

const capturedPinOrNull = (
  id: string | null | undefined,
  digest: string | null | undefined,
): CatalogReleasePin | null => {
  if (!id || !digest) return null;
  return { id: CatalogReleaseId(id), digest: CatalogReleaseDigest(digest) };
};

const assertCurrentPin = async (
  pool: pg.Pool,
  capturedRelease: CatalogReleasePin,
): Promise<Result<void, ReviewQueueFailure>> => {
  const kernel = createCatalogKernel(pool);
  const current = await kernel.loadCurrentCatalog(capturedRelease);
  if (current.ok) return { ok: true, value: undefined };
  const actual =
    current.error.kind === "release-mismatch" || current.error.kind === "drift"
      ? current.error.actual
      : null;
  return {
    ok: false,
    error: {
      kind: "stale-candidate",
      capturedRelease,
      currentRelease: actual
        ? capturedPinOrNull(actual.id, actual.digest)
        : null,
    },
  };
};

const projectGroups = (
  groups: readonly GroupedReview[],
  capturedRelease: CatalogReleasePin,
  openRows: ReviewItemRow[],
): ReviewQueueItem[] => {
  const byId = new Map(openRows.map((row) => [row.id, row]));
  const candidateState = { status: "current" as const, capturedRelease };
  return groups.map((group) => {
    const id = ReviewItemId(group.existingItemId ?? reviewItemIdFor(group.groupingFingerprint));
    const persisted = byId.get(id);
    return projectReviewQueueItem(group, {
      capturedRelease,
      candidateState,
      persisted: {
        id,
        etagVersion: Number(persisted?.etag_version ?? 1),
      },
    });
  });
};

const readAuthorizedQueue = async (
  pool: pg.Pool,
  query: ListReviewQueueQuery,
): Promise<Result<{ items: ReviewQueueItem[] }, ReviewQueueFailure>> => {
  const authorized = authorizeReviewQueueRead(query);
  if (!authorized.ok) return authorized;
  const pin = validatePin(query.capturedRelease);
  if (!pin.ok) return pin;
  const current = await assertCurrentPin(pool, pin.value);
  if (!current.ok) return current;

  const client = await pool.connect();
  try {
    await client.query("begin");
    const records = await loadEvidence(client, query.organizationId);
    const open = await loadOpenItems(client, query.organizationId);
    const grouped = groupReviewEvidence(records, pin.value, {
      existingOpenItems: open.existing,
    });
    if (!grouped.ok) {
      await client.query("rollback");
      return grouped;
    }
    for (const group of grouped.value) {
      const id = group.existingItemId ?? reviewItemIdFor(group.groupingFingerprint);
      try {
        await insertOpenItem(client, {
          id,
          organizationId: group.organizationId,
          groupingFingerprint: group.groupingFingerprint,
          matcherRevision: group.matcherRevision,
          catalogReleaseId: group.catalogReleaseId,
          reason: group.reason,
        });
      } catch (error) {
        await client.query("rollback");
        if (error instanceof pg.DatabaseError && error.code === "23505") {
          return {
            ok: false,
            error: {
              kind: "duplicate-group",
              organizationId: group.organizationId,
              groupingFingerprint: group.groupingFingerprint,
            },
          };
        }
        throw error;
      }
    }
    const refreshed = await loadOpenItems(client, query.organizationId);
    const items = projectGroups(grouped.value, pin.value, refreshed.records);
    await client.query("commit");
    return { ok: true, value: { items } };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const listReviewQueue = async (
  pool: pg.Pool,
  query: ListReviewQueueQuery,
): Promise<Result<ReviewQueueList, ReviewQueueFailure>> => {
  const result = await readAuthorizedQueue(pool, query);
  if (!result.ok) return result;
  if (result.value.items.length === 0) {
    return {
      ok: true,
      value: {
        items: [],
        catalogRelease: query.capturedRelease,
        emptyReason: "no-review-work",
      },
    };
  }
  return {
    ok: true,
    value: {
      items: result.value.items,
      catalogRelease: query.capturedRelease,
    },
  };
};

export const getReviewItem = async (
  pool: pg.Pool,
  query: GetReviewItemQuery,
): Promise<Result<ReviewQueueItem, ReviewQueueFailure>> => {
  if (!isUsableToken(query.reviewItemId)) {
    return invalid("reviewItemId");
  }
  const result = await readAuthorizedQueue(pool, query);
  if (!result.ok) return result;
  const item = result.value.items.find((entry) => entry.id === query.reviewItemId);
  if (!item) {
    return {
      ok: false,
      error: { kind: "review-item-not-found", reviewItemId: query.reviewItemId },
    };
  }
  return { ok: true, value: item };
};

export const createReviewQueueReader = (pool: pg.Pool): ReviewQueueReader => ({
  list: (query) => listReviewQueue(pool, query),
  get: (query) => getReviewItem(pool, query),
});
