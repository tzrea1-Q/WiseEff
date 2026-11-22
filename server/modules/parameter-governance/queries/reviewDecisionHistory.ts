import type { Queryable } from "../../../shared/database/client";
import type { ReviewReason, ReviewResolutionType } from "../../parameter-catalog-contract";

type ClosedReviewDecisionRow = {
  id: string;
  evidence_fingerprint: string;
  matcher_revision: string;
  catalog_release_id: string;
  reason: ReviewReason;
  status: "resolved" | "out-of-scope";
  etag_version: string;
  reopened_from_item_id: string | null;
  reopen_reason: string | null;
  resolution_id: string;
  resolution_type: ReviewResolutionType;
  out_of_scope_reason: string | null;
  successor_id: string | null;
};

/** Organization-scoped history reads the decision and its successor without invoking the writer. */
export async function readClosedReviewDecisions(db: Queryable, organizationId: string, reviewItemId?: string) {
  const result = await db.query<ClosedReviewDecisionRow>(
    `select item.id,item.evidence_fingerprint,item.matcher_revision,item.catalog_release_id,item.reason,item.status,item.etag_version,
       item.reopened_from_item_id,item.reopen_reason,resolution.id as resolution_id,resolution.resolution_type,resolution.out_of_scope_reason,
       successor.id as successor_id
     from parameter_catalog.parameter_review_items item
     join parameter_catalog.parameter_review_resolutions resolution on resolution.review_item_id=item.id and resolution.id=item.current_resolution_id
     left join parameter_catalog.parameter_review_items successor on successor.organization_id=item.organization_id and successor.reopened_from_item_id=item.id
     where item.organization_id=$1 and (($2::text is null and item.status='out-of-scope') or item.id=$2)
     order by resolution.created_at desc,item.id`, [organizationId, reviewItemId ?? null]);
  return result.rows;
}
