import { describe, expect, it } from "vitest";
import { z } from "zod";

import { WiseEffApiError } from "./apiClient";
import { parseContractDto } from "./parseContractDto";

describe("parseContractDto", () => {
  const schema = z.object({ id: z.string() });

  it("returns the parsed value when the payload matches", () => {
    expect(parseContractDto(schema, { id: "a", extra: 1 }, "TestSchema")).toEqual({ id: "a" });
  });

  it("throws WiseEffApiError with the existing envelope on drift", () => {
    try {
      parseContractDto(schema, { id: 1 }, "TestSchema");
      throw new Error("expected contract-drift error");
    } catch (error) {
      expect(error).toBeInstanceOf(WiseEffApiError);
      const apiError = error as WiseEffApiError;
      expect(apiError.code).toBe("INTERNAL_ERROR");
      expect(apiError.details.reason).toBe("contract-drift");
      expect(apiError.details.schemaName).toBe("TestSchema");
    }
  });
});
