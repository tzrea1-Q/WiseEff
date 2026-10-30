import { describe, expect, it } from "vitest";

import { firstAcmePredecessor } from "../builder/predecessorHarness";
import { planMarkdownImport } from "./markdownImport";

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
      expect.objectContaining({ message: "仅支持 integer、number、string、boolean。", line: 5 }),
    ]);
  });

  it("reports located format, unsupported field and type errors together", () => {
    const plan = planMarkdownImport(document.replace("| 类型 | integer |", "| 类型 | array<string> |\n| 默认值 | 1 |").replace("| 类型 | string |", "| 类型 string |"), "bad.md", firstAcmePredecessor().first);
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
    expect(planMarkdownImport(many, "d.md", snapshot).changeSet).toBeNull();
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
});
