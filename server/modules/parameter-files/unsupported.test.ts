import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectUnsupportedDtsConstructs } from "./unsupported";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

describe("detectUnsupportedDtsConstructs", () => {
  it("does not flag /include/ (config-set resolver owns include diagnostics)", () => {
    const findings = detectUnsupportedDtsConstructs(sample);
    expect(findings).toEqual([]);
  });

  it("returns empty when include is absent even with @address and &label", () => {
    const findings = detectUnsupportedDtsConstructs(`&demo {
	chip@6E {
		reg = <0x6e>;
		okay;
	};
};
`);
    expect(findings).toEqual([]);
  });

  it("returns empty for teaching sample that still contains /include/", () => {
    expect(sample).toContain("/include/");
    expect(detectUnsupportedDtsConstructs(sample)).toEqual([]);
  });
});
