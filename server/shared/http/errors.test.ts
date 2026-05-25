import { describe, expect, it } from "vitest";
import { ApiError, serializeApiError } from "./errors";

describe("ApiError", () => {
  it("serializes known errors with request id", () => {
    const error = new ApiError("FORBIDDEN", "Admin access required.", 403, { action: "admin.access" });

    expect(serializeApiError(error, "req-1")).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "Admin access required.",
        details: { action: "admin.access" },
        requestId: "req-1"
      }
    });
  });

  it("hides unknown internal error details", () => {
    expect(serializeApiError(new Error("database password leaked"), "req-2")).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
        details: {},
        requestId: "req-2"
      }
    });
  });
});
