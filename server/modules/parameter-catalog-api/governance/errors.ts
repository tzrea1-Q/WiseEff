import {
  CATALOG_RELEASE_HEADER,
  CATALOG_RETRY_AFTER_HEADER,
  type CatalogApiFailureReason,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogGovernanceResponse } from "./types";

const CATALOG_NOT_READY_RETRY_AFTER_SECONDS = 5;

export function catalogGovernanceError(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly reason?: CatalogApiFailureReason;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}): CatalogGovernanceResponse {
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

export function unauthenticated(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Authentication required.",
    reason: "forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function forbidden(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 403,
    code: "FORBIDDEN",
    message: "Forbidden.",
    reason: "forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function selfApprovalForbidden(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 403,
    code: "FORBIDDEN",
    message: "A proposer cannot accept or reject their own proposal.",
    reason: "proposal-self-approval-forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function notFound(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 404,
    code: "NOT_FOUND",
    message: "Not found.",
    requestId,
    details: { retryable: false },
  });
}

export function subjectNotPublished(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 404,
    code: "NOT_FOUND",
    message: "Not found.",
    reason: "subject-not-published",
    requestId,
    details: { retryable: false },
  });
}

export function validationFailed(requestId: string, field: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "Invalid catalog governance request.",
    requestId,
    details: { retryable: false, field },
  });
}

export function revisionConflict(requestId: string): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 409,
    code: "CONFLICT",
    message: "The resource changed. Refresh and reconfirm before continuing.",
    reason: "revision-conflict",
    requestId,
    details: { retryable: false },
  });
}

export function releaseDrift(
  requestId: string,
  expectedCatalogReleaseId: string,
  currentCatalogReleaseId: string,
): CatalogGovernanceResponse {
  return catalogGovernanceError({
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

export function catalogNotReady(
  requestId: string,
  retryAfterSeconds = CATALOG_NOT_READY_RETRY_AFTER_SECONDS,
): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    message: "Catalog is not ready.",
    reason: "catalog-not-ready",
    requestId,
    headers: {
      [CATALOG_RETRY_AFTER_HEADER]: String(retryAfterSeconds),
    },
  });
}

export function conflict(
  requestId: string,
  reason: Extract<
    CatalogApiFailureReason,
    | "placement-conflict"
    | "invalid-placement-parent"
    | "subject-retired"
    | "registration-required"
    | "proposal-stale"
    | "observation-ambiguous"
  >,
): CatalogGovernanceResponse {
  return catalogGovernanceError({
    status: 409,
    code: "CONFLICT",
    message: "The governance write was refused.",
    reason,
    requestId,
    details: { retryable: false },
  });
}

export function catalogGovernanceOk(input: {
  readonly status?: number;
  readonly body: unknown;
  readonly requestId: string;
  readonly catalogReleaseId: string;
  readonly etag?: string;
}): CatalogGovernanceResponse {
  return {
    status: input.status ?? 200,
    body: input.body,
    headers: {
      "X-Request-Id": input.requestId,
      [CATALOG_RELEASE_HEADER]: input.catalogReleaseId,
      ...(input.etag ? { ETag: input.etag } : {}),
    },
  };
}
