import type { CatalogApiFailureReason } from "@wiseeff/dto-schemas";

import { WiseEffApiError } from "@/infrastructure/http/apiClient";

const FAILURE_CODE: Record<CatalogApiFailureReason, string> = {
  "catalog-not-ready": "SERVICE_UNAVAILABLE",
  "release-drift": "CONFLICT",
  "subject-not-published": "NOT_FOUND",
  "subject-retired": "CONFLICT",
  "definition-not-found": "NOT_FOUND",
  "definition-retired": "CONFLICT",
  "registration-required": "CONFLICT",
  "placement-conflict": "CONFLICT",
  "invalid-placement-parent": "CONFLICT",
  "observation-ambiguous": "CONFLICT",
  "proposal-stale": "CONFLICT",
  "proposal-self-approval-forbidden": "FORBIDDEN",
  "revision-conflict": "CONFLICT",
  "legacy-id-archived": "GONE",
  "legacy-surface-retired": "GONE",
  "legacy-id-ambiguous": "CONFLICT",
  forbidden: "FORBIDDEN",
  "migration-diagnostics-not-public": "NOT_FOUND"
};

export function catalogApiFailure(
  reason: CatalogApiFailureReason,
  details: Record<string, unknown> = {}
): WiseEffApiError {
  return new WiseEffApiError(
    FAILURE_CODE[reason],
    "Catalog request failed.",
    { reason, ...details },
    "catalog"
  );
}
