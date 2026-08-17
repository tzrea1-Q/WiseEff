import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateDebugOverlay, groupDebugOverlayTargets } from "./debugOverlay";
import { parseDtsValue } from "../dts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function u32Cell(raw: string) {
  return {
    kind: "cells" as const,
    bits: 32 as const,
    groups: [[{ kind: "integer" as const, raw, value: String(Number(raw.startsWith("0x") ? Number(raw) : raw)) }]]
  };
}

function cells(raw: string) {
  return parseDtsValue("cells", raw).value;
}

function strings(raw: string) {
  return parseDtsValue("strings", raw).value;
}

describe("generateDebugOverlay", () => {
  it("emits a numbered fragment addressing the node by absolute target path", async () => {
    const expected = await readFile(join(fixtureDir, "single-u32-decimal.overlay.dts"), "utf8");

    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "watchdog_time", value: u32Cell("6000") }]
      }
    ]);

    expect(overlay).toBe(expected);
  });

  it("renders a hexadecimal debug value through the DTS value renderer", async () => {
    const expected = await readFile(join(fixtureDir, "single-u32-hex.overlay.dts"), "utf8");

    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "vout_ovp_mv", value: u32Cell("0x1770") }]
      }
    ]);

    expect(overlay).toBe(expected);
  });

  it("never addresses the node by label reference", () => {
    const overlay = generateDebugOverlay([
      { nodePath: "/hisi_bci_battery", properties: [{ name: "capacity", value: u32Cell("4000") }] }
    ]);

    expect(overlay).not.toMatch(/^&/m);
    expect(overlay).toContain('target-path = "/hisi_bci_battery";');
  });

  it("refuses a target that is not an absolute device-tree path", () => {
    expect(() =>
      generateDebugOverlay([
        { nodePath: "amba/i2c@FDF5E000", properties: [{ name: "hold-time", value: u32Cell("1") }] }
      ])
    ).toThrow(/absolute device-tree path/);
  });

  it("refuses an empty target list rather than emitting an overlay that changes nothing", () => {
    expect(() => generateDebugOverlay([])).toThrow(/at least one target/);
  });

  it("groups multiple properties on the same node into one fragment and emits one fragment per node", async () => {
    const expected = await readFile(join(fixtureDir, "multi-node.overlay.dts"), "utf8");
    const targets = groupDebugOverlayTargets([
      { nodePath: "/amba/i2c@FDF5E000/sc8562@6E", propertyKey: "watchdog_time", value: u32Cell("7000") },
      { nodePath: "/amba/i2c@FDF5E000/sc8562@6E", propertyKey: "vout_ovp_mv", value: u32Cell("0x1770") },
      { nodePath: "/amba/uart@FDF02000", propertyKey: "current-speed", value: u32Cell("115200") }
    ]);

    expect(targets).toHaveLength(2);
    expect(targets[0]?.properties).toHaveLength(2);
    expect(generateDebugOverlay(targets)).toBe(expected);
  });

  it("renders a multi-cell u32 array through the DTS value renderer", async () => {
    const expected = await readFile(join(fixtureDir, "u32-array.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "sense_r_config", value: cells("<100 200 300>") }]
      }
    ]);
    expect(overlay).toBe(expected);
  });

  it("renders a string list through the DTS value renderer", async () => {
    const expected = await readFile(join(fixtureDir, "string-list.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "compatible", value: strings('"sc8562", "sc8562-v2"') }]
      }
    ]);
    expect(overlay).toBe(expected);
  });

  it("renders a boolean as a present-only property, not an empty assignment", async () => {
    const expected = await readFile(join(fixtureDir, "boolean.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "keep-power", value: { kind: "boolean", present: true } }]
      }
    ]);
    expect(overlay).toBe(expected);
    expect(overlay).not.toContain("keep-power =");
  });

  it("renders an empty property as a present-only property", async () => {
    const expected = await readFile(join(fixtureDir, "empty-property.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "ranges", value: { kind: "empty" } }]
      }
    ]);
    expect(overlay).toBe(expected);
  });

  it("renders a bare phandle list without inventing GPIO cells", async () => {
    const expected = await readFile(join(fixtureDir, "bare-phandle.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "interrupt-parent", value: cells("<&gic>") }]
      }
    ]);
    expect(overlay).toBe(expected);
  });

  it("renders a mixed string+cell value without coercing to cells", async () => {
    const expected = await readFile(join(fixtureDir, "mixed.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "aux-map", value: parseDtsValue("aux-map", '"aux", <1 0>').value }]
      }
    ]);
    expect(overlay).toBe(expected);
  });

  it("renders explicit property deletion as /delete-property/", async () => {
    const expected = await readFile(join(fixtureDir, "delete-property.overlay.dts"), "utf8");
    const overlay = generateDebugOverlay([
      {
        nodePath: "/amba/i2c@FDF5E000/sc8562@6E",
        properties: [{ name: "watchdog_time", value: { kind: "empty" }, deleteProperty: true }]
      }
    ]);
    expect(overlay).toBe(expected);
  });
});
