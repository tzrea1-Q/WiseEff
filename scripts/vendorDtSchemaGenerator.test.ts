/**
 * Real dtc + dt-validate positive/negative fixtures for generated linux-bindings.
 * Skips only when toolchain binaries are missing (reported, not counted as pass).
 */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { generateLinuxDtBindings } from "./generate-linux-dt-bindings";
import { propertyToDtSchema, renderBindingFromVendorSpec } from "./lib/vendorDtSchemaGenerator";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bindingsDir = join(root, "schemas/dts/linux-bindings");

function toolchainAvailable(): boolean {
  for (const cmd of ["dtc", "dt-validate"]) {
    const probe = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) return false;
  }
  return true;
}

function compileAndValidate(dts: string): { status: number; stderr: string; stdout: string; reported: boolean } {
  const dir = mkdtempSync(join(tmpdir(), "wiseeff-dt-schema-"));
  try {
    const dtsPath = join(dir, "test.dts");
    const dtbPath = join(dir, "test.dtb");
    writeFileSync(dtsPath, dts, "utf8");
    const dtc = spawnSync("dtc", ["-I", "dts", "-O", "dtb", "-o", dtbPath, dtsPath], {
      encoding: "utf8"
    });
    if (dtc.status !== 0) {
      return { status: dtc.status ?? 1, stderr: dtc.stderr, stdout: dtc.stdout, reported: true };
    }
    const validate = spawnSync("dt-validate", ["-s", bindingsDir, "-c", dtbPath], {
      encoding: "utf8"
    });
    const combined = `${validate.stderr}\n${validate.stdout}`.trim();
    const reported = (validate.status !== 0 && validate.status !== null) || Boolean(combined);
    return {
      status: reported ? 1 : 0,
      stderr: combined,
      stdout: validate.stdout,
      reported
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const gpioBase = `
/dts-v1/;
/ {
  #address-cells = <1>;
  #size-cells = <0>;
  gpio13: gpio13 {
    compatible = "wiseeff,gpio13";
    gpio-controller;
    #gpio-cells = <2>;
  };
`;

describe("vendorDtSchemaGenerator unit", () => {
  it("maps gpio_int to phandle-array without blanket additionalProperties", () => {
    const binding = renderBindingFromVendorSpec("sc8562", {
      compatible: ["sc8562"],
      properties: {
        compatible: { valueShape: "string-list", constraints: {} },
        gpio_int: {
          valueShape: "mixed",
          exampleValue: "<&gpio13 29 0>",
          constraints: { cells: 3 }
        },
        status: { valueShape: "string-list", constraints: {} }
      }
    });
    expect(binding.body).toContain("phandle-array");
    expect(binding.body).toContain("additionalProperties: false");
    expect(binding.body).not.toContain("additionalProperties: true");
    expect(binding.body).not.toMatch(/required:[\s\S]*status/);
  });

  it("treats #gpio-cells as scalar uint32", () => {
    const converted = propertyToDtSchema("#gpio-cells", {
      valueShape: "u32-array",
      exampleValue: "<2>",
      constraints: { minItems: 1, maxItems: 1 }
    });
    expect(converted.schema).toMatchObject({
      allOf: [
        { $ref: "/schemas/types.yaml#/definitions/uint32" },
        { const: 2 }
      ]
    });
  });

  it("hard-blocks unknown value shapes", () => {
    const converted = propertyToDtSchema("mystery", {
      valueShape: "exotic-shape",
      constraints: {}
    });
    expect(converted.schema).toBeNull();
    expect(converted.blockers[0]).toMatch(/schema-blocker/);
  });

  it("generation is deterministic under SOURCE_DATE_EPOCH", () => {
    process.env.SOURCE_DATE_EPOCH = "0";
    const a = generateLinuxDtBindings();
    const b = generateLinuxDtBindings();
    expect(a.contentHash).toBe(b.contentHash);
  });
});

describe.skipIf(!toolchainAvailable())("vendor schema real dt-validate fixtures", () => {
  it(
    "positive: valid sc8562 node passes dt-validate",
    () => {
      const result = compileAndValidate(`${gpioBase}
  i2c@0 {
    #address-cells = <1>;
    #size-cells = <0>;
    sc8562@6e {
      compatible = "sc8562";
      reg = <0x6e>;
      gpio_int = <&gpio13 29 0>;
      status = "okay";
    };
  };
};
`);
      expect(result.status, result.stderr).toBe(0);
    },
    30_000,
  );

  it(
    "negative: undeclared vendor property fails",
    () => {
      const result = compileAndValidate(`${gpioBase}
  i2c@0 {
    #address-cells = <1>;
    #size-cells = <0>;
    sc8562@6e {
      compatible = "sc8562";
      reg = <0x6e>;
      gpio_int = <&gpio13 29 0>;
      rogue_prop = <1>;
      status = "okay";
    };
  };
};
`);
      expect(result.status).not.toBe(0);
      expect(result.stderr.toLowerCase()).toMatch(/rogue_prop|additional|unevaluated|false/);
    },
    30_000,
  );

  it(
    "negative: gpio_int wrong cell count fails",
    () => {
      const result = compileAndValidate(`${gpioBase}
  i2c@0 {
    #address-cells = <1>;
    #size-cells = <0>;
    sc8562@6e {
      compatible = "sc8562";
      reg = <0x6e>;
      gpio_int = <&gpio13 29>;
      status = "okay";
    };
  };
};
`);
      expect(result.status).not.toBe(0);
    },
    30_000,
  );

  it(
    "negative: string where cells expected fails",
    () => {
      const result = compileAndValidate(`${gpioBase}
  i2c@0 {
    #address-cells = <1>;
    #size-cells = <0>;
    sc8562@6e {
      compatible = "sc8562";
      reg = <0x6e>;
      gpio_int = "not-a-phandle";
      status = "okay";
    };
  };
};
`);
      expect(result.status).not.toBe(0);
    },
    30_000,
  );

  it(
    "negative: boolean property with value fails",
    () => {
      const result = compileAndValidate(`${gpioBase}
  gpio13_bad: gpio_bad {
    compatible = "wiseeff,gpio13";
    gpio-controller = <1>;
    #gpio-cells = <2>;
  };
};
`);
      expect(result.status).not.toBe(0);
    },
    30_000,
  );
});
