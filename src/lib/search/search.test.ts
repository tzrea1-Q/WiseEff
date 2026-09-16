import { describe, expect, it } from "vitest";
import { FIELD_WEIGHT, type SearchProfile } from "./types";
import { compactSearchText, normalizeSearchText } from "./normalize";
import { createSearchIndex, filterItems, formatMatchHint, searchItems } from "./filter";
import { filterHierarchicalList, filterTree } from "./tree";

type ParameterLike = {
  name: string;
  description?: string | null;
  explanation?: string | null;
  module?: string | null;
  path?: string | null;
  notes?: string | null;
};

const profile: SearchProfile<ParameterLike> = {
  fields: [
    { name: "name", weight: FIELD_WEIGHT.identity, getValues: (item) => [item.name] },
    { name: "description", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.description] },
    { name: "explanation", weight: FIELD_WEIGHT.explanation, getValues: (item) => [item.explanation] },
    { name: "module", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.module] },
    { name: "path", weight: FIELD_WEIGHT.attribution, getValues: (item) => [item.path] }
  ]
};

const rows: ParameterLike[] = [
  {
    name: "cpu_current_limit",
    description: "低温场景限制 CPU 峰值放电电流",
    explanation: "board power rail",
    module: "power / thermal",
    path: "/soc/cpu@0"
  },
  {
    name: "battery_temp_target_c",
    description: "Target battery pack temperature",
    module: "battery"
  },
  {
    name: "gpio_int",
    description: "中断引脚",
    module: "充电"
  }
];

describe("search normalize", () => {
  it("applies NFKC, lower case, trim, and whitespace collapse", () => {
    expect(normalizeSearchText("  CPU\t Current  ")).toBe("cpu current");
    expect(compactSearchText("current_limit")).toBe("currentlimit");
    expect(compactSearchText("current-limit")).toBe("currentlimit");
  });
});

