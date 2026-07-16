import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";
import { parseDtsImportSource } from "./importDtsParse";

const fixtureNoInclude = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/dts-import-sample-no-include.dts"
);

describe("parseDtsImportSource", () => {
  it("keeps @address nodePaths distinct and returns sourceNodePath identity rows", () => {
    const content = readFileSync(fixtureNoInclude, "utf8");
    const result = parseDtsImportSource({ sourceName: "board.dts", content });

    expect(result.format).toBe("dts-full");
    const paths = result.rows.map((row) => row.sourceNodePath);
    expect(paths).toContain("demo_multi_instance/battery_checker@0/status");
    expect(paths).toContain("demo_multi_instance/battery_checker@1/status");
    expect(paths).toContain("demo_same_compat_multi/bypass_chip@77/status");
    expect(paths).toContain("demo_same_compat_multi/bypass_chip@75/status");
    expect(new Set(paths).size).toBe(paths.length);

    const chipCompat = result.rows.find((row) => row.sourceNodePath === "amba/i2c@XXXX0000/chip@6E/compatible");
    expect(chipCompat).toMatchObject({
      name: "compatible",
      module: "amba/i2c@XXXX0000/chip@6E",
      valueType: "string-list"
    });
  });

  it("exposes boolean properties with visible true values", () => {
    const content = `
/dts-v1/;
&demo_bool {
	weak_source_sleep_enabled;
	charge_done_sleep_enabled;
};
`;
    const result = parseDtsImportSource({ sourceName: "bool.dts", content });
    const weak = result.rows.find((row) => row.name === "weak_source_sleep_enabled");
    expect(weak).toMatchObject({
      module: "demo_bool",
      sourceNodePath: "demo_bool/weak_source_sleep_enabled",
      valueType: "bool",
      rawText: "",
      normalizedValue: "true"
    });
  });

  it("returns hex rawText and normalizedValue dual fields", () => {
    const content = `
/dts-v1/;
&demo_integer {
	hex_value = <0x220022>;
};
`;
    const result = parseDtsImportSource({ sourceName: "hex.dts", content });
    const hex = result.rows.find((row) => row.name === "hex_value");
    expect(hex).toBeDefined();
    expect(hex!.rawText).toMatch(/0x220022/i);
    expect(hex!.normalizedValue).toBe("<0x220022>");
    expect(hex!.valueType).toBe("u32-array");
  });

  it("does not reject /include/ (config-set resolver owns include diagnostics)", () => {
    const content = `/dts-v1/;\n/include/ "pin.dtsi"\n/ { board_id = <0>; };\n`;
    expect(() => parseDtsImportSource({ sourceName: "board.dts", content })).not.toThrow();
  });
});
