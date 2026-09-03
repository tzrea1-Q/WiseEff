import {
  CATALOG_RELEASE_HEADER,
  CATALOG_RETRY_AFTER_HEADER,
  type CatalogApiFailureReason,
} from "../../contracts/dtoSchemas/parameterCatalog";
import type { CatalogKernelError } from "../../parameter-catalog-contract/index";
import type { CatalogReadResponse } from "./types";

const CATALOG_NOT_READY_RETRY_AFTER_SECONDS = 5;

export function catalogReadError(input: {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly requestId: string;
  readonly reason?: CatalogApiFailureReason;
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;
}): CatalogReadResponse {
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

export function unauthenticated(requestId: string): CatalogReadResponse {
  return catalogReadError({
    status: 401,
    code: "UNAUTHENTICATED",
    message: "Authentication required.",
    reason: "forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function forbidden(requestId: string): CatalogReadResponse {
  return catalogReadError({
    status: 403,
    code: "FORBIDDEN",
    message: "Forbidden.",
    reason: "forbidden",
    requestId,
    details: { retryable: false },
  });
}

export function notFound(
  requestId: string,
  reason: Extract<CatalogApiFailureReason, "subject-not-published" | "definition-not-found">,
): CatalogReadResponse {
  return catalogReadError({
    status: 404,
    code: "NOT_FOUND",
    message: "Not found.",
    reason,
    requestId,
    details: { retryable: false },
  });
}

export function validationFailed(requestId: string, field: string): CatalogReadResponse {
  return catalogReadError({
    status: 400,
    code: "VALIDATION_FAILED",
    message: "Invalid catalog read request.",
    requestId,
    details: { retryable: false, field },
  });
}

export function releaseDrift(
  requestId: string,
  expectedCatalogReleaseId: string,
  currentCatalogReleaseId: string,
): CatalogReadResponse {
  return catalogReadError({
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
): CatalogReadResponse {
  return catalogReadError({
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

export function catalogReadOk(
  body: unknown,
  catalogReleaseId: string,
  requestId: string,
): CatalogReadResponse {
  return {
    status: 200,
    body,
    headers: {
      "X-Request-Id": requestId,
      [CATALOG_RELEASE_HEADER]: catalogReleaseId,
    },
  };
}

export function mapKernelLoadError(
  error: CatalogKernelError,
  requestId: string,
  documentRoute: boolean,
): CatalogReadResponse {
  switch (error.kind) {
    case "release-mismatch":
      if (documentRoute) {
        return catalogNotReady(requestId);
      }
      return releaseDrift(
        requestId,
        error.expected.id,
        error.actual?.id ?? "unknown",
      );
    case "drift":
    case "synchronization-busy":
      return catalogNotReady(requestId);
    case "storage-failure":
      return error.retryable ? catalogNotReady(requestId) : catalogNotReady(requestId);
    case "historical-release-unavailable":
      return documentRoute ? catalogNotReady(requestId) : notFound(requestId, "subject-not-published");
    case "permission-denied":
      return forbidden(requestId);
    default:
      return catalogNotReady(requestId);
  }
}

export function mapInvalidPage(
  reason: "cursor-malformed" | "release-mismatch" | "query-mismatch",
  requestId: string,
  catalogReleaseId: string,
): CatalogReadResponse {
  if (reason === "release-mismatch") {
    return releaseDrift(requestId, catalogReleaseId, catalogReleaseId);
  }
  return validationFailed(requestId, "cursor");
}
