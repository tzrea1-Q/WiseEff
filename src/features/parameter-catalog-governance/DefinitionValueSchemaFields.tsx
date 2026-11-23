import { SelectControl } from "@/components/common/SelectControl";

import type { PublicationValueSchema } from "./publicationState";

const shapeOptions = [
  { value: "integer", label: "整数" },
  { value: "number", label: "数值" },
  { value: "string", label: "字符串" },
  { value: "boolean", label: "布尔值" },
  { value: "empty", label: "空属性" },
  { value: "array", label: "数组" },
  { value: "mixed", label: "混合类型" },
] as const;

type Shape = (typeof shapeOptions)[number]["value"];
type SchemaDraft = { shape: Shape; lower: string; upper: string; description: string; items?: SchemaDraft };

const maxArrayDepth = 4;
const maxItemCount = 4096;
const maxTypeDescription = 512;

const emptySchemaDraft = (shape: Shape): SchemaDraft => ({ shape, lower: "", upper: "", description: "" });

export function definitionSchemaDraftOf(schema: PublicationValueSchema): SchemaDraft {
  if ("type" in schema) {
    switch (schema.type) {
      case "array":
        return {
          shape: "array",
          lower: schema.minItems?.toString() ?? "",
          upper: schema.maxItems?.toString() ?? "",
          description: schema.description ?? "",
          ...(schema.items ? { items: definitionSchemaDraftOf(schema.items) } : {}),
        };
      case "integer":
      case "number":
        return {
          ...emptySchemaDraft(schema.type),
          lower: schema.minimum?.toString() ?? "",
          upper: schema.maximum?.toString() ?? "",
        };
      case "null":
        return emptySchemaDraft("empty");
      case "string":
      case "boolean":
        return emptySchemaDraft(schema.type);
    }
  }
  return { ...emptySchemaDraft("mixed"), description: "description" in schema ? schema.description ?? "" : "" };
}

const layer = (depth: number) => depth === 0 ? "" : `第 ${depth + 1} 层`;

function parseBound(input: string, label: string, shape: "integer" | "number" | "array") {
  if (!input.trim()) return undefined;
  const value = Number(input);
  if (!Number.isFinite(value) || Object.is(value, -0) || (shape !== "number" && !Number.isInteger(value)) ||
    (shape === "array" && (value < 0 || value > maxItemCount))) {
    throw new Error(shape === "array" ? `${label}须为 0 至 ${maxItemCount} 的整数。` : `${label}须为有效的${shape === "integer" ? "整数" : "数值"}。`);
  }
  return value;
}

export function definitionSchemaOf(draft: SchemaDraft, depth = 0): PublicationValueSchema {
  switch (draft.shape) {
    case "array": {
      const minItems = parseBound(draft.lower, `${layer(depth)}最少项数`, "array");
      const maxItems = parseBound(draft.upper, `${layer(depth)}最多项数`, "array");
      if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) {
        throw new Error(`${layer(depth)}最少项数不能大于最多项数。`);
      }
      return {
        type: "array",
        ...(draft.description.trim() ? { description: draft.description } : {}),
        ...(minItems === undefined ? {} : { minItems }),
        ...(maxItems === undefined ? {} : { maxItems }),
        ...(draft.items ? { items: definitionSchemaOf(draft.items, depth + 1) } : {}),
      };
    }
    case "integer":
    case "number": {
      const minimum = parseBound(draft.lower, `${depth ? "元素" : ""}最小值`, draft.shape);
      const maximum = parseBound(draft.upper, `${depth ? "元素" : ""}最大值`, draft.shape);
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        throw new Error(`${depth ? "元素" : ""}最小值不能大于最大值。`);
      }
      return {
        type: draft.shape,
        ...(minimum === undefined ? {} : { minimum }),
        ...(maximum === undefined ? {} : { maximum }),
      };
    }
    case "mixed":
      if (!draft.description.trim()) throw new Error(`请填写${depth ? "元素" : ""}类型说明。`);
      return { description: draft.description };
    case "empty":
      return { type: "null" };
    case "string":
    case "boolean":
      return { type: draft.shape };
  }
}

export function DefinitionValueSchemaFields({ draft, onChange, disabled, depth = 0 }: {
  draft: SchemaDraft | undefined;
  onChange: (value: SchemaDraft | undefined) => void;
  disabled: boolean;
  depth?: number;
}) {
  const label = depth === 0 ? "取值形状" : depth === 1 ? "数组元素类型" : `第 ${depth} 层数组元素类型`;
  const isArray = draft?.shape === "array";
  const hasBounds = isArray || draft?.shape === "integer" || draft?.shape === "number";
  const boundsLabel = isArray ? layer(depth) : depth ? "元素" : "";
  const descriptionLabel = depth ? "元素类型说明" : "类型说明";
  const options = shapeOptions.filter(option => option.value !== "array" || depth < maxArrayDepth || isArray);
  const update = (patch: Partial<Omit<SchemaDraft, "shape">>) => {
    if (draft) onChange({ ...draft, ...patch });
  };
  const changeShape = (shape: Shape | "unrestricted") => {
    if (shape === "unrestricted") {
      onChange(undefined);
    } else if ((draft?.shape === "integer" || draft?.shape === "number") && (shape === "integer" || shape === "number")) {
      onChange({ ...draft, shape });
    } else {
      onChange(emptySchemaDraft(shape));
    }
  };

  return <>
    <label className="definition-editor__field">
      <span className="definition-editor__field-label">{label}</span>
      <SelectControl
        ariaLabel={label}
        value={draft?.shape ?? "unrestricted"}
        options={depth ? [{ value: "unrestricted", label: "不限类型" }, ...options] : options}
        disabled={disabled}
        onValueChange={changeShape}
      />
    </label>
    {draft && hasBounds ? <div className="definition-editor__range-group">
      <label className="definition-editor__field">
        <span className="definition-editor__field-label">{boundsLabel}{isArray ? "最少项数" : "最小值"}</span>
        <input inputMode={draft.shape === "number" ? "decimal" : "numeric"} value={draft.lower}
          onChange={event => update({ lower: event.target.value })} />
      </label>
      <label className="definition-editor__field">
        <span className="definition-editor__field-label">{boundsLabel}{isArray ? "最多项数" : "最大值"}</span>
        <input inputMode={draft.shape === "number" ? "decimal" : "numeric"} value={draft.upper}
          onChange={event => update({ upper: event.target.value })} />
      </label>
    </div> : null}
    {draft?.shape === "mixed" ?
      <label className="definition-editor__field definition-editor__field--full">
        <span className="definition-editor__field-label">{descriptionLabel}</span>
        <input value={draft.description} maxLength={maxTypeDescription} required
          onChange={event => update({ description: event.target.value })} />
      </label> : null}
    {isArray ? <div className="definition-editor__field--full definition-editor__fields definition-editor__array-items">
      <DefinitionValueSchemaFields draft={draft.items} depth={depth + 1} disabled={disabled}
        onChange={items => update({ items })} />
    </div> : null}
  </>;
}
