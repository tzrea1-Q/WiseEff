export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "APPROVAL_REQUIRED"
  | "INVALID_APPROVAL_STATE"
  | "DEVICE_UNAVAILABLE"
  | "PROTOCOL_UNSUPPORTED"
  | "DEBUG_BINDING_NOT_CONFIGURED"
  | "DEBUG_BINDING_DISABLED"
  | "GONE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

/**
 * The HTTP status for every error code. This table is the single source of truth:
 * the `ApiError` constructor derives `status` from `code`, so a code/status mismatch
 * is structurally impossible at a construction site.
 */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  CONFLICT: 409,
  APPROVAL_REQUIRED: 409,
  INVALID_APPROVAL_STATE: 409,
  DEVICE_UNAVAILABLE: 409,
  PROTOCOL_UNSUPPORTED: 409,
  DEBUG_BINDING_NOT_CONFIGURED: 400,
  DEBUG_BINDING_DISABLED: 400,
  GONE: 410,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500
};

export class ApiError extends Error {
  /** HTTP status derived from `code` via `API_ERROR_STATUS`. */
  public readonly status: number;

  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = API_ERROR_STATUS[code];
  }
}

export function serializeApiError(error: unknown, requestId: string) {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId
      }
    };
  }

  return {
    error: {
      code: "INTERNAL_ERROR" as const,
      message: "Internal server error.",
      details: {},
      requestId
    }
  };
}
