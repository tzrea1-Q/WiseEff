export type ApiErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "PROCESSING"
  | "RATE_LIMITED"
  | "APPROVAL_REQUIRED"
  | "INVALID_APPROVAL_STATE"
  | "AGENT_TOOL_FAILED"
  | "DEVICE_UNAVAILABLE"
  | "PROTOCOL_UNSUPPORTED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly status: number,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
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
