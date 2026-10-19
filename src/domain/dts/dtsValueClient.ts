import type { DtsValueType } from "@/application/ports/DtsStructuredRepository";
import { dtsValueTypeLabel } from "@/domain/dts/dtsValueTypeLabels";
import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";
import type { DtsCell, DtsValue } from "@/domain/parameter-topology/types";

export type ClassifiedDtsValue = {
  valueType: DtsValueType;
  normalizedValue: string;
};

export type ValidatedDtsValue = ClassifiedDtsValue & {
  valid: boolean;
  error?: string;
};

/** Classify a property RHS and produce a type-aware normalized comparison string. */
export function classifyDtsValue(rawText: string, propertyName: string): ClassifiedDtsValue {
  try {
    return classifyParsedValue(parseDtsValue(propertyName, rawText).value, rawText);
  } catch {
    return { valueType: "mixed", normalizedValue: rawText.trim() };
  }
}

function normalizeCells(cells: readonly DtsCell[]): string {
  return cells.map((cell) => cell.kind === "phandle" ? `&${cell.label}` : normalizeCellToken(cell.raw)).join(" ");
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

/**
 * Validate rawText against an optional declared editor type.
 * Classification mirrors the backend; validation catches illegal tokens and type mismatch.
 */
export function validateDtsValue(
  rawText: string,
  propertyName: string,
  declaredType?: DtsValueType,
): ValidatedDtsValue {
  let value: DtsValue;
  try {
    value = parseDtsValue(propertyName, rawText).value;
  } catch (error) {
    return {
      ...classifyDtsValue(rawText, propertyName),
      valid: false,
      error: `DTS 取值无效：${error instanceof Error ? error.message : "无法解析输入"}`,
    };
  }
  const classified = classifyParsedValue(value, rawText);
  if (value.kind === "cells" && value.groups.some((group) => group.length === 0)) {
    return { ...classified, valid: false, error: "数值组不能为空" };
  }

  if (declaredType && classified.valueType !== declaredType) {
    // Empty rawText is always bool/empty; editor types bool/empty are intentional.
    if (!(rawText.trim() === "" && (declaredType === "bool" || declaredType === "empty"))) {
      return {
        ...classified,
        valid: false,
        error: `期望类型「${dtsValueTypeLabel(declaredType)}」，实际为「${dtsValueTypeLabel(classified.valueType)}」`,
      };
    }
  }

  if (declaredType === "empty" && rawText.trim() !== "") {
    return { ...classified, valid: false, error: "空属性的值必须为空" };
  }

  if (declaredType === "bool" && rawText.trim() !== "") {
    return { ...classified, valid: false, error: "布尔属性不能带右侧取值" };
  }

  return { ...classified, valid: true };
}

/** Split top-level `<...>` groups separated by commas. */
function splitAngleGroups(trimmed: string): string[] {
  const groups: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /[\s,]/.test(trimmed[i])) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed[i] !== "<") {
      return [];
    }
    i += 1;
    const start = i;
    let depth = 1;
    while (i < trimmed.length && depth > 0) {
      if (trimmed[i] === "<") depth += 1;
      else if (trimmed[i] === ">") depth -= 1;
      i += 1;
    }
    groups.push(trimmed.slice(start, i - 1));
  }
  return groups;
}

function normalizeCellToken(token: string): string {
  if (token.startsWith("&")) return token;
  if (/^-?0[xX][0-9A-Fa-f]+$/.test(token)) {
    const neg = token.startsWith("-");
    const hex = token.replace(/^-?0[xX]/, "").toLowerCase();
    return `${neg ? "-" : ""}0x${hex}`;
  }
  return token;
}

/** Parse helpers used by the structured value editor UI (preserve draft tokens literally). */
export function parseU32Cells(rawText: string): string[] {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^<([^>]*)>$/);
  if (!match) {
    const groups = splitAngleGroups(trimmed);
    if (groups.length === 0) return [];
    return groups.flatMap((group) => splitDraftCells(group));
  }
  return splitDraftCells(match[1]);
}

export function parseBytesValue(rawText: string): { kind: "bytes" | "cells"; width: number; bytes: string[] } {
  const trimmed = rawText.trim();
  if (/^\[(?:\s*[0-9A-Fa-f]{2})*\s*\]$/.test(trimmed)) {
    return { kind: "bytes", width: 8, bytes: trimmed.slice(1, -1).match(/[0-9A-Fa-f]{2}/g) ?? [] };
  }
  const match = rawText.trim().match(/^\/bits\/\s+(\d+)\s+<([^>]*)>\s*$/i);
  if (!match) return { kind: "cells", width: 8, bytes: [] };
  return {
    kind: "cells",
    width: Number(match[1]),
    bytes: splitDraftCells(match[2]),
  };
}

function splitDraftCells(inner: string): string[] {
  const trimmed = inner.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

export function parseStringListValues(rawText: string): string[] {
  if (rawText.trim() === "") return [""];
  try {
    const value = parseDtsValue("string-list", rawText).value;
    return value.kind === "strings" ? value.values.map(decodeDtsString) : [];
  } catch {
    return [];
  }
}

/** AST string values retain source escapes; input controls edit decoded text. */
export function decodeDtsString(value: string): string {
  const escapes: Record<string, string> = { a: "\x07", b: "\b", t: "\t", n: "\n", v: "\v", f: "\f", r: "\r", '"': '"', "\\": "\\", "?": "?" };
  return value.replace(/\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3}|[\s\S])/g, (raw: string, token: string) => {
    if (token.startsWith("x") && token.length > 1) return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    if (/^[0-7]+$/.test(token)) return String.fromCharCode(Number.parseInt(token, 8));
    return escapes[token] ?? raw;
  });
}

export function encodeDtsString(value: string): string {
  const escapes: Record<string, string> = { "\x07": "\\a", "\b": "\\b", "\t": "\\t", "\n": "\\n", "\v": "\\v", "\f": "\\f", "\r": "\\r", '"': '\\"', "\\": "\\\\" };
  return Array.from(value, (character) => escapes[character]
    ?? (character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
      ? `\\${character.charCodeAt(0).toString(8).padStart(3, "0")}`
      : character)).join("");
}

export function parsePhandleLabels(rawText: string): string[] {
  return parseU32Cells(rawText)
    .filter((t) => t.startsWith("&"))
    .map((t) => t.slice(1));
}

export function formatU32Array(cells: readonly string[]): string {
  return `<${cells.join(" ")}>`;
}

export function formatBytes(width: number, bytes: readonly string[]): string {
  return `/bits/ ${width} <${bytes.join(" ")}>`;
}

export function formatByteLiteral(values: readonly string[]): string {
  return `[${values.join(" ")}]`;
}

export function formatStringList(values: readonly string[], previousRawText?: string): string {
  if (previousRawText !== undefined) {
    try {
      const previous = parseDtsValue("string-list", previousRawText).value;
      if (previous.kind === "strings" && previous.items && previous.values.length === values.length) {
        return previous.items.map((item, index) => decodeDtsString(item.value) === values[index]
          ? item.raw
          : item.raw.replace(/"(?:\\.|[^"\\])*"/, () => `"${encodeDtsString(values[index]!)}"`)).join(",");
      }
    } catch {
      // A newly typed or unsupported source value has no reusable string spans.
    }
  }
  return values.map((value) => `"${encodeDtsString(value)}"`).join(", ");
}

export function formatPhandleList(labels: readonly string[]): string {
  return `<${labels.map((l) => `&${l}`).join(" ")}>`;
}
