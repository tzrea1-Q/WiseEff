import { describe, expect, it } from "vitest";
import { isStructuralPropertyKey, paginateItems } from "./moduleProvenance";

describe("moduleProvenance", () => {
  it("marks hash-prefixed property keys as structural", () => {
    expect(isStructuralPropertyKey("#address-cells")).toBe(true);
    expect(isStructuralPropertyKey("#gpio-cells")).toBe(true);
    expect(isStructuralPropertyKey("gpio_int")).toBe(false);
  });

  it("paginates with independent page arithmetic", () => {
    const items = Array.from({ length: 30 }, (_, index) => index + 1);
    expect(paginateItems(items, 1, 25)).toEqual({
      pageItems: items.slice(0, 25),
      page: 1,
      pageSize: 25,
      total: 30,
      totalPages: 2
    });
    expect(paginateItems(items, 2, 25).pageItems).toEqual([26, 27, 28, 29, 30]);
  });
});
