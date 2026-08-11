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

  it("asserts every property across every fragment in a multi-node batch", async () => {
    const multiBase = `/dts-v1/;

/ {
	amba: amba {
		i2c@FDF5E000 {
			#address-cells = <1>;
			#size-cells = <0>;

			sc8562@6E {
				compatible = "sc8562";
				watchdog_time = <5000>;
				vout_ovp_mv = <4000>;
			};
		};
		uart@FDF02000 {
			current-speed = <9600>;
		};
	};
};
`;
    const targets = [
      {
        nodePath: NODE_PATH,
        properties: [
          { name: "watchdog_time", value: u32("6000") },
          { name: "vout_ovp_mv", value: u32("5000") }
        ]
      },
      {
        nodePath: "/amba/uart@FDF02000",
        properties: [{ name: "current-speed", value: u32("115200") }]
      }
    ];

    const result = await runDebugOverlayPreflight({
      baseSource: multiBase,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(true);
    expect(result.observedValues).toEqual(
      expect.arrayContaining([
        { nodePath: NODE_PATH, propertyName: "watchdog_time", before: "<5000>", after: "<6000>" },
        { nodePath: NODE_PATH, propertyName: "vout_ovp_mv", before: "<4000>", after: "<5000>" },
        {
          nodePath: "/amba/uart@FDF02000",
          propertyName: "current-speed",
          before: "<9600>",
          after: "<115200>"
        }
      ])
    );
  });

  it("blocks a multi-fragment batch as a whole when one fragment cannot apply", async () => {
    const targets = [
      target(NODE_PATH, "watchdog_time", "6000"),
      target("/amba/uart@MISSING", "current-speed", "115200")
    ];

    const result = await runDebugOverlayPreflight({
      baseSource: BASE_SOURCE,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.ok).toBe(false);
    expect(result.overlayBlob).toBeUndefined();
    expect(result.diagnostics.some((d) => d.code === "target-node-missing")).toBe(true);
  });

  it("asserts a multi-cell array and a string-list property", async () => {
    const shapedBase = `/dts-v1/;

/ {
	amba: amba {
		i2c@FDF5E000 {
			sc8562@6E {
				sense_r_config = <1 2 3>;
				compatible = "sc8562";
			};
		};
	};
};
`;
    const targets = [
      {
        nodePath: NODE_PATH,
        properties: [
          {
            name: "sense_r_config",
            value: {
              kind: "cells" as const,
              bits: 32 as const,
              groups: [
                [
                  { kind: "integer" as const, raw: "10", value: "10" },
                  { kind: "integer" as const, raw: "20", value: "20" },
                  { kind: "integer" as const, raw: "30", value: "30" }
                ]
              ]
            }
          },
          {
            name: "compatible",
            value: { kind: "strings" as const, values: ["sc8562", "sc8562-v2"] }
          }
        ]
      }
    ];

    const result = await runDebugOverlayPreflight({
      baseSource: shapedBase,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.observedValues).toEqual(
      expect.arrayContaining([
        {
          nodePath: NODE_PATH,
          propertyName: "sense_r_config",
          before: "<1 2 3>",
          after: "<10 20 30>"
        },
        {
          nodePath: NODE_PATH,
          propertyName: "compatible",
          before: '"sc8562"',
          after: '"sc8562", "sc8562-v2"'
        }
      ])
    );
  });

  it("passes a GPIO-style phandle cell overlay when the base carries /__symbols__", async () => {
    const gpioBase = `/dts-v1/;

/ {
	gpio13: gpio13 {
	};

	amba: amba {
		i2c@FDF5E000 {
			#address-cells = <1>;
			#size-cells = <0>;

			sc8562@6E {
				compatible = "sc8562";
				gpio_int = <&gpio13 29 0>;
			};
		};
	};
};
`;
    const value = {
      kind: "cells" as const,
      bits: 32 as const,
      groups: [
        [
          { kind: "phandle" as const, label: "gpio13" },
          { kind: "integer" as const, raw: "30", value: "30" },
          { kind: "integer" as const, raw: "0", value: "0" }
        ]
      ]
    };
    const targets = [{ nodePath: NODE_PATH, properties: [{ name: "gpio_int", value }] }];

    const result = await runDebugOverlayPreflight({
      baseSource: gpioBase,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.overlayBlob?.byteLength).toBeGreaterThan(0);
    expect(result.observedValues).toEqual([
      {
        nodePath: NODE_PATH,
        propertyName: "gpio_int",
        before: "<1 29 0>",
        after: "<1 30 0>"
      }
    ]);
  });

  it("passes a /bits/ 8 overlay and equates dtc square-bracket decompile spelling", async () => {
    const bitsBase = `/dts-v1/;

/ {
	amba: amba {
		i2c@FF24E000 {
			mt5788@2B {
				compatible = "mt,mt5788";
				prevfod1_product_list = /bits/ 8 <17>;
			};
		};
	};
};
`;
    const nodePath = "/amba/i2c@FF24E000/mt5788@2B";
    const value = {
      kind: "cells" as const,
      bits: 8 as const,
      groups: [[{ kind: "integer" as const, raw: "34", value: "34" }]]
    };
    const targets = [{ nodePath, properties: [{ name: "prevfod1_product_list", value }] }];

    const result = await runDebugOverlayPreflight({
      baseSource: bitsBase,
      overlaySource: generateDebugOverlay(targets),
      targets
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.overlayBlob?.byteLength).toBeGreaterThan(0);
    expect(result.observedValues).toEqual([
      {
        nodePath,
        propertyName: "prevfod1_product_list",
        before: "17",
        after: "34"
      }
    ]);
  });
});
