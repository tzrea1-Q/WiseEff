import { describe, expect, it } from "vitest";

import { firstAcmePredecessor } from "../builder/predecessorHarness";
import { planMarkdownImport } from "./markdownImport";
import { DEFINITION_IMPORT_TEMPLATE } from "../../../../src/features/parameter-catalog-governance/definitionImportTemplate";
import { buildCreateDefinitionChangeSet, emptyPublicationDraft } from "../../../../src/features/parameter-catalog-governance/publicationState";

const document = `# Driver \`acme,power\`

## \`import-one\` 输入电流
| 字段 | 值 |
| --- | --- |
| 类型 | integer |
| 单位 | mA |
| 最小值 | 0 |
| 示例 | 3 |
| 简述 | 输入电流限制 |

说明正文。

## \`import-two\` 名称
| 字段 | 值 |
| --- | --- |
| 类型 | string |
`;

describe("Definition import planner", () => {
  it("creates subjects with their definitions and checks driver facts", () => {
    const snapshot = firstAcmePredecessor().first;
    const fresh = document.replace("acme,power", "acme,new").replace("\n\n##", "\nnature: physical-device · cardinality: multiple\n\n##");
    const plan = planMarkdownImport(fresh, "new.md", snapshot);
    expect(plan.changeSet).toEqual([expect.objectContaining({ op: "create-subject-with-definitions",
      kind: "driver", canonicalKey: "driver:acme,new", selector: { kind: "driver-compatible", value: "acme,new" },
      nature: "physical-device", cardinality: "multiple", definitions: expect.arrayContaining([
        expect.objectContaining({ propertyKey: "import-one" }), expect.objectContaining({ propertyKey: "import-two" }),
      ]) })]);
    expect(planMarkdownImport(document.replace("acme,power", "acme,new"), "new.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(document.replace("# Driver `acme,power`", "# Driver `acme,power`\nnature: physical-device · cardinality: multiple"), "d.md", snapshot).changeSet).not.toBeNull();
    expect(planMarkdownImport(document.replace("# Driver `acme,power`", "# Driver `acme,power`\nnature: physical-device · cardinality: singleton-per-project"), "d.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(document.replace("# Driver `acme,power`", "# Driver `acme,power`\nnature: logical-service · cardinality: multiple"), "d.md", snapshot).changeSet).toBeNull();
    for (const kind of ["NodeType", "ConfigurationSchema"]) {
      expect(planMarkdownImport(document.replace("Driver `acme,power`", `${kind} \`new-subject\``), "d.md", snapshot).changeSet?.[0]).toMatchObject({ op: "create-subject-with-definitions", definitions: expect.any(Array) });
    }
  });

  it("combines repeated new-subject sections and rejects inconsistent facts or duplicate keys", () => {
    const snapshot = firstAcmePredecessor().first;
    const section = (key: string, nature = "physical-device") => `# Driver \`acme,new\`\nnature: ${nature} · cardinality: multiple\n## \`${key}\` 参数\n| 字段 | 值 |\n| --- | --- |\n| 类型 | string |\n`;
    expect(planMarkdownImport(section("a") + section("b"), "d.md", snapshot).changeSet).toMatchObject([
      { op: "create-subject-with-definitions", definitions: [{ propertyKey: "a" }, { propertyKey: "b" }] },
    ]);
    expect(planMarkdownImport(section("a") + section("b", "logical-service"), "d.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(section("a") + section("a").replace("`acme,new`", "`acme,new`  "), "d.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(section("a").replace("Driver `acme,new`", "NodeType `acme,power`"), "d.md", snapshot).changeSet).toBeNull();
  });
  it("skips identical heads and only creates new entries in a repeated document", () => {
    const existing = "# Driver `acme,power`\n## `iin_max` Input current limit\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | mA |\n| 最小值 | 0 |\n\nMaximum accepted input current.";
    const snapshot = firstAcmePredecessor().first;
    const allSkip = planMarkdownImport(existing, "d.md", snapshot);
    expect(allSkip.entries.map((entry) => entry.outcome)).toEqual(["skip"]);
    expect(allSkip.changeSet).toBeNull();
    expect(allSkip.noChange).toBe(true);
    const mixed = planMarkdownImport(`${existing}\n${document.slice(document.indexOf("## `import-two`"))}`, "d.md", snapshot);
    expect(mixed.entries.map((entry) => entry.outcome)).toEqual(["skip", "create"]);
    expect(mixed.changeSet).toHaveLength(1);
    expect(mixed.changeSet?.[0]).toMatchObject({ propertyKey: "import-two" });
  });

  it("reports changed and retired heads as conflicts alongside located errors", () => {
    const snapshot = structuredClone(firstAcmePredecessor().first);
    const existing = snapshot.documents.find((item) => item.kind === "definition" && item.content.propertyKey === "iin_max");
    if (!existing || existing.kind !== "definition") throw new Error("fixture missing");
    const changed = "# Driver `acme,power`\n## `iin_max` Changed\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n";
    const input = `${changed}\n## \`invalid\` 参数\n| 字段 | 值 |\n| --- | --- |\n| 类型 | unknown |\n| 默认值 | 1 |\n${changed.slice(changed.indexOf("##"))}`;
    const plan = planMarkdownImport(input, "d.md", snapshot);
    expect(plan.entries.map((entry) => entry.outcome)).toEqual(["conflict", "error", "error"]);
    expect(plan.entries[0]?.diagnostics[0]).toMatchObject({ subjectHeading: "# Driver `acme,power`", definitionHeading: "## `iin_max` Changed", field: "属性键", line: 2 });
    expect(plan.entries[1]?.diagnostics.map((item) => item.field)).toEqual(expect.arrayContaining(["类型", "默认值"]));
    expect(plan.entries[2]?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ field: "属性键", message: expect.stringContaining("重复") })]));
    expect(plan.entries[2]?.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining("不同内容") })]));
    expect(plan.changeSet).toBeNull();
    expect(plan.noChange).toBe(false);
    const retiredSnapshot = { ...snapshot, documents: snapshot.documents.map((item) => item === existing
      ? { ...existing, content: { ...existing.content, revision: { ...existing.content.revision, lifecycle: "retired" as const } } } : item) };
    const retired = planMarkdownImport(changed, "d.md", retiredSnapshot);
    expect(retired.entries[0]).toMatchObject({ outcome: "conflict", diagnostics: [expect.objectContaining({ message: expect.stringContaining("恢复") })] });
  });

  it.each([
    { description: "other" }, { unit: "V" }, { examples: [3] },
    { valueSchema: { type: "integer", minimum: 1 } }, { documentation: "Other" }, { displayName: "Other" },
    { lifecycle: "deprecated" as const },
  ])("treats every changed head content or non-active lifecycle as conflict: %j", (changed) => {
    const snapshot = firstAcmePredecessor().first;
    const modified = { ...snapshot, documents: snapshot.documents.map((item) => item.kind === "definition" && item.content.propertyKey === "iin_max"
      ? { ...item, content: { ...item.content, revision: { ...item.content.revision, ...changed } } } : item) };
    const input = "# Driver `acme,power`\n## `iin_max` Input current limit\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | mA |\n| 最小值 | 0 |\n\nMaximum accepted input current.";
    expect(planMarkdownImport(input, "d.md", modified).entries[0]?.outcome).toBe("conflict");
  });

  it("plans a deterministic batch against the snapshot", () => {
    const snapshot = firstAcmePredecessor().first;
    const plan = planMarkdownImport(document, "definitions.md", snapshot);
    expect(plan).toEqual(planMarkdownImport(document, "definitions.md", snapshot));
    expect(plan.source.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(plan.entries.map((entry) => entry.outcome)).toEqual(["create", "create"]);
    expect(plan.entries[0]).toMatchObject({ selector: "acme,power", propertyKey: "import-one", displayName: "输入电流" });
    expect(plan.changeSet).toEqual([
      { op: "create-definition", subjectId: "csub_acme_power", propertyKey: "import-one", content: {
        displayName: "输入电流", documentation: "说明正文。", description: "输入电流限制", unit: "mA",
        valueSchema: { type: "integer", minimum: 0 }, examples: [3],
      } },
      { op: "create-definition", subjectId: "csub_acme_power", propertyKey: "import-two", content: {
        displayName: "名称", documentation: "", valueSchema: { type: "string" },
      } },
    ]);
  });

  it("orders diagnostics by line without repeating a generic error for a specific field error", () => {
    const input = "# Driver `missing,device`\n## `bad` 名称\n| 字段 | 值 |\n| --- | --- |\n"
      + "| 类型 | enum |\n| 未知 | 值 |\n| 单位 | mA |\n| 单位 | V |";
    const diagnostics = planMarkdownImport(input, "bad.md", firstAcmePredecessor().first).entries[0]!.diagnostics;
    expect(diagnostics.map((item) => item.line)).toEqual([1, 5, 6, 8]);
    expect(diagnostics.filter((item) => item.field === "类型")).toEqual([
      expect.objectContaining({ field: "类型", line: 5 }),
    ]);
  });

  it("reports located format, unsupported field and type errors together", () => {
    const plan = planMarkdownImport(document.replace("| 类型 | integer |", "| 类型 | array<invalid> |\n| 默认值 | 1 |").replace("| 类型 | string |", "| 类型 string |"), "bad.md", firstAcmePredecessor().first);
    expect(plan.changeSet).toBeNull();
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries.every((entry) => entry.outcome === "error")).toBe(true);
    expect(plan.entries[0]?.diagnostics.map((item) => item.field)).toEqual(expect.arrayContaining(["类型", "默认值"]));
    expect(plan.entries[0]?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "类型", line: 6 }),
      expect.objectContaining({ field: "默认值", line: 7 }),
    ]));
    expect(plan.entries[1]?.diagnostics.some((item) => item.subjectHeading && item.definitionHeading)).toBe(true);
  });

  it("locates subject, heading, duplicate and content diagnostics at their source lines", () => {
    const input = "# Driver `missing,device`\n## `bad` 名称\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 最小值 | nope |\n| 单位 | mA |\n| 单位 | V |";
    const plan = planMarkdownImport(input, "bad.md", firstAcmePredecessor().first);
    expect(plan.entries[0]?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "主体", line: 1 }),
      expect.objectContaining({ field: "最小值", line: 6 }),
      expect.objectContaining({ field: "单位", line: 8 }),
    ]));
  });

  it("locates a later example that violates its numeric bound", () => {
    const input = "# Driver `acme,power`\n## `example` 名称\n| 字段 | 值 |\n| --- | --- |\n"
      + "| 类型 | integer |\n| 最小值 | 0 |\n| 示例 | 1 |\n| 示例 | -2 |";
    const plan = planMarkdownImport(input, "bad.md", firstAcmePredecessor().first);
    expect(plan.entries[0]?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "示例", line: 8 }),
    ]));
  });

  it("rejects duplicate keys, subject mismatch, extra text and batches over the budget", () => {
    const snapshot = firstAcmePredecessor().first;
    expect(planMarkdownImport(document + document.slice(document.indexOf("##")), "d.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(document.replace("# Driver `acme,power`", "# Driver `acme,power`\nnature: logical-service · cardinality: multiple"), "d.md", snapshot).changeSet).toBeNull();
    expect(planMarkdownImport(`意外内容\n${document}`, "d.md", snapshot).changeSet).toBeNull();
    const many = `# Driver \`acme,power\`\n${Array.from({ length: 129 }, (_, i) => `## \`import-${i}\` 名称\n| 字段 | 值 |\n| --- | --- |\n| 类型 | string |`).join("\n")}`;
    const oversized = planMarkdownImport(many, "d.md", snapshot);
    expect(oversized.changeSet).toBeNull();
    expect(oversized.entries[128]?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "文档", message: expect.stringContaining("按主体拆分") }),
    ]));
  });

  it("counts definitions, not document-level diagnostics, against the 128-definition limit", () => {
    const definitions = Array.from({ length: 128 }, (_, i) =>
      `## \`import-${i}\` 名称\n| 字段 | 值 |\n| --- | --- |\n| 类型 | string |`).join("\n");
    const plan = planMarkdownImport(`额外内容\n# Driver \`acme,power\`\n${definitions}`, "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet).toBeNull();
    expect(plan.entries.flatMap((entry) => entry.diagnostics).some((item) => item.message.includes("128 条"))).toBe(false);
  });

  it("keeps Markdown tables and fenced headings in documentation after the field table", () => {
    const input = document.replace("说明正文。", "说明正文。\n\n| 项目 | 说明 |\n| --- | --- |\n| A | B |\n\n```text\n## 不是定义\n```");
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    expect(plan.entries).toHaveLength(2);
    expect(plan.changeSet?.[0]).toMatchObject({ content: { documentation: "说明正文。\n\n| 项目 | 说明 |\n| --- | --- |\n| A | B |\n\n```text\n## 不是定义\n```" } });
  });

  it("requires the field table immediately after the definition heading", () => {
    const plan = planMarkdownImport(document.replace("## `import-one` 输入电流\n", "## `import-one` 输入电流\n正文先出现。\n"), "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet).toBeNull();
    expect(plan.entries[0]?.diagnostics.some((item) => item.field === "字段表")).toBe(true);
  });

  it("resolves an active subject alias and detects duplicates across aliases", () => {
    const snapshot = firstAcmePredecessor().first;
    expect(planMarkdownImport(document.replace("acme,power`", "acme,power-v1`"), "d.md", snapshot).changeSet).toHaveLength(2);
    expect(planMarkdownImport(`${document}\n${document.replace("acme,power`", "acme,power-v1`")}`, "d.md", snapshot).changeSet).toBeNull();
  });

  it("preserves meaningful indentation in the documentation body", () => {
    const plan = planMarkdownImport(document.replace("说明正文。", "    缩进代码"), "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet?.[0]).toMatchObject({ content: { documentation: "    缩进代码" } });
  });

  it("reports independent content budget errors for one entry together", () => {
    const input = document.replace("输入电流", "名".repeat(129)).replace("| 单位 | mA |", `| 单位 | ${"u".repeat(33)} |`).replace("| 简述 | 输入电流限制 |", `| 简述 | ${"述".repeat(513)} |`);
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet).toBeNull();
    expect(plan.entries[0]?.diagnostics.map((item) => item.field)).toEqual(expect.arrayContaining(["显示名", "单位", "简述"]));
  });

  it.each([
    { type: "integer", example: "2", expected: 2 },
    { type: "number", example: "2.5", expected: 2.5 },
    { type: "string", example: "启用", expected: "启用" },
    { type: "boolean", example: "true", expected: true },
  ])("imports $type scalar examples", ({ type, example, expected }) => {
    const input = `# Driver \`acme,power\`\n## \`scalar\` 参数\n| 字段 | 值 |\n| --- | --- |\n| 类型 | ${type} |\n| 示例 | ${example} |`;
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet?.[0]).toMatchObject({ content: { valueSchema: { type }, examples: [expected] } });
  });

  it("plans the downloadable template with all supported types", () => {
    const first = firstAcmePredecessor().first;
    const snapshot = { ...first, documents: first.documents.map((item) => item.kind === "subject" && item.content.id === "csub_acme_power"
      ? { ...item, content: { ...item.content, selector: { ...item.content.selector, value: "vendor,existing-driver" } } } : item) };
    const plan = planMarkdownImport(DEFINITION_IMPORT_TEMPLATE, "template.md", snapshot);
    expect(plan.entries.every((entry) => entry.outcome === "create")).toBe(true);
    expect(plan.changeSet).not.toBeNull();
  });

  it("builds nested arrays, mixed and null schemas and parses their examples", () => {
    const input = `# Driver \`acme,power\`
## \`nested\` 嵌套数组
| 字段 | 值 |
| --- | --- |
| 类型 | array<array<integer>> |
| 最少项数 | 1 |
| 最多项数 | 2 |
| 示例 | [[1,2]] |
## \`mixed\` 混合
| 字段 | 值 |
| --- | --- |
| 类型 | mixed |
| 类型说明 | mixed |
| 示例 | {"x":1} |
## \`empty\` 空值
| 字段 | 值 |
| --- | --- |
| 类型 | null |
| 示例 | null |`;
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    expect(plan.changeSet).toMatchObject([
      { content: { valueSchema: { type: "array", minItems: 1, maxItems: 2, items: { type: "array", items: { type: "integer" } } }, examples: [[[1, 2]]] } },
      { content: { valueSchema: { description: "mixed" }, examples: [{ x: 1 }] } },
      { content: { valueSchema: { type: "null" }, examples: [null] } },
    ]);
  });

  it("reports content limits and unsupported fields at their rows", () => {
    const input = `# Driver \`acme,power\`
## \`bad\` ${"名".repeat(129)}
| 字段 | 值 |
| --- | --- |
| 类型 | array<array<array<array<array<string>>>>> |
| 最少项数 | 4097 |
| 最多项数 | -1 |
| 单位 | ${"u".repeat(33)} |
| 简述 | ${"述".repeat(513)} |
| 默认值 | 1 |
| 枚举 | a |
| 正则 | .* |
${Array.from({ length: 9 }, () => "| 示例 | [] |").join("\n")}

${"文".repeat(8193)}
## \`mixed-bad\` 混合
| 字段 | 值 |
| --- | --- |
| 类型 | mixed |`;
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    const diagnostics = plan.entries[0]!.diagnostics;
    expect(plan.changeSet).toBeNull();
    expect(diagnostics.map((item) => item.field)).toEqual(expect.arrayContaining([
      "显示名", "正文", "类型", "最少项数", "最多项数", "单位", "简述", "默认值", "枚举", "正则", "示例",
    ]));
    expect(diagnostics.find((item) => item.field === "单位")?.message).toBe("单位须为 1 至 32 个字符，且不能包含控制字符。");
    expect(diagnostics.find((item) => item.field === "默认值")?.message).toContain("契约");
    expect(plan.entries[1]!.diagnostics.map((item) => item.field)).toContain("类型说明");
  });

  it.each(["-1", "4097", "1.5"])("rejects invalid array item count %s", (bound) => {
    const input = `# Driver \`acme,power\`\n## \`array\` 数组\n| 字段 | 值 |\n| --- | --- |\n| 类型 | array<string> |\n| 最多项数 | ${bound} |`;
    expect(planMarkdownImport(input, "d.md", firstAcmePredecessor().first).entries[0]!.diagnostics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "最多项数" })]));
  });

  it.each(["Hz", "%", "u".repeat(32)])("accepts Builder-supported unit %s", (unit) => {
    const input = `# Driver \`acme,power\`\n## \`unit\` 单位\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | ${unit} |`;
    expect(planMarkdownImport(input, "d.md", firstAcmePredecessor().first).changeSet?.[0])
      .toMatchObject({ content: { unit } });
  });

  it.each(["", "u\u007f"])("reports the Builder rule for an invalid unit", (unit) => {
    const input = `# Driver \`acme,power\`\n## \`unit\` 单位\n| 字段 | 值 |\n| --- | --- |\n| 类型 | integer |\n| 单位 | ${unit} |`;
    expect(planMarkdownImport(input, "d.md", firstAcmePredecessor().first).entries[0]!.diagnostics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "单位", line: 6, message: "单位须为 1 至 32 个字符，且不能包含控制字符。" })]));
  });

  it("rejects non-finite JSON numbers inside mixed examples", () => {
    const input = `# Driver \`acme,power\`\n## \`mixed-number\` 混合\n| 字段 | 值 |\n| --- | --- |\n| 类型 | mixed |\n| 类型说明 | mixed |\n| 示例 | {"value":1e999} |`;
    expect(planMarkdownImport(input, "d.md", firstAcmePredecessor().first).entries[0]!.diagnostics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ field: "示例" })]));
  });

  it("accepts the depth, item-count and example limits and nested mixed", () => {
    const input = `# Driver \`acme,power\`\n## \`limits\` 上限\n| 字段 | 值 |\n| --- | --- |\n| 类型 | array<array<array<array<mixed>>>> |\n| 类型说明 | mixed |\n| 最少项数 | 0 |\n| 最多项数 | 4096 |\n${Array.from({ length: 8 }, () => "| 示例 | [] |").join("\n")}`;
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    expect(plan.entries[0]?.outcome).toBe("create");
    expect(plan.changeSet?.[0]).toMatchObject({ content: { valueSchema: { type: "array", minItems: 0, maxItems: 4096,
      items: { type: "array", items: { type: "array", items: { type: "array", items: { description: "mixed" } } } } }, examples: Array.from({ length: 8 }, () => []) } });
  });

  it.each([["array<string>", "string-list"], ["mixed", "mixed"], ["null", "empty"]] as const)(
    "matches the single-definition editor schema for %s", (type, valueType) => {
      const input = `# Driver \`acme,power\`\n## \`comparison\` 名称\n| 字段 | 值 |\n| --- | --- |\n| 类型 | ${type} |${type === "mixed" ? "\n| 类型说明 | mixed |" : ""}`;
      const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
      const editor = buildCreateDefinitionChangeSet({ ...emptyPublicationDraft(), mode: "create-definition", subjectId: "csub_acme_power", propertyKey: "comparison", displayName: "名称", valueType });
      const change = editor[0];
      if (!change || change.op !== "create-definition") throw new Error("expected definition change");
      expect(plan.changeSet?.[0]).toMatchObject({ content: { valueSchema: change.content.valueSchema } });
    },
  );

  it("matches the editor's nonnegative integer array schema", () => {
    const input = `# Driver \`acme,power\`\n## \`comparison\` 名称\n| 字段 | 值 |\n| --- | --- |\n| 类型 | array<integer> |\n| 最小值 | 0 |`;
    const plan = planMarkdownImport(input, "d.md", firstAcmePredecessor().first);
    const change = buildCreateDefinitionChangeSet({ ...emptyPublicationDraft(), mode: "create-definition", subjectId: "csub_acme_power", propertyKey: "comparison", displayName: "名称", valueType: "u32-array" })[0];
    if (!change || change.op !== "create-definition") throw new Error("expected definition change");
    expect(plan.changeSet?.[0]).toMatchObject({ content: { valueSchema: change.content.valueSchema } });
  });
});
