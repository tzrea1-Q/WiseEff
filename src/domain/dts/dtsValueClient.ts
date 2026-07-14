import type { DtsValueType } from "@/application/ports/DtsStructuredRepository";

export type ClassifiedDtsValue = {
  valueType: DtsValueType;
  normalizedValue: string;
};

export type ValidatedDtsValue = ClassifiedDtsValue & {
  valid: boolean;
  error?: string;
};

const EMPTY_PROPERTY_NAMES = new Set(["ranges", "dma-ranges"]);

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

/**
 * Validate rawText against an optional declared editor type.
 * Classification mirrors the backend; validation catches illegal tokens and type mismatch.
 */
export function validateDtsValue(
  rawText: string,
  propertyName: string,
  declaredType?: DtsValueType,
): ValidatedDtsValue {
  const classified = classifyDtsValue(rawText, propertyName);
  const syntaxError = findSyntaxError(rawText, classified.valueType);
  if (syntaxError) {
    return { ...classified, valid: false, error: syntaxError };
  }

  if (declaredType && classified.valueType !== declaredType) {
    // Empty rawText is always bool/empty; editor types bool/empty are intentional.
    if (!(rawText.trim() === "" && (declaredType === "bool" || declaredType === "empty"))) {
      return {
        ...classified,
        valid: false,
        error: `期望类型 ${declaredType}，实际为 ${classified.valueType}`,
      };
    }
  }

  if (declaredType === "empty" && rawText.trim() !== "") {
    return { ...classified, valid: false, error: "empty 属性必须为空" };
  }

  if (declaredType === "bool" && rawText.trim() !== "") {
    return { ...classified, valid: false, error: "bool 属性必须为空 RHS" };
  }

  return { ...classified, valid: true };
}

function findSyntaxError(rawText: string, valueType: DtsValueType): string | undefined {
  const trimmed = rawText.trim();
  if (trimmed === "") return undefined;

  if (valueType === "bytes") {
    const match = trimmed.match(/^\/bits\/\s+(\d+)\s+<([^>]*)>\s*$/i);
    if (!match) return "bytes 语法无效，期望 /bits/ N <…>";
    const inner = match[2];
    if (!cellsFullyTokenized(inner, { allowEmpty: false })) {
      return "bytes 含有非法字节单元";
    }
    return undefined;
  }

  if (valueType === "string-list") {
    if (!trimmed.includes('"')) return "string-list 缺少引号字符串";
    // Remaining non-whitespace/comma outside quotes is allowed loosely; require at least one string.
    if (normalizeStringList(trimmed) === "") return "string-list 缺少有效字符串";
    return undefined;
  }

  if (valueType === "u32-array" || valueType === "phandle-list" || valueType === "mixed") {
    const groups = splitAngleGroups(trimmed);
    if (groups.length === 0) {
      if (valueType === "mixed") return undefined;
      return "期望 <…> 单元组";
    }
    for (const group of groups) {
      const allowEmpty = false;
      if (valueType === "u32-array" || valueType === "phandle-list") {
        if (!cellsFullyTokenized(group, { allowEmpty })) {
          return valueType === "phandle-list" ? "phandle-list 含有非法标签" : "u32-array 含有非法单元";
        }
        if (valueType === "phandle-list") {
          const tokens = tokenizeGroup(group);
          if (tokens.length === 0 || tokens.some((t) => !t.startsWith("&"))) {
            return "phandle-list 仅允许 &label 引用";
          }
        }
        if (valueType === "u32-array") {
          const tokens = tokenizeGroup(group);
          if (tokens.length === 0 || tokens.some((t) => t.startsWith("&"))) {
            return "u32-array 仅允许数值单元";
          }
        }
      } else if (!cellsFullyTokenized(group, { allowEmpty: true }) && group.trim() !== "") {
        // mixed: allow empty groups? keep loose — only flag leftover junk when tokens present
        if (tokenizeGroup(group).length > 0 && !cellsFullyTokenized(group, { allowEmpty: true })) {
          return "mixed 含有非法单元";
        }
        if (tokenizeGroup(group).length === 0 && /[^\s,]/.test(group)) {
          return "mixed 含有非法单元";
        }
      }
    }
    return undefined;
  }

  return undefined;
}

function cellsFullyTokenized(inner: string, options: { allowEmpty: boolean }): boolean {
  const trimmed = inner.trim();
  if (trimmed === "") return options.allowEmpty;
  const tokens = tokenizeGroup(trimmed);
  if (tokens.length === 0) return false;
  let rest = trimmed;
  for (const token of tokens) {
    const idx = rest.indexOf(token);
    if (idx < 0) return false;
    rest = `${rest.slice(0, idx)}${rest.slice(idx + token.length)}`;
  }
  return rest.trim() === "";
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

export function parseBytesValue(rawText: string): { width: number; bytes: string[] } {
  const match = rawText.trim().match(/^\/bits\/\s+(\d+)\s+<([^>]*)>\s*$/i);
  if (!match) return { width: 8, bytes: [] };
  return {
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
  const parts: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    parts.push(m[1]);
  }
  return parts.length > 0 ? parts : [""];
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

export function formatStringList(values: readonly string[]): string {
  return values.map((v) => `"${v}"`).join(", ");
}

export function formatPhandleList(labels: readonly string[]): string {
  return `<${labels.map((l) => `&${l}`).join(" ")}>`;
}
