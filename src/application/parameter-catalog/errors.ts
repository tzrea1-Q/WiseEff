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
  "proposal-replay-unavailable": "SERVICE_UNAVAILABLE",
  "proposal-self-approval-forbidden": "FORBIDDEN",
  "revision-conflict": "CONFLICT",
  "legacy-id-archived": "GONE",
  "legacy-surface-retired": "GONE",
  "legacy-id-ambiguous": "CONFLICT",
  forbidden: "FORBIDDEN",
  "migration-diagnostics-not-public": "NOT_FOUND",
  "publication-not-authorized": "FORBIDDEN",
  "publication-capability-missing": "FORBIDDEN",
  "publication-self-approval-forbidden": "FORBIDDEN",
  "publication-policy-disabled": "FORBIDDEN",
  "publication-frozen": "CONFLICT",
  "candidate-stale": "CONFLICT",
  "candidate-tampered": "CONFLICT",
  "needs-rebase": "CONFLICT",
  "unsupported-catalog-capability": "VALIDATION_FAILED",
  "publication-authorization-revoked": "CONFLICT",
  "idempotency-key-conflict": "CONFLICT",
  "artifact-missing": "CONFLICT",
  "predecessor-incomplete": "CONFLICT",
  "activation-receipt-mismatch": "CONFLICT",
  "adoption-evidence-invalid": "CONFLICT",
  "registration-followup-failed": "INTERNAL_ERROR"
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
