import { describe, expect, it } from "vitest";
import { paginateItems } from "./moduleProvenance";

describe("moduleProvenance", () => {
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
