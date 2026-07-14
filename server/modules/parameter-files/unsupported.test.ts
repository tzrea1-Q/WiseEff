import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectUnsupportedDtsConstructs } from "./unsupported";

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "dts-teaching-sample.dts");
const sample = readFileSync(fixturePath, "utf8");

describe("detectUnsupportedDtsConstructs", () => {
  it("only flags /include/ after structured parsing support (P1)", () => {
    const findings = detectUnsupportedDtsConstructs(sample);
    expect(findings.map((f) => f.code)).toEqual(["include"]);
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

  it("returns structured warning with message and sample", () => {
    const findings = detectUnsupportedDtsConstructs(sample);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "include",
      message: expect.any(String),
      sample: expect.any(String),
    });
    expect(findings[0].sample.length).toBeGreaterThan(0);
  });
});