describe("searchItems", () => {
  it("matches exact name case-insensitively", () => {
    expect(filterItems(rows, "CPU_CURRENT_LIMIT", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
  });

  it("matches description-only queries", () => {
    expect(filterItems(rows, "低温", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
  });

  it("matches module-only queries", () => {
    expect(filterItems(rows, "battery", profile).map((row) => row.name)).toEqual(["battery_temp_target_c"]);
  });

  it("matches path-only queries", () => {
    expect(filterItems(rows, "cpu@0", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
  });

  it("matches underscore and hyphen identifier compact forms", () => {
    expect(filterItems(rows, "currentlimit", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
    expect(filterItems([{ name: "fast-charge-limit" }], "fastchargelimit", profile).map((row) => row.name)).toEqual([
      "fast-charge-limit"
    ]);
  });

  it("matches Chinese description and mixed tokens across fields", () => {
    expect(filterItems(rows, "低温", profile)).toHaveLength(1);
    expect(filterItems(rows, "cpu 电流", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
  });

  it("requires every query token (AND) and allows tokens to hit different fields", () => {
    expect(filterItems(rows, "cpu thermal", profile).map((row) => row.name)).toEqual(["cpu_current_limit"]);
    expect(filterItems(rows, "cpu missing", profile)).toHaveLength(0);
  });

  it("rejects unrelated queries", () => {
    expect(filterItems(rows, "motor", profile)).toHaveLength(0);
  });

  it("does not treat English prose as an identifier subsequence", () => {
    expect(
      filterItems(
        [{ name: "gpio_int", description: "Limits fast charge current to keep thermal load controlled." }],
        "motor",
        profile
      )
    ).toHaveLength(0);
  });

  it("returns all items for an empty query in original order", () => {
    expect(filterItems(rows, "   ", profile).map((row) => row.name)).toEqual([
      "cpu_current_limit",
      "battery_temp_target_c",
      "gpio_int"
    ]);
  });

  it("keeps original order when scores tie and rank is off", () => {
    const items = [{ name: "alpha_limit" }, { name: "beta_limit" }, { name: "gamma_limit" }];
    expect(filterItems(items, "limit", profile).map((row) => row.name)).toEqual(["alpha_limit", "beta_limit", "gamma_limit"]);
  });

  it("ranks identity matches above explanation matches when requested", () => {
    const items: ParameterLike[] = [
      { name: "other", description: "thermal budget" },
      { name: "thermal_limit", description: "unrelated" }
    ];
    const ranked = searchItems(items, "thermal", profile, { rank: true });
    expect(ranked.map((hit) => hit.item.name)).toEqual(["thermal_limit", "other"]);
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("does not reorder when the page already sorted the rows", () => {
    const items: ParameterLike[] = [
      { name: "other", description: "thermal budget" },
      { name: "thermal_limit", description: "unrelated" }
    ];
    expect(filterItems(items, "thermal", profile).map((row) => row.name)).toEqual(["other", "thermal_limit"]);
  });

  it("ignores null and undefined fields", () => {
    const items: ParameterLike[] = [{ name: "keep", description: null, explanation: undefined, module: "" }];
    expect(filterItems(items, "keep", profile)).toHaveLength(1);
    expect(filterItems(items, "ghost", profile)).toHaveLength(0);
  });

  it("deduplicates repeated field values", () => {
    const duplicateProfile: SearchProfile<{ name: string }> = {
      fields: [{ name: "name", weight: 5, getValues: (item) => [item.name, item.name] }]
    };
    const hits = searchItems([{ name: "gpio_int" }], "gpio", duplicateProfile);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.matchedFields).toHaveLength(1);
  });

  it("exposes matched field metadata for hidden-field hints", () => {
    const hits = searchItems(rows, "低温", profile);
    expect(hits[0]?.matchedFields.some((match) => match.field === "description")).toBe(true);
    expect(formatMatchHint(hits[0]?.matchedFields ?? [], ["name", "module"])).toBe("命中：描述");
    expect(formatMatchHint(hits[0]?.matchedFields ?? [], ["name", "description"])).toBeNull();
  });

  it("filters a few thousand rows without rebuilding documents per query", () => {
    const items = Array.from({ length: 2500 }, (_, index) => ({
      name: `param_${index}`,
      description: index === 42 ? "低温场景限制 CPU 峰值放电电流" : `row ${index}`
    }));
    const index = createSearchIndex(items, profile);
    const started = performance.now();
    expect(index.search("低温").map((hit) => hit.item.name)).toEqual(["param_42"]);
    expect(index.search("param_100")[0]?.item.name).toBe("param_100");
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("tree search", () => {
  type Node = { id: string; label: string; children: Node[] };
  const treeProfile: SearchProfile<Node> = {
    fields: [{ name: "label", weight: FIELD_WEIGHT.identity, getValues: (node) => [node.label] }]
  };

  const tree: Node[] = [
    {
      id: "power",
      label: "电源",
      children: [
        { id: "battery", label: "电池", children: [{ id: "health", label: "电池健康", children: [] }] },
        { id: "charging", label: "充电", children: [] }
      ]
    },
    { id: "thermal", label: "热管理", children: [] }
  ];

  it("keeps ancestors of a matching child and drops unrelated siblings", () => {
    const result = filterTree(tree, "健康", {
      profile: treeProfile,
      getChildren: (node) => node.children,
      withChildren: (node, children) => ({ ...node, children }),
      getId: (node) => node.id
    });

    expect(result.nodes.map((node) => node.id)).toEqual(["power"]);
    expect(result.nodes[0]?.children.map((node) => node.id)).toEqual(["battery"]);
    expect(result.nodes[0]?.children[0]?.children.map((node) => node.id)).toEqual(["health"]);
    expect(result.expandedIds).toEqual(["battery", "power"]);
  });

  it("returns the original tree for an empty query without forcing expansion", () => {
    const result = filterTree(tree, "", {
      profile: treeProfile,
      getChildren: (node) => node.children,
      withChildren: (node, children) => ({ ...node, children }),
      getId: (node) => node.id
    });
    expect(result.nodes).toEqual(tree);
    expect(result.expandedIds).toEqual([]);
  });
});

describe("hierarchical path list", () => {
  type PathNode = { path: string };
  const pathProfile: SearchProfile<PathNode> = {
    fields: [{ name: "path", weight: FIELD_WEIGHT.identity, getValues: (node) => [node.path] }]
  };
  const nodes = [{ path: "/soc" }, { path: "/soc/i2c@1" }, { path: "/soc/i2c@1/chip@6E" }, { path: "/soc/uart@2" }];

  it("keeps matching descendants and their ancestor paths only", () => {
    const filtered = filterHierarchicalList(nodes, "chip@6E", pathProfile, (node) => node.path);
    expect(filtered.map((node) => node.path)).toEqual(["/soc", "/soc/i2c@1", "/soc/i2c@1/chip@6E"]);
  });
});
