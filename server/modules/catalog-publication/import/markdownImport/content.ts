import type { ContractJsonValue } from "../../../parameter-catalog-contract/index";
import { CATALOG_CAPABILITY_ALLOW_LIST, validateSupportedDefinitionContent } from "../../builder/capabilities";
import { MAX_DEFINITION_UNIT_CHARS, type SupportedDefinitionContent, type SupportedValueSchema } from "../../builder/types";
import { diagnostic, type Definition, type Field, type ImportDiagnostic, type Subject } from "./types";

const ALLOWED_FIELDS = new Set(["类型", "类型说明", "单位", "最小值", "最大值", "最少项数", "最多项数", "示例", "简述"]);

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
      problem(field.name, "定义契约不支持此字段，不能通过导入添加或强制执行。", field.line);
      continue;
    }
    const values = fields.get(field.name) ?? [];
    if (values.length && field.name !== "示例") problem(field.name, "字段不可重复。", field.line);
    values.push(field);
    fields.set(field.name, values);
  }
  const first = (field: string) => fields.get(field)?.[0];
  const type = first("类型")?.value ?? "";
  let itemType = type;
  let depth = 0;
  const maxDepth = CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxArraySchemaDepth ?? 0;
  while (depth <= maxDepth && itemType.startsWith("array<") && itemType.endsWith(">")) {
    depth += 1;
    itemType = itemType.slice(6, -1);
  }
  if (!["integer", "number", "string", "boolean", "null", "mixed"].includes(itemType) || depth > maxDepth) {
    problem("类型", `类型须为 integer、number、string、boolean、null、mixed 或 array<…>；数组最多嵌套 ${maxDepth} 层。`, first("类型")?.line ?? definition.line);
  }
  const description = first("类型说明");
  if (itemType === "mixed" && !description?.value.trim()) {
    problem("类型说明", "mixed 必须填写类型说明。", description?.line ?? first("类型")?.line ?? definition.line);
  } else if (itemType !== "mixed" && description) {
    problem("类型说明", "类型说明仅适用于 mixed。", description.line);
  }
  const itemSchema: Record<string, unknown> = itemType === "mixed"
    ? { description: description?.value ?? "" } : { type: itemType };
  let valueSchema = itemSchema;
  for (let i = 0; i < Math.min(depth, maxDepth + 1); i += 1) valueSchema = { type: "array", items: valueSchema };
  for (const [field, property] of [["最小值", "minimum"], ["最大值", "maximum"]] as const) {
    const row = first(field);
    if (!row) continue;
    const value = Number(row.value);
    if (!row.value || !Number.isFinite(value) || (itemType !== "integer" && itemType !== "number")) {
      problem(field, "数值边界无效。", row.line);
    } else {
      itemSchema[property] = value;
    }
  }
  for (const [field, property] of [["最少项数", "minItems"], ["最多项数", "maxItems"]] as const) {
    const row = first(field);
    if (!row) continue;
    const value = Number(row.value);
    if (!depth || !row.value || !Number.isInteger(value) || value < 0
      || value > (CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxItemsBound ?? 0) || Object.is(value, -0)) {
      problem(field, `项数须为 0 至 ${CATALOG_CAPABILITY_ALLOW_LIST.budgets.maxItemsBound} 的整数，且仅适用于数组。`, row.line);
    } else valueSchema[property] = value;
  }
  if (typeof valueSchema.minItems === "number" && typeof valueSchema.maxItems === "number"
    && valueSchema.minItems > valueSchema.maxItems) {
    problem("最少项数", "最少项数不能大于最多项数。", first("最少项数")!.line);
  }
  const examples: ContractJsonValue[] = [];
  const exampleLines: number[] = [];
  for (const row of fields.get("示例") ?? []) {
    try {
      examples.push(type === "string" ? row.value : JSON.parse(row.value, (_key, value: unknown) => {
        if (typeof value === "number" && !Number.isFinite(value)) throw new Error("invalid number");
        return value;
      }) as ContractJsonValue);
    } catch {
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
  if (fields.get("示例") && fields.get("示例")!.length > 8) {
    problem("示例", "最多填写 8 个示例。", fields.get("示例")![8]!.line);
  }
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
          : path.endsWith(".maximum") ? "最大值"
          : path.endsWith(".minItems") ? "最少项数"
          : path.endsWith(".maxItems") ? "最多项数"
          : key === "valueSchema" && itemType === "mixed" && description ? "类型说明" : labels[key];
        const line = label === "正文" ? definition.documentationLine ?? definition.line
          : first(label)?.line ?? definition.line;
        const message = key === "unit" ? `单位须为 1 至 ${MAX_DEFINITION_UNIT_CHARS} 个字符，且不能包含控制字符。`
          : "内容不符合目录支持的格式或长度限制。";
        if (!diagnostics.some((item) => item.field === label && item.line === line)) problem(label, message, line);
      }
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
