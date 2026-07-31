import { describe, expect, it } from "vitest";

import { isSyncableVendorProperty } from "./sync-vendor-property-docs";

describe("syncVendorPropertyDocs", () => {
  it("excludes structural DTS properties from parameter definitions", () => {
    expect(isSyncableVendorProperty({ propertyKey: "status" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "compatible" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "#address-cells" })).toBe(false);
    expect(isSyncableVendorProperty({ propertyKey: "gpio_int" })).toBe(true);
  });
});
