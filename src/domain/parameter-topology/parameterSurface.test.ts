import { describe, expect, it } from "vitest";

import {
  isParameterSurfaceRow,
  isScaffoldingLocator,
  isStructuralPropertyKey
} from "./parameterSurface";

describe("parameterSurface", () => {
  it("treats address-cells as structural", () => {
    expect(isStructuralPropertyKey("#address-cells")).toBe(true);
    expect(isStructuralPropertyKey("r_pcb")).toBe(false);
  });

  it("treats bare bus containers as scaffolding locators", () => {
    expect(isScaffoldingLocator("/spmi")).toBe(true);
    expect(isScaffoldingLocator("/spmi/pmic@0")).toBe(true);
    expect(isScaffoldingLocator("/spmi/pmic@0/hi6xxx_coul")).toBe(false);
    expect(isScaffoldingLocator("/spmi/pmic@0/hi6xxx_coul/batt")).toBe(false);
  });

  it("includes batt business props and excludes scaffolding cells", () => {
    expect(
      isParameterSurfaceRow({
        propertyKey: "r_pcb",
        locator: "/spmi/pmic@0/hi6xxx_coul/batt",
        compatible: null
      })
    ).toBe(true);
    expect(
      isParameterSurfaceRow({
        propertyKey: "#address-cells",
        locator: "/spmi/pmic@0",
        compatible: null
      })
    ).toBe(false);
  });
});
