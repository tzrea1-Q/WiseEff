import { describe, expect, it } from "vitest";

import { generateDebugOverlay } from "./debugOverlay";
import { runDebugOverlayPreflight } from "./preflight";

/**
 * These tests drive the real pinned `dtc` / `fdtoverlay` on purpose. The gate exists because of
 * the tools' actual behaviour — in particular that a misspelled property merges silently — so a
 * stub would only re-assert our assumptions. Run `npm run dts:toolchain:bootstrap` if they fail
 * to find the toolchain.
 */

const BASE_SOURCE = `/dts-v1/;

/ {
	amba: amba {
		i2c@FDF5E000 {
			#address-cells = <1>;
			#size-cells = <0>;

			sc8562@6E {
				compatible = "sc8562";
				watchdog_time = <5000>;
			};
		};
	};
};
`;

const NODE_PATH = "/amba/i2c@FDF5E000/sc8562@6E";

function u32(raw: string) {
  return {
    kind: "cells" as const,
    bits: 32 as const,
    groups: [[{ kind: "integer" as const, raw, value: String(Number(raw)) }]]
  };
}

function target(nodePath: string, name: string, raw: string) {
  return { nodePath, properties: [{ name, value: u32(raw) }] };
}

describe("runDebugOverlayPreflight", () => {
  it("passes an overlay that targets an existing node and property, and returns the compiled artifact", async () => {
    const targets = [target(NODE_PATH, "watchdog_time", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.overlayBlob?.byteLength).toBeGreaterThan(0);
    expect(result.steps.map((step) => `${step.step}:${step.outcome}`)).toEqual([
      "compile-base:passed",
      "compile-overlay:passed",
      "dry-run-merge:passed",
      "assert-effect:passed"
    ]);
    expect(result.observedValues).toEqual([
      { nodePath: NODE_PATH, propertyName: "watchdog_time", before: "<5000>", after: "<6000>" }
    ]);
  });

  it("blocks a wrong-case unit address instead of shipping an overlay that cannot apply", async () => {
    const targets = [target("/amba/i2c@fdf5e000/sc8562@6E", "watchdog_time", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(false);
    expect(result.overlayBlob).toBeUndefined();
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("target-node-missing");
    expect(diagnostic?.nodePath).toBe("/amba/i2c@fdf5e000/sc8562@6E");
    expect(diagnostic?.stage).toBe("dry-run-merge");
  });

  it("does not blame the missing symbol table, which fdtoverlay reports for every failure", async () => {
    const targets = [target("/nope", "watchdog_time", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("target-node-missing");
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).not.toContain("__symbols__");
    }
  });

  it("blocks a misspelled property name, which fdtoverlay would otherwise merge silently", async () => {
    const targets = [target(NODE_PATH, "watchdog_tine", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(false);
    expect(result.overlayBlob).toBeUndefined();
    const diagnostic = result.diagnostics[0];
    expect(diagnostic?.code).toBe("property-absent-in-base");
    expect(diagnostic?.propertyName).toBe("watchdog_tine");
    expect(diagnostic?.stage).toBe("assert-effect");
  });

  it("blocks an overlay whose merged value is not the requested debug value", async () => {
    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay([target(NODE_PATH, "watchdog_time", "6000")]),
      targets: [target(NODE_PATH, "watchdog_time", "7000")]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("property-value-mismatch");
  });

  it("reports a broken overlay source as a compile failure with the compiler's own message", async () => {
    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: "/dts-v1/;\n/plugin/;\n\n/ { fragment@0 { target-path = ; }; };\n",
      targets: [target(NODE_PATH, "watchdog_time", "6000")]
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("overlay-compile-failed");
    expect(result.diagnostics[0]?.message.length).toBeGreaterThan(0);
  });

  it("reports an unusable base device tree separately from the overlay", async () => {
    const targets = [target(NODE_PATH, "watchdog_time", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: "/dts-v1/;\n\n/ { broken = ; };\n",
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe("base-compile-failed");
    expect(result.steps[0]).toMatchObject({ step: "compile-base", outcome: "failed" });
  });

  it("records the toolchain versions it actually used as run evidence", async () => {
    const targets = [target(NODE_PATH, "watchdog_time", "6000")];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.toolVersions.dtc).toMatch(/\d+\.\d+\.\d+/);
    expect(result.toolVersions.fdtoverlay).toMatch(/\d+\.\d+\.\d+/);
  });
});
