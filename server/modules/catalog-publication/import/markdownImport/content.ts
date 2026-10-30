import type { ContractJsonValue } from "../../../parameter-catalog-contract/index";
import { validateSupportedDefinitionContent } from "../../builder/capabilities";
import type { SupportedDefinitionContent, SupportedValueSchema } from "../../builder/types";
import { diagnostic, type Definition, type Field, type ImportDiagnostic, type Subject } from "./types";

const ALLOWED_FIELDS = new Set(["类型", "单位", "最小值", "最大值", "示例", "简述"]);

export function buildContent(section: Subject, definition: Definition): {
  content: SupportedDefinitionContent | null;
  diagnostics: ImportDiagnostic[];
} {
  const diagnostics: ImportDiagnostic[] = [];
  const fields = new Map<string, Field[]>();
  const problem = (field: string, message: string, line: number) => {
    diagnostics.push(diagnostic(section, definition, field, message, line));
  };
  for (const field of definition.fields) {
    if (!ALLOWED_FIELDS.has(field.name)) {
      problem(field.name, "不支持此字段。", field.line);
      continue;
    }
    const values = fields.get(field.name) ?? [];
    if (values.length && field.name !== "示例") problem(field.name, "字段不可重复。", field.line);
    values.push(field);
    fields.set(field.name, values);
  }
  const first = (field: string) => fields.get(field)?.[0];
  const type = first("类型")?.value;
  if (type !== "integer" && type !== "number" && type !== "string" && type !== "boolean") {
    problem("类型", "仅支持 integer、number、string、boolean。", first("类型")?.line ?? definition.line);
  }
  const valueSchema: Record<string, string | number> = { type: type ?? "" };
  for (const [field, property] of [["最小值", "minimum"], ["最大值", "maximum"]] as const) {
    const row = first(field);
    if (!row) continue;
    const value = Number(row.value);
    if (!row.value || !Number.isFinite(value) || (type !== "integer" && type !== "number")) {
      problem(field, "数值边界无效。", row.line);
    } else {
      valueSchema[property] = value;
    }
  }
  const examples: ContractJsonValue[] = [];
  const exampleLines: number[] = [];
  for (const row of fields.get("示例") ?? []) {
    if (type === "string") examples.push(row.value);
    else if (type === "boolean" && (row.value === "true" || row.value === "false")) {
      examples.push(row.value === "true");
    } else if ((type === "integer" || type === "number") && row.value !== ""
      && Number.isFinite(Number(row.value))) {
      examples.push(Number(row.value));
    } else {
      problem("示例", "示例与类型不匹配。", row.line);
      continue;
    }
    exampleLines.push(row.line);
  }
  const content = {
    displayName: definition.displayName,
    documentation: definition.documentation,
    ...(first("简述") ? { description: first("简述")?.value } : {}),
    ...(first("单位") ? { unit: first("单位")?.value } : {}),
    valueSchema: valueSchema as SupportedValueSchema,
    ...(examples.length ? { examples } : {}),
  };
  const checked = validateSupportedDefinitionContent(content, "content");
  if (!checked.ok) {
    const baseline = { displayName: "名称", documentation: "", valueSchema: { type: "string" } };
    const keys = ["displayName", "documentation", "description", "unit", "valueSchema"] as const;
    const labels = { displayName: "显示名", documentation: "正文", description: "简述", unit: "单位", valueSchema: "类型" };
    let schemaValid = false;
    for (const key of keys) {
      const result = validateSupportedDefinitionContent({ ...baseline, [key]: content[key] }, "content");
      if (key === "valueSchema") schemaValid = result.ok;
      if (!result.ok && content[key] !== undefined) {
        const path = result.error.kind === "unsupported-catalog-capability" ? result.error.path : "";
        const label = path.endsWith(".minimum") ? "最小值"
          : path.endsWith(".maximum") ? "最大值" : labels[key];
        const line = label === "正文" ? definition.documentationLine ?? definition.line
          : first(label)?.line ?? definition.line;
        const message = key === "unit" ? "单位须为 1 至 32 个字符，且不能包含控制字符。"
          : "内容不符合目录支持的格式或长度限制。";
        if (!diagnostics.some((item) => item.field === label && item.line === line)) problem(label, message, line);
      }
    }
    if (schemaValid && examples.length > 8) {
      problem("示例", "示例不符合类型、边界或数量限制。", exampleLines[8] ?? definition.line);
    }
    if (schemaValid) {
      for (const [index, example] of examples.entries()) {
        const result = validateSupportedDefinitionContent({ ...baseline, valueSchema, examples: [example] }, "content");
        if (!result.ok) {
          problem("示例", "示例不符合类型、边界或数量限制。", exampleLines[index] ?? definition.line);
        }
      }
    }
  }
  return { content: checked.ok ? checked.value : null, diagnostics };
}
