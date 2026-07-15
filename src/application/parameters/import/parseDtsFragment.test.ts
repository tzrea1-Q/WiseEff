import { describe, expect, it } from "vitest";
import { parseDtsFragmentImport } from "./parseDtsFragment";

describe("parseDtsFragmentImport", () => {
  it("parses quoted strings and multiline cell arrays", () => {
    const source = `fast-charge-profile-matrix = "0", "5000", "1500", "40", "entry";
battery-thermal-derate-curve = <
  0 38 3800 4350
  1 42 3200 4320
>;`;

    const rows = parseDtsFragmentImport(source);

    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      name: "fast-charge-profile-matrix",
      module: "",
      currentValue: '"0", "5000", "1500", "40", "entry"',
      recommendedValue: '"0", "5000", "1500", "40", "entry"',
      sourceFormat: "dts-fragment",
      sourceLocation: "fast-charge-profile-matrix"
    });

    expect(rows[1]).toMatchObject({
      name: "battery-thermal-derate-curve",
      module: "",
      currentValue: `<
  0 38 3800 4350
  1 42 3200 4320
>`,
      recommendedValue: `<
  0 38 3800 4350
  1 42 3200 4320
>`,
      sourceFormat: "dts-fragment",
      sourceLocation: "battery-thermal-derate-curve"
    });
  });

  it("does not emit rows from commented-out property assignments", () => {
    const source = `alive = <1>;
/* x = <9>; */
// y = <8>;
z = <3>;`;

    const rows = parseDtsFragmentImport(source);
    const names = rows.map((row) => row.name);

    expect(names).toContain("alive");
    expect(names).toContain("z");
    expect(names).not.toContain("x");
    expect(names).not.toContain("y");
  });
});
