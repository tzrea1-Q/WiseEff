import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDts } from "./parser";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../parameter-files/__fixtures__/dts-teaching-sample.dts",
);

describe("parseDts", () => {
  it("parses node forms: name@addr, label:name, &label, and root /", () => {
    const doc = parseDts(`
/dts-v1/;
/ {
	board_id = <0>;
};
lab:chip@6E {
	reg = <0x6e>;
};
&demo_integer {
	single_value = <42>;
};
`);
    expect(doc.directives.map((d) => d.name)).toContain("/dts-v1/");
    const root = doc.topLevel.find((n) => n.isOverlayRoot);
    expect(root).toMatchObject({ kind: "node", name: "/", isOverlayRoot: true });
    const chip = doc.topLevel.find((n) => n.name === "chip");
    expect(chip).toMatchObject({
      kind: "node",
      name: "chip",
      unitAddress: "6E",
      labels: ["lab"],
    });
    const overlay = doc.topLevel.find((n) => n.refTarget === "demo_integer");
    expect(overlay).toMatchObject({
      kind: "node",
      refTarget: "demo_integer",
      name: "",
    });
  });

  it("parses integer, multi-line matrix, string-list, /bits/, phandle, multi-group, bool, empty", () => {
    const doc = parseDts(`
&demo {
	single = <42>;
	matrix = <
		16 100
		6 15>;
	strings = "a", "b";
	bytes = /bits/ 8 <0x19 0x01>;
	ph = <&gpio 29 0>;
	groups = <1 2>,<3 4>;
	okay;
	ranges;
};
`);
    const node = doc.topLevel[0];
    expect(node.kind).toBe("node");
    const props = Object.fromEntries(
      node.children.filter((c) => c.kind === "property").map((p) => [p.name, p]),
    );
    expect(props.single.rawText).toContain("<42>");
    expect(props.matrix.rawText).toContain("16");
    expect(props.strings.rawText).toContain('"a"');
    expect(props.bytes.rawText).toContain("/bits/");
    expect(props.ph.rawText).toContain("&gpio");
    expect(props.groups.rawText).toContain(",");
    expect(props.okay).toMatchObject({ name: "okay", rawText: "" });
    expect(props.ranges).toMatchObject({ name: "ranges", rawText: "" });
    for (const p of Object.values(props)) {
      expect(p.span.end).toBeGreaterThan(p.span.start);
    }
  });

  it("parses /dts-v1/ /plugin/ and marks /include/ unsupported without expanding", () => {
    const doc = parseDts(`/dts-v1/;
/plugin/;
/include/ "pin.dtsi"
/ { a = <1>; };
`);
    expect(doc.directives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "/dts-v1/", unsupported: false }),
        expect.objectContaining({ name: "/plugin/", unsupported: false }),
        expect.objectContaining({
          name: "/include/",
          arg: "pin.dtsi",
          unsupported: true,
        }),
      ]),
    );
    expect(doc.topLevel).toHaveLength(1);
    expect(doc.source).toContain('/include/ "pin.dtsi"');
  });

  it("parses the teaching fixture into a document with spans and top-level nodes", () => {
    const sample = readFileSync(fixturePath, "utf8");
    const doc = parseDts(sample);
    expect(doc.source).toBe(sample);
    expect(doc.directives.some((d) => d.name === "/include/" && d.unsupported)).toBe(true);
    expect(doc.topLevel.length).toBeGreaterThan(5);
    const addressed = doc.topLevel.flatMap(function collect(n): typeof doc.topLevel {
      const nested = n.children.filter((c) => c.kind === "node");
      return [n, ...nested.flatMap(collect)];
    });
    expect(addressed.some((n) => n.name === "chip" && n.unitAddress === "6E")).toBe(true);
    expect(addressed.some((n) => n.refTarget === "demo_multi_ref")).toBe(true);
  });
});
