import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { generateDebugOverlay } from "./debugOverlay";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function u32Cell(raw: string) {
  return {
    kind: "cells" as const,
    bits: 32 as const,
    groups: [[{ kind: "integer" as const, raw, value: String(Number(raw)) }]]
  };
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
});
