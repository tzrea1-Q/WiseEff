import { describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";
import { assertNonStructuralPropertyKey } from "./structuralPropertyGuard";

describe("assertNonStructuralPropertyKey", () => {
  it("rejects structural DTS property keys with a 400 ApiError", () => {
    for (const propertyKey of ["status", "compatible", "reg", "#address-cells", "STATUS"]) {
      expect(() => assertNonStructuralPropertyKey(propertyKey)).toThrow(ApiError);
      try {
        assertNonStructuralPropertyKey(propertyKey);
      } catch (error) {
        expect(error).toMatchObject({
          code: "VALIDATION_FAILED",
          status: 400,
        });
      }
    }
  });

  it("allows semantic property keys", () => {
    expect(() => assertNonStructuralPropertyKey("gpio_int")).not.toThrow();
    expect(() => assertNonStructuralPropertyKey("vout_ovp_mv")).not.toThrow();
  });
});
