import { stripDtsComments } from "../dts/comments";
import { decodeDtsString } from "../dts/dtsValueClient";
import { parseDtsValue } from "../parameter-topology/parseDtsValue";
import type { DtsCell, DtsValue } from "../parameter-topology/types";

export const MAX_DTS_EXAMPLES = 8;
export const MAX_DTS_EXAMPLE_CHARS = 4000;

export const normalizeDtsExample = (text: string): string =>
  text.replace(/\r\n/gu, "\n").replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/gu, "");

export const hasDtsExampleControlCharacters = (text: string): boolean =>
  /[^\P{Cc}\n\t]/u.test(text);

export const dtsExampleMessages = {
  "dts-examples-require-dts-subject": "DTS 示例仅适用于驱动和节点类型定义。",
  "invalid-dts-example": "DTS 示例格式无效，请填写一条完整属性语句或一个 DTS 取值，且不要包含控制字符。",
  "dts-example-property-mismatch": "DTS 示例的属性名必须与定义的属性键一致。",
  "dts-example-does-not-match-schema": "DTS 示例不符合定义的类型或约束。",
} as const;

type ParsedDtsExample = { raw: string; value: DtsValue };
type DtsExampleIssue = keyof typeof dtsExampleMessages;

export function parseDtsExample(source: string, propertyKey: string): ParsedDtsExample | DtsExampleIssue {
  try {
    const input = stripDtsComments(source, true).trim();
    const statement = /^([A-Za-z0-9,._+?#-]+)\s*(=|;)/u.exec(input);
    if (statement && !input.endsWith(";")) return "invalid-dts-example";
    if (statement?.[2] === ";" && input.length !== statement[0].length) return "invalid-dts-example";
    if (statement && statement[1] !== propertyKey) return "dts-example-property-mismatch";
    const raw = statement?.[2] === ";" ? "" : statement
      ? input.slice(statement[0].length, -1).trim() : input;
    if (!raw && statement?.[2] !== ";") return "invalid-dts-example";
    return { raw, value: parseDtsValue(propertyKey, raw).value };
  } catch {
    return "invalid-dts-example";
  }
}

function cellToJson(cell: DtsCell): number | string {
  if (cell.kind === "phandle") return `&${cell.label}`;
  const number = Number(cell.value);
  if (!Number.isSafeInteger(number)) throw new RangeError("Unsafe JSON integer");
  return number;
}

/** Convert a parsed value for schema checks or the legacy JSON examples input. */
export function dtsExampleToJson({ value, raw }: ParsedDtsExample, targetType?: string, grouped = false) {
  if (targetType === "bytes" || targetType === "mixed") return raw;
  switch (value.kind) {
    case "strings": {
      const strings = value.values.map(decodeDtsString);
      return targetType === "string" && strings.length === 1 ? strings[0] : strings;
    }
    case "cells": {
      if (value.groups.some((group) => group.length === 0)) throw new SyntaxError("Empty DTS cell group");
      const groups = value.groups.map((group) => group.map(cellToJson));
      if (grouped) return groups;
      const cells = groups.flat();
      return (targetType === "integer" || targetType === "number") && cells.length === 1 ? cells[0] : cells;
    }
    case "bytes": return value.values;
    case "boolean": return targetType === "empty" || targetType === "null" ? null : true;
    case "empty": return null;
    case "mixed": return raw;
  }
}

type ExampleSchema = {
  type?: string; description?: string; minimum?: number; maximum?: number;
  minItems?: number; maxItems?: number; items?: ExampleSchema;
};

export function exampleMatchesSchema(schema: ExampleSchema, example: unknown): boolean {
  switch (schema.type) {
    case undefined: return true;
    case "integer":
    case "number":
      return typeof example === "number" && Number.isFinite(example) && !Object.is(example, -0)
        && (schema.type !== "integer" || Number.isInteger(example))
        && (schema.minimum === undefined || example >= schema.minimum)
        && (schema.maximum === undefined || example <= schema.maximum);
    case "boolean": return typeof example === "boolean";
    case "null": return example === null;
    case "array":
      return Array.isArray(example)
        && (schema.minItems === undefined || example.length >= schema.minItems)
        && (schema.maxItems === undefined || example.length <= schema.maxItems)
        && (!schema.items || example.every((entry) => exampleMatchesSchema(schema.items!, entry)));
    default: return typeof example === "string";
  }
}

export function dtsExampleIssue(text: string, propertyKey: string, schema?: ExampleSchema): DtsExampleIssue | undefined {
  if (!text.trim() || hasDtsExampleControlCharacters(text)) return "invalid-dts-example";
  const parsed = parseDtsExample(text, propertyKey);
  if (typeof parsed === "string") return parsed;
  // A string schema also represents byte literals in the definition editor.
  if (!schema?.type || (schema.type === "string" && parsed.value.kind === "bytes")) return undefined;
  try {
    const grouped = schema.type === "array" && schema.items?.type === "array";
    if (parsed.value.kind !== "mixed" && exampleMatchesSchema(schema, dtsExampleToJson(parsed, schema.type, grouped))) return undefined;
  } catch {
    // Valid DTS may exceed JSON's safe integer range.
  }
  return "dts-example-does-not-match-schema";
}
