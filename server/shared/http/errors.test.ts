import { describe, expect, it } from "vitest";

import { API_ERROR_STATUS, ApiError, serializeApiError, type ApiErrorCode } from "./errors";

describe("ApiError status derivation", () => {
  it("derives the HTTP status from the code table for every code", () => {
    for (const [code, status] of Object.entries(API_ERROR_STATUS)) {
      const error = new ApiError(code as ApiErrorCode, "message");
      expect(error.status).toBe(status);
    }
  });

  it("accepts details as the optional third argument and still uses the table status", () => {
    const error = new ApiError("VALIDATION_FAILED", "message", { reason: "x" });
    expect(error.status).toBe(400);
    expect(error.details).toEqual({ reason: "x" });
  });

  it("keeps details defaulting and error name", () => {
    const error = new ApiError("NOT_FOUND", "missing");
    expect(error.status).toBe(404);
    expect(error.details).toEqual({});
    expect(error.name).toBe("ApiError");
  });
});

describe("serializeApiError", () => {
  it("serializes ApiError without leaking status internals", () => {
    const body = serializeApiError(new ApiError("FORBIDDEN", "no", { permission: "x" }), "req-1");
    expect(body).toEqual({
      error: { code: "FORBIDDEN", message: "no", details: { permission: "x" }, requestId: "req-1" }
    });
  });

  it("degrades unknown errors to INTERNAL_ERROR without details", () => {
    const body = serializeApiError(new Error("secret stack"), "req-2");
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error.", details: {}, requestId: "req-2" }
    });
  });
});
