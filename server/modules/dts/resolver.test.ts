import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDts } from "./parser";
import { resolveDts } from "./resolver";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../parameter-files/__fixtures__/dts-teaching-sample.dts",
);

describe("resolveDts", () => {
  it("merges repeated &label overlays into one logical node (#26)", () => {
    const doc = parseDts(`
&demo_multi_ref {
	prop_a = <0>;
};
&demo_multi_ref {
	prop_b = <1>;
	sub_node {
		param = <0>;
	};
};
`);
    const resolved = resolveDts(doc);
    const nodes = resolved.nodes.filter((n) => n.nodePath === "demo_multi_ref" || n.nodePath.startsWith("demo_multi_ref/"));
    const root = resolved.nodes.find((n) => n.nodePath === "demo_multi_ref");
    expect(root).toBeDefined();
    expect(root!.properties.map((p) => p.name).sort()).toEqual(["prop_a", "prop_b"]);
    expect(resolved.nodes.some((n) => n.nodePath === "demo_multi_ref/sub_node")).toBe(true);
    expect(nodes.filter((n) => n.nodePath === "demo_multi_ref")).toHaveLength(1);
  });

  it("merges inline label:name with later &label into one node (#27)", () => {
    const doc = parseDts(`
&demo_label_parent {
	my_batt:batt_cell {
		voltage = <4200>;
	};
};
&my_batt {
	temp_th = <450>;
};
`);
    const resolved = resolveDts(doc);
    const batt = resolved.nodes.find((n) => n.nodePath === "demo_label_parent/batt_cell");
    expect(batt).toBeDefined();
    expect(batt!.labels).toContain("my_batt");
    expect(batt!.name).toBe("batt_cell");
    expect(batt!.properties.map((p) => p.name).sort()).toEqual(["temp_th", "voltage"]);
    expect(resolved.nodes.filter((n) => n.labels.includes("my_batt"))).toHaveLength(1);
  });

  it("keeps @0/@1 and @77/@75 as distinct nodePaths", () => {
    const sample = readFileSync(fixturePath, "utf8");
    const resolved = resolveDts(parseDts(sample));
    const paths = resolved.nodes.map((n) => n.nodePath);
    expect(paths).toContain("demo_multi_instance/battery_checker@0");
    expect(paths).toContain("demo_multi_instance/battery_checker@1");
    expect(paths).toContain("demo_same_compat_multi/bypass_chip@77");
    expect(paths).toContain("demo_same_compat_multi/bypass_chip@75");
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("collects phandle refs from phandle-list properties", () => {
    const doc = parseDts(`
&demo_phandle_list {
	matchable = <&demo_ic_a &demo_ic_b>;
};
`);
    const resolved = resolveDts(doc);
    const node = resolved.nodes.find((n) => n.nodePath === "demo_phandle_list");
    expect(node).toBeDefined();
    const refs = node!.phandleRefs.filter((r) => r.fromProperty === "matchable");
    expect(refs.map((r) => r.targetLabel).sort()).toEqual(["demo_ic_a", "demo_ic_b"]);
  });

  it("builds addressed nested paths including unit addresses", () => {
    const sample = readFileSync(fixturePath, "utf8");
    const resolved = resolveDts(parseDts(sample));
    expect(resolved.nodes.some((n) => n.nodePath === "amba/i2c@XXXX0000/chip@6E")).toBe(true);
    expect(resolved.nodes.some((n) => n.nodePath === "amba/i2c@XXXX0000/chip@6E/sub_module")).toBe(true);
  });
});
