import type { DtsValueType } from "./types";

export interface ClassifiedDtsValue {
  valueType: DtsValueType;
  normalizedValue: string;
}

export const EMPTY_PROPERTY_NAMES = new Set(["ranges", "dma-ranges"]);

/** Classify a property RHS and produce a type-aware normalized comparison string. */
export function classifyDtsValue(rawText: string, propertyName: string): ClassifiedDtsValue {
  const trimmed = rawText.trim();
  if (trimmed === "") {
    if (EMPTY_PROPERTY_NAMES.has(propertyName)) {
      return { valueType: "empty", normalizedValue: "empty" };
    }
    return { valueType: "bool", normalizedValue: "true" };
  }

  if (trimmed.startsWith("/bits/")) {
    return { valueType: "bytes", normalizedValue: normalizeBits(trimmed) };
  }

  if (trimmed.includes('"')) {
    return { valueType: "string-list", normalizedValue: normalizeStringList(trimmed) };
  }

  const groups = splitAngleGroups(trimmed);
  if (groups.length === 0) {
    return { valueType: "mixed", normalizedValue: trimmed };
  }

  const tokens = groups.flatMap(tokenizeGroup);
  const hasRef = tokens.some((t) => t.startsWith("&"));
  const hasCell = tokens.some((t) => !t.startsWith("&"));
  const multiGroup = groups.length > 1;

  let valueType: DtsValueType;
  if (multiGroup || (hasRef && hasCell)) {
    valueType = "mixed";
  } else if (hasRef && !hasCell) {
    valueType = "phandle-list";
  } else {
    valueType = "u32-array";
  }

  const normalizedCells = tokens.map(normalizeCellToken).join(" ");
  return { valueType, normalizedValue: `<${normalizedCells}>` };
}

function normalizeBits(trimmed: string): string {
  const match = trimmed.match(/^\/bits\/\s+(\d+)\s+<([^>]*)>\s*$/i);
  if (!match) return trimmed;
  const width = match[1];
  const cells = tokenizeGroup(match[2]).map(normalizeCellToken).join(" ");
  return `/bits/ ${width} <${cells}>`;
}

function normalizeStringList(trimmed: string): string {
  const parts: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    parts.push(`"${m[1]}"`);
  }
  return parts.join(", ");
}

/** Split top-level `<...>` groups separated by commas. */
function splitAngleGroups(trimmed: string): string[] {
  const groups: string[] = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /[\s,]/.test(trimmed[i])) i += 1;
    if (i >= trimmed.length) break;
    if (trimmed[i] !== "<") {
      // Not a cell-group RHS
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

function tokenizeGroup(inner: string): string[] {
  const tokens: string[] = [];
  const re = /&[A-Za-z_][A-Za-z0-9_]*|-?0[xX][0-9A-Fa-f]+|-?\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
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
