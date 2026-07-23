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

  it("includes root board_id but excludes scaffolding module name `/` and unknown locators", () => {
    expect(
      isParameterSurfaceRow({
        propertyKey: "board_id",
        locator: "/",
        moduleName: "board"
      })
    ).toBe(true);
    expect(
      isParameterSurfaceRow({
        propertyKey: "board_id",
        locator: "/",
        moduleName: "/"
      })
    ).toBe(false);
    expect(
      isParameterSurfaceRow({
        propertyKey: "orphan_prop",
        locator: null,
        moduleName: "未分类"
      })
    ).toBe(false);
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

  it("excludes provisional scaffolding unclassified modules and scaffolding drivers", () => {
    expect(
      isParameterSurfaceRow({
        propertyKey: "ranges",
        locator: "/amba",
        compatible: "arm,amba-bus",
        moduleName: "未分类 · amba-bus"
      })
    ).toBe(false);
    expect(
      isParameterSurfaceRow({
        propertyKey: "hold-time",
        locator: "/gpio2",
        compatible: "hisilicon,gpio",
        driverModule: "gpio",
        moduleName: "未分类 · gpio"
      })
    ).toBe(false);
    expect(
      isParameterSurfaceRow({
        propertyKey: "gpio_int",
        locator: "/amba/i2c@FF24E000/sc8562@6E",
        compatible: "sc8562",
        driverModule: "sc8562",
        moduleName: "sc8562@6E"
      })
    ).toBe(true);
  });
});
