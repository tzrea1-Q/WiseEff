import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import type { DtsCell, DtsValue } from "@/domain/parameter-topology/types";

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function cellValue(cell: DtsCell): bigint | string {
  return cell.kind === "integer" ? BigInt(cell.value) : `&${cell.label}`;
}

function schemaValue(value: DtsValue, schema: Record<string, unknown>): unknown {
  const array = schema.type === "array";
  switch (value.kind) {
    case "strings": return array ? value.values : value.values.length === 1 ? value.values[0] : value.values;
    case "cells": {
      const groups = value.groups.map((group) => group.map(cellValue));
      if (array && record(schema.items) && schema.items.type === "array") return groups;
      const cells = groups.flat();
      return array ? cells : cells.length === 1 ? cells[0] : cells;
    }
    case "bytes": return value.values.map(BigInt);
    case "boolean": return true;
    case "empty": return null;
    case "mixed": return value;
  }
}

function check(value: unknown, schema: Record<string, unknown>, path = "取值"): string | undefined {
  switch (schema.type) {
    case "array": {
      if (!Array.isArray(value)) return `${path}应为数组`;
      if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path}至少需要 ${schema.minItems} 项，当前 ${value.length} 项`;
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path}最多允许 ${schema.maxItems} 项，当前 ${value.length} 项`;
      if (record(schema.items)) {
        for (let index = 0; index < value.length; index += 1) {
          const error = check(value[index], schema.items, `${path}第 ${index + 1} 项`);
          if (error) return error;
        }
      }
      return;
    }
    case "integer":
    case "number": {
      if (typeof value !== "bigint" && (typeof value !== "number" || !Number.isFinite(value))) return `${path}应为数值`;
      if (schema.type === "integer" && typeof value === "number" && !Number.isInteger(value)) return `${path}应为整数`;
      // Relational BigInt/Number comparison preserves the cell's integer precision.
      if (typeof schema.minimum === "number" && value < schema.minimum) return `${path}不能小于 ${schema.minimum}`;
      if (typeof schema.maximum === "number" && value > schema.maximum) return `${path}不能大于 ${schema.maximum}`;
      return;
    }
    case "string": return typeof value === "string" ? undefined : `${path}应为单个字符串`;
    case "boolean": return typeof value === "boolean" ? undefined : `${path}应为布尔属性`;
    case "null": return value === null ? undefined : `${path}应为空属性`;
    default: return;
  }
}

/** Validate only the supported, pinned Catalog schema; absence is not a business-validation pass. */
export function validateDtsValueAgainstSchema(propertyName: string, rawText: string, schema: unknown): string | undefined {
  if (!record(schema)) return;
  try {
    return check(schemaValue(parseDtsValue(propertyName, rawText).value, schema), schema);
  } catch {
    // Syntax owns its own diagnostics and must be checked before this function.
    return;
  }
}

export function formatDtsValueSchema(schema: unknown): string {
  if (!record(schema)) return "";
  const parts: string[] = [];
  if (typeof schema.minimum === "number") parts.push(`最小 ${schema.minimum}`);
  if (typeof schema.maximum === "number") parts.push(`最大 ${schema.maximum}`);
  if (schema.type === "array") {
    if (schema.minItems === schema.maxItems && typeof schema.minItems === "number") parts.push(`固定 ${schema.minItems} 项`);
    else {
      if (typeof schema.minItems === "number") parts.push(`至少 ${schema.minItems} 项`);
      if (typeof schema.maxItems === "number") parts.push(`最多 ${schema.maxItems} 项`);
    }
    const item = formatDtsValueSchema(schema.items);
    if (item) parts.push(`每项：${item}`);
  }
  return parts.join("；");
}
