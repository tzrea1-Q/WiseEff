import type { ContractJsonValue } from "../../../parameter-catalog-contract/index";
import type { CatalogReleaseDefinitionDocument } from "../../../catalog-kernel/compiler/types";
import { CATALOG_CAPABILITY_ALLOW_LIST, validateSupportedDefinitionContent } from "../../builder/capabilities";
import { MAX_DEFINITION_UNIT_CHARS, type SupportedDefinitionContent, type SupportedValueSchema } from "../../builder/types";
import { diagnostic, type Definition, type Field, type ImportDiagnostic, type Subject } from "./types";

const ALLOWED_FIELDS = new Set(["操作", "类型", "类型说明", "单位", "最小值", "最大值", "最少项数", "最多项数", "示例", "简述"]);

/** Build supported definition content and locate field validation errors. */
export function buildContent(section: Subject, definition: Definition, current?: CatalogReleaseDefinitionDocument["content"]["revision"]): {
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
      problem(field.name, "暂不支持该字段；如需说明，请写入定义正文。", field.line);
      continue;
    }
    const values = fields.get(field.name) ?? [];
    if (values.length && field.name !== "示例") problem(field.name, "字段不可重复。", field.line);
    values.push(field);
    fields.set(field.name, values);
  }
  const first = (field: string) => fields.get(field)?.[0];
  const operation = first("操作");
  if (operation && operation.value !== "新建" && operation.value !== "修订") problem("操作", "操作须为新建或修订。", operation.line);
  let currentItem: Record<string, unknown> = current ? structuredClone(current.valueSchema) as Record<string, unknown> : {};
  let currentDepth = 0;
  const currentArrays: Record<string, unknown>[] = [];
  while (currentItem.type === "array" && currentItem.items && typeof currentItem.items === "object") {
    currentArrays.push(currentItem);
    currentDepth += 1;
    currentItem = currentItem.items as Record<string, unknown>;
  }
  const currentType = current ? `${"array<".repeat(currentDepth)}${currentItem.type ?? "mixed"}${">".repeat(currentDepth)}` : "";
  const type = first("类型")?.value ?? currentType;
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
  if (itemType === "mixed" && !(description?.value ?? (typeof currentItem.description === "string" ? currentItem.description : "")).trim()) {
    problem("类型说明", "mixed 必须填写类型说明。", description?.line ?? first("类型")?.line ?? definition.line);
  } else if (itemType !== "mixed" && description) {
    problem("类型说明", "类型说明仅适用于 mixed。", description.line);
  }
  if (current && depth < currentDepth && currentArrays.slice(depth).some((array) =>
    Object.keys(array).some((key) => key !== "type" && key !== "items"))) {
    problem("类型", "更改数组嵌套层数可能丢失现有约束，请使用定义管理入口。", first("类型")!.line);
  }
  let valueSchema: Record<string, unknown> = current ? currentItem
    : itemType === "mixed" ? { description: description?.value ?? "" } : { type: itemType };
  for (let i = Math.min(depth, maxDepth + 1) - 1; i >= 0; i -= 1) {
    valueSchema = { ...(currentArrays[i] ?? { type: "array" }), items: valueSchema };
  }
  let itemSchema = valueSchema;
  while (itemSchema.type === "array" && itemSchema.items && typeof itemSchema.items === "object") itemSchema = itemSchema.items as Record<string, unknown>;
  if (current && first("类型")) {
    if (itemType === "mixed") delete itemSchema.type;
    else itemSchema.type = itemType;
  }
  if (description && itemType === "mixed") itemSchema.description = description.value;
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
    documentation: definition.documentationLine === undefined && current ? current.documentation : definition.documentation,
    ...((first("简述") || current?.description != null) ? { description: first("简述")?.value ?? current?.description } : {}),
    ...((first("单位") || current?.unit != null) ? { unit: first("单位")?.value ?? current?.unit } : {}),
    valueSchema: valueSchema as SupportedValueSchema,
    ...(examples.length ? { examples } : current?.examples != null && !fields.has("示例") ? { examples: current.examples } : {}),
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
