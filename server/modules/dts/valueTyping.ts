import type { DtsCell, DtsValue, DtsValueType } from "./types";
import { parseDtsValue } from "./valueAst";

export interface ClassifiedDtsValue {
  valueType: DtsValueType;
  normalizedValue: string;
}

export const EMPTY_PROPERTY_NAMES = new Set(["ranges", "dma-ranges"]);

/** Classify only complete parsed values; unsupported source remains a lossless mixed value. */
export function classifyDtsValue(rawText: string, propertyName: string): ClassifiedDtsValue {
  try {
    return classifyParsedValue(parseDtsValue(propertyName, rawText).value, rawText);
  } catch {
    return { valueType: "mixed", normalizedValue: rawText.trim() };
  }
}

function normalizeCellToken(token: string): string {
  return /^-?0[xX][0-9A-Fa-f]+$/.test(token) ? token.toLowerCase() : token;
}

function normalizeCells(cells: readonly DtsCell[]): string {
  return cells.map((cell) => cell.kind === "phandle" ? `&${cell.label}` : /^\(|[uUlL]$/u.test(cell.raw) ? cell.value : normalizeCellToken(cell.raw)).join(" ");
}

function classifyParsedValue(value: DtsValue, rawText: string): ClassifiedDtsValue {
  switch (value.kind) {
    case "boolean": return { valueType: "bool", normalizedValue: "true" };
    case "empty": return { valueType: "empty", normalizedValue: "empty" };
    case "strings": return { valueType: "string-list", normalizedValue: value.values.map((part) => `"${part}"`).join(", ") };
    case "bytes": return { valueType: "bytes", normalizedValue: `[${value.values.map((part) => part.toString(16).padStart(2, "0")).join(" ")}]` };
    case "mixed": return {
      valueType: "mixed",
      normalizedValue: value.segments.map((segment) => segment.kind === "string"
        ? segment.raw
        : `${segment.bits === 32 ? "" : `/bits/ ${segment.bits} `}<${normalizeCells(segment.cells)}>`).join(", "),
    };
    case "cells": {
      const cells = value.groups.flat();
      const hasRef = cells.some((cell) => cell.kind === "phandle");
      const hasInteger = cells.some((cell) => cell.kind === "integer");
      if (!hasRef && (value.bits !== 32 || rawText.trim().startsWith("/bits/"))) {
        return { valueType: "bytes", normalizedValue: value.groups.map((group) => `/bits/ ${value.bits} <${normalizeCells(group)}>`).join(", ") };
      }
      const valueType = value.groups.length > 1 || (hasRef && hasInteger) ? "mixed" : hasRef ? "phandle-list" : "u32-array";
      return { valueType, normalizedValue: `<${normalizeCells(cells)}>` };
    }
  }
}
