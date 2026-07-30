import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  isParameterSurfaceRow,
  isScaffoldingLocator,
  isStructuralPropertyKey,
  listStructuralPropertyKeys,
  STRUCTURAL_PROPERTY_KEYS
} from "./parameterSurface";

describe("parameterSurface", () => {
  it("treats address-cells and the enablement/status union as structural", () => {
    expect(isStructuralPropertyKey("#address-cells")).toBe(true);
    expect(isStructuralPropertyKey("status")).toBe(true);
    expect(isStructuralPropertyKey("STATUS")).toBe(true);
    expect(isStructuralPropertyKey("phandle")).toBe(true);
    expect(isStructuralPropertyKey("device_type")).toBe(true);
    expect(isStructuralPropertyKey("r_pcb")).toBe(false);
  });

  it("exports one structural-key list for gate exclusion and surface predicates", () => {
    expect(listStructuralPropertyKeys()).toEqual([...STRUCTURAL_PROPERTY_KEYS]);
    for (const key of listStructuralPropertyKeys()) {
      expect(isStructuralPropertyKey(key)).toBe(true);
    }
    expect(listStructuralPropertyKeys()).toContain("status");
    expect(listStructuralPropertyKeys()).toContain("phandle");
    expect(listStructuralPropertyKeys()).toContain("device_type");
  });

  it("keeps STRUCTURAL_PROPERTY_KEYS aligned with migration 0081 CHECK literals", () => {
    const migration = readFileSync(
      join(process.cwd(), "server/migrations/0081_remove_structural_parameter_specs.sql"),
      "utf8"
    );
    for (const key of STRUCTURAL_PROPERTY_KEYS) {
      expect(migration).toContain(`'${key}'`);
    }
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
