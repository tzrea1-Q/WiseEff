import { describe, expect, it } from "vitest";
import {
  isAutoDiscoveredModuleName,
  isStructuralPropertyKey,
  paginateItems
} from "./moduleProvenance";

describe("moduleProvenance", () => {
  it("marks device-tree unit-address names as auto-discovered", () => {
    expect(isAutoDiscoveredModuleName("i2c@FDF5E000")).toBe(true);
    expect(isAutoDiscoveredModuleName("pmic@0")).toBe(true);
    expect(isAutoDiscoveredModuleName("Power")).toBe(false);
    expect(isAutoDiscoveredModuleName("Battery")).toBe(false);
  });

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
