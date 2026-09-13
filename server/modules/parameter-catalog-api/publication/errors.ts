import {
  CATALOG_RELEASE_HEADER,
  CATALOG_RETRY_AFTER_HEADER,
  type CatalogApiFailureReason,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogPublicationFailure, CatalogPublicationResponse } from "./types";

const CATALOG_NOT_READY_RETRY_AFTER_SECONDS = 5;

const REASON_HTTP_STATUS: Partial<Record<CatalogApiFailureReason, number>> = {
  "publication-not-authorized": 403,
  "publication-capability-missing": 403,
  "publication-self-approval-forbidden": 403,
  "publication-policy-disabled": 403,
  "publication-frozen": 409,
  "candidate-stale": 409,
  "candidate-tampered": 409,
  "needs-rebase": 409,
  "publication-authorization-revoked": 409,
  "idempotency-key-conflict": 409,
  "artifact-missing": 409,
  "predecessor-incomplete": 409,
  "activation-receipt-mismatch": 409,
  "adoption-evidence-invalid": 409,
  "unsupported-catalog-capability": 422,
};

export function catalogPublicationError(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly reason?: CatalogApiFailureReason;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}): CatalogPublicationResponse {
  const retryable = input.status === 503 || input.reason === "release-drift";
  return {
    status: input.status,
    body: {
      error: {
        code: input.code,
        message: input.message,
        details: {
          ...(input.reason ? { reason: input.reason } : {}),
          retryable,
          ...input.details,
        },
        requestId: input.requestId,
      },
    },
    headers: {
      "X-Request-Id": input.requestId,
      ...input.headers,
    },
  };
}

export function unauthenticated(requestId: string): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Authentication required.",
    reason: "forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function forbidden(requestId: string, reason: CatalogApiFailureReason = "forbidden"): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 403,
    code: "FORBIDDEN",
    message: "Forbidden.",
    reason,
    requestId,
    details: { retryable: false },
  });
}

export function notFound(requestId: string): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 404,
    code: "NOT_FOUND",
    message: "Not found.",
    requestId,
    details: { retryable: false },
  });
}

export function validationFailed(requestId: string, field: string): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "Invalid catalog publication request.",
    requestId,
    details: { retryable: false, field },
  });
}

export function releaseDrift(
  requestId: string,
  expectedCatalogReleaseId: string,
  currentCatalogReleaseId: string,
): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 409,
    code: "CONFLICT",
    message: "The catalog release changed. Refresh before continuing.",
    reason: "release-drift",
    requestId,
    details: {
      expectedCatalogReleaseId,
      currentCatalogReleaseId,
    },
  });
}

export function catalogNotReady(requestId: string): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    message: "Catalog is not ready.",
    reason: "catalog-not-ready",
    requestId,
    headers: {
      [CATALOG_RETRY_AFTER_HEADER]: String(CATALOG_NOT_READY_RETRY_AFTER_SECONDS),
    },
  });
}

export function publicationReason(
  requestId: string,
  reason: CatalogApiFailureReason,
): CatalogPublicationResponse {
  const status = REASON_HTTP_STATUS[reason] ?? 409;
  const code = status === 403 ? "FORBIDDEN" : status === 422 ? "VALIDATION_FAILED" : "CONFLICT";
  return catalogPublicationError({
    status,
    code,
    message: "The publication command was refused.",
    reason,
    requestId,
    details: { retryable: false },
  });
}

export function internalStorageError(requestId: string): CatalogPublicationResponse {
  return catalogPublicationError({
    status: 500,
    code: "INTERNAL_ERROR",
    message: "Publication storage failed.",
    requestId,
    details: { retryable: false },
  });
}

export function mapPublicationFailure(
  error: CatalogPublicationFailure,
  requestId: string,
): CatalogPublicationResponse {
  if (error.kind === "unauthenticated") {
    return unauthenticated(requestId);
  }
  if (error.kind === "not-found") {
    return notFound(requestId);
  }
  if (error.kind === "forbidden") {
    return forbidden(requestId, (error.reason as CatalogApiFailureReason | undefined) ?? "forbidden");
  }
  if (error.kind === "validation") {
    return validationFailed(requestId, error.field ?? "body");
  }
  if (error.reason) {
    return publicationReason(requestId, error.reason as CatalogApiFailureReason);
  }
  return internalStorageError(requestId);
}

export function catalogPublicationOk(input: {
  readonly status?: number;
  readonly body: unknown;
  readonly requestId: string;
  readonly catalogReleaseId: string;
}): CatalogPublicationResponse {
  return {
    status: input.status ?? 200,
    body: input.body,
    headers: {
      "X-Request-Id": input.requestId,
      [CATALOG_RELEASE_HEADER]: input.catalogReleaseId,
    },
  };
}
