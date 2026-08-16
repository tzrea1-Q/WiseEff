import { describe, expect, it } from "vitest";

import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { mockApiError } from "./mockApiError";

describe("mockApiError", () => {
  it("returns WiseEffApiError with code, message, details, and mock requestId", () => {
    const error = mockApiError("CONFLICT", "Candidate base is stale", { candidateId: "cand-1" });

    expect(error).toBeInstanceOf(WiseEffApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("Candidate base is stale");
    expect(error.details).toEqual({ candidateId: "cand-1" });
    expect(error.requestId).toBe("mock");
  });
});
