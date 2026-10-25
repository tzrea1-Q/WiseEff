import type { DtsCell, DtsValue, DtsValueSegment } from "./types";
import { stripDtsComments } from "./preprocess";
import { dtsReferencePath } from "../../../src/domain/dts/reference";

export interface DtsValueParseResult {
  value: DtsValue;
  rawText: string;
}

type CellWidth = 8 | 16 | 32 | 64;

const VALID_WIDTHS: ReadonlySet<number> = new Set([8, 16, 32, 64]);
const EMPTY_PROPERTY_NAMES = new Set(["ranges", "dma-ranges"]);

/**
 * Parse a property RHS into a lossless typed value AST. Bool/empty properties are
 * distinguished by `propertyName` membership in the DTS `ranges`/`dma-ranges` convention;
 * everything else is tokenized from `rawText` itself.
 */
export function parseDtsValue(propertyName: string, rawText: string): DtsValueParseResult {
  if (rawText.trim() === "") {
    return {
      value: EMPTY_PROPERTY_NAMES.has(propertyName) ? { kind: "empty" } : { kind: "boolean", present: true },
      rawText,
    };
  }

  const trimmed = stripDtsComments(rawText).trim();
  if (trimmed.startsWith("[")) {
    return { value: parseByteLiteral(trimmed), rawText };
  }

  const items = splitTopLevelItems(rawText).map(parseTopLevelItem);
  return { value: combineItems(items), rawText };
}

/**
 * Render a `DtsValue` back to DTS source text.
 *
 * When `previousRawText` is provided and the new value has the same structural
 * shape (kind, group/cell counts, cell kinds), reuse the previous source layout
 * (newlines, tabs, spacing) and only replace changed tokens. This keeps multi-line
 * matrices such as `cccv_10_20` from collapsing to a single line on typed edit.
 * If the shape diverges, fall back to a compact reconstruction from `value`.
 */
export function renderDtsValue(value: DtsValue, previousRawText?: string): string {
  if (previousRawText !== undefined) {
    const preserved = tryPreserveRawFormatting(value, previousRawText);
    if (preserved !== null) return preserved;
  }

  switch (value.kind) {
    case "boolean":
    case "empty":
      return "";
    case "strings":
      // Prefer the preserved raw spans (byte-identical, including multi-line/tab-indented
      // separators); fall back to a plain ", "-joined render for hand-built values-only fixtures.
      return value.items
        ? value.items.map((item) => item.raw).join(",")
        : value.values.map((v) => `"${v}"`).join(", ");
    case "bytes":
      return `[${value.values.map((v) => v.toString(16).padStart(2, "0")).join(" ")}]`;
    case "cells":
      return renderCellsValue(value.bits, value.groups);
    case "mixed":
      return value.segments.map(renderSegment).join(",");
    default: {
      const exhaustive: never = value;
      void exhaustive;
      return previousRawText ?? "";
    }
  }
}

function tryPreserveRawFormatting(value: DtsValue, previousRawText: string): string | null {
  let previous: DtsValue;
  try {
    previous = parseDtsValue("_preserve", previousRawText).value;
  } catch {
    return null;
  }
  if (previous.kind !== value.kind) return null;

  switch (value.kind) {
    case "boolean":
    case "empty":
      return previousRawText.trim() === "" ? previousRawText : null;
    case "strings":
      // Item `raw` spans already carry layout; prefer them when present.
      if (value.items && value.items.length === value.values.length) {
        return value.items.map((item) => item.raw).join(",");
      }
      return null;
    case "bytes":
      return tryPreserveBytesFormatting(value.values, previousRawText);
    case "cells":
      if (previous.kind !== "cells") return null;
      return tryPreserveCellsFormatting(value, previous, previousRawText);
    case "mixed":
      return JSON.stringify(value) === JSON.stringify(previous) ? previousRawText : null;
    default: {
      const exhaustive: never = value;
      void exhaustive;
      return null;
    }
  }
}

function tryPreserveBytesFormatting(values: number[], previousRawText: string): string | null {
  const semantic = stripDtsComments(previousRawText);
  if (!isByteLiteral(semantic.trim())) return null;
  const start = semantic.indexOf("[") + 1;
  const end = semantic.lastIndexOf("]");
  const inner = previousRawText.slice(start, end);
  const matches = [...semantic.slice(start, end).matchAll(/[0-9A-Fa-f]{2}/g)];
  if (matches.length !== values.length) return null;

  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const start = match.index ?? 0;
    out += inner.slice(cursor, start);
    out += Number.parseInt(match[0], 16) === values[i]
      ? match[0]
      : values[i]!.toString(16).padStart(2, "0");
    cursor = start + match[0].length;
  }
  out += inner.slice(cursor);

  const prefix = previousRawText.slice(0, start);
  const suffix = previousRawText.slice(end);
  return `${prefix}${out}${suffix}`;
}

function tryPreserveCellsFormatting(
  value: Extract<DtsValue, { kind: "cells" }>,
  previous: Extract<DtsValue, { kind: "cells" }>,
  previousRawText: string
): string | null {
  if (value.bits !== previous.bits) return null;
  if (value.groups.length !== previous.groups.length) return null;
  for (let groupIndex = 0; groupIndex < value.groups.length; groupIndex += 1) {
    const nextGroup = value.groups[groupIndex]!;
    const prevGroup = previous.groups[groupIndex]!;
    if (nextGroup.length !== prevGroup.length) return null;
    for (let cellIndex = 0; cellIndex < nextGroup.length; cellIndex += 1) {
      if (nextGroup[cellIndex]!.kind !== prevGroup[cellIndex]!.kind) return null;
    }
  }

  const items = splitTopLevelItems(previousRawText);
  if (items.length !== value.groups.length) return null;

  const patchedItems: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const patched = patchCellsGroupItem(items[i]!, value.bits, value.groups[i]!);
    if (patched === null) return null;
    patchedItems.push(patched);
  }

  // Recreate top-level separators (commas) from the original text.
  return joinTopLevelItems(previousRawText, patchedItems);
}

/** Replace each top-level item span in-place so commas/whitespace between items stay intact. */
function joinTopLevelItems(previousRawText: string, patchedItems: string[]): string {
  const semantic = stripDtsComments(previousRawText);
  const ranges: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let parentheses = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < previousRawText.length; i += 1) {
    const ch = semantic[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") parentheses += 1;
    if (ch === ")") parentheses -= 1;
    if (ch === "<" && parentheses === 0) {
      depth += 1;
      continue;
    }
    if (ch === ">" && parentheses === 0) {
      depth -= 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      ranges.push({ start, end: i });
      start = i + 1;
    }
  }
  ranges.push({ start, end: previousRawText.length });

  if (ranges.length !== patchedItems.length) {
    return patchedItems.join(",");
  }

  let out = "";
  let cursor = 0;
  for (let i = 0; i < ranges.length; i += 1) {
    const range = ranges[i]!;
    out += previousRawText.slice(cursor, range.start);
    out += patchedItems[i];
    cursor = range.end;
  }
  out += previousRawText.slice(cursor);
  return out;
}

function patchCellsGroupItem(itemRaw: string, bits: CellWidth, cells: DtsCell[]): string | null {
  const semantic = stripDtsComments(itemRaw);
  const angleStart = semantic.indexOf("<");
  const angleEnd = semantic.lastIndexOf(">");
  if (angleStart < 0 || angleEnd < 0 || angleEnd < angleStart) return null;

  const prefix = itemRaw.slice(0, angleStart + 1);
  const inner = itemRaw.slice(angleStart + 1, angleEnd);
  const suffix = itemRaw.slice(angleEnd);

  if (bits !== 32) {
    const bitsPrefix = prefix.match(/\/bits\/\s+\d+\s+$/);
    if (!bitsPrefix && !itemRaw.includes(`/bits/`)) {
      // Compact fallback path will add /bits/; refuse preserve when shape is unexpected.
      return null;
    }
  }

  const matches = scanCellTokens(semantic.slice(angleStart + 1, angleEnd));
  if (matches.length !== cells.length) return null;

  let out = "";
  let cursor = 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const start = match.start;
    out += inner.slice(cursor, start);
    const cell=cells[i]!,previous=parseCellToken(match.raw,bits);
    out += (cell.kind==="phandle" && previous.kind==="phandle" && cell.label===previous.label)
      || (cell.kind==="integer" && previous.kind==="integer" && previous.raw.startsWith("(") && cell.raw===previous.raw && cell.value===previous.value)
      ?inner.slice(start,start+match.raw.length):renderCell(cell);
    cursor = start + match.raw.length;
  }
  out += inner.slice(cursor);
  return `${prefix}${out}${suffix}`;
}

function renderSegment(segment: DtsValueSegment): string {
  if (segment.kind === "string") return segment.raw;
  return renderCellsValue(segment.bits, [segment.cells]);
}

function renderCellsValue(bits: CellWidth, groups: DtsCell[][]): string {
  const prefix = bits === 32 ? "" : `/bits/ ${bits} `;
  return groups.map((group) => `${prefix}<${group.map(renderCell).join(" ")}>`).join(",");
}

function renderCell(cell: DtsCell): string {
  if (cell.kind === "phandle") return `&${cell.label}`;
  // dtc 1.8+ rejects bare `<-1>` cell forms; emit the parenthesized spelling.
  const raw = /^\(-(?:0[xX][0-9A-Fa-f]+|\d+)\)$/u.test(cell.raw) ? cell.raw.slice(1, -1) : cell.raw;
  return raw.startsWith("-") ? `(${raw})` : raw;
}

interface StringItem {
  type: "string";
  raw: string;
  /** Untrimmed source slice (leading whitespace/newlines up to the preceding separator kept
   * intact) so `strings` values round-trip byte-identically across multi-line item lists. */
  sourceRaw: string;
  value: string;
}

interface CellsItem {
  type: "cells";
  bits: CellWidth;
  cells: DtsCell[];
}

type ParsedItem = StringItem | CellsItem;

/** Split a value's raw text on top-level commas, respecting `<...>` depth and `"..."` quoting. */
function splitTopLevelItems(rawText: string): string[] {
  const semantic = stripDtsComments(rawText);
  const items: string[] = [];
  let depth = 0;
  let parentheses = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < rawText.length; i += 1) {
    const ch = semantic[i];
    if (inString) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "(") parentheses += 1;
    if (ch === ")") parentheses -= 1;
    if (parentheses < 0) throw new SyntaxError("Unexpected closing DTS expression parenthesis");
    if (ch === "<" && parentheses === 0) {
      depth += 1;
      if (depth > 1) throw new SyntaxError("Nested DTS cell groups are not supported");
      continue;
    }
    if (ch === ">" && parentheses === 0) {
      depth -= 1;
      if (depth < 0) throw new SyntaxError("Unexpected closing DTS cell bracket");
      continue;
    }
    if (ch === "," && depth === 0) {
      items.push(rawText.slice(start, i));
      start = i + 1;
    }
  }
  if (inString) throw new SyntaxError("Unterminated DTS string");
  if (parentheses !== 0) throw new SyntaxError("Unterminated DTS expression");
  if (depth !== 0) throw new SyntaxError("Unterminated DTS cell group");
  items.push(rawText.slice(start));
  return items;
}

const STRING_RE = /^"((?:\\.|[^"\\])*)"$/;
const BITS_GROUP_RE = /^\/bits\/\s+(\d+)\s+<([\s\S]*)>$/;

function parseTopLevelItem(itemRawWithWhitespace: string): ParsedItem {
  const trimmed = stripDtsComments(itemRawWithWhitespace).trim();

  const stringMatch = STRING_RE.exec(trimmed);
  if (stringMatch) {
    return { type: "string", raw: trimmed, sourceRaw: itemRawWithWhitespace, value: stringMatch[1] };
  }

  const bitsMatch = BITS_GROUP_RE.exec(trimmed);
  if (bitsMatch) {
    const width = Number(bitsMatch[1]);
    if (!VALID_WIDTHS.has(width)) {
      throw new RangeError(`Unsupported /bits/ width: ${bitsMatch[1]}`);
    }
    const bits = width as CellWidth;
    return { type: "cells", bits, cells: parseCellsGroup(bitsMatch[2], bits) };
  }

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return { type: "cells", bits: 32, cells: parseCellsGroup(trimmed.slice(1, -1), 32) };
  }

  throw new Error(`Unrecognized DTS value token: "${trimmed}"`);
}

function scanCellTokens(inner: string): Array<{ start: number; raw: string }> {
  const tokens: Array<{ start: number; raw: string }> = [];
  const literal = /&\s*\{[^{}]*\}|&[A-Za-z_][A-Za-z0-9_]*|-?(?:0[xX][0-9A-Fa-f]+|\d+)(?:[uU](?:[lL]{1,2})?|[lL]{1,2}[uU]?)?/uy;
  let cursor = 0;
  while (cursor < inner.length) {
    if (/\s/u.test(inner[cursor]!)) { cursor += 1; continue; }
    const start = cursor;
    if (inner[cursor] === "(") {
      let depth = 0;
      do {
        if (inner[cursor] === "(") depth += 1;
        if (inner[cursor] === ")") depth -= 1;
        if (depth > 64 || cursor - start >= 4096) throw new RangeError("DTS integer expression exceeds its bounded capacity");
        cursor += 1;
      } while (cursor < inner.length && depth > 0);
      if (depth !== 0) throw new SyntaxError("Unterminated DTS integer expression");
    } else {
      literal.lastIndex = cursor;
      const match = literal.exec(inner);
      if (!match) throw new SyntaxError(`Invalid DTS cell token at position ${cursor + 1}`);
      cursor += match[0].length;
    }
    if (cursor < inner.length && !/\s/u.test(inner[cursor]!)) throw new SyntaxError(`Invalid DTS cell token at position ${cursor + 1}`);
    tokens.push({ start, raw: inner.slice(start, cursor) });
  }
  return tokens;
}

function parseCellsGroup(inner: string, width: CellWidth): DtsCell[] {
  return scanCellTokens(inner).map(token => parseCellToken(token.raw, width));
}

function parseCellToken(token: string, width: CellWidth): DtsCell {
  if (token.startsWith("&")) {
    const raw=token.slice(1).trim(),label=raw.startsWith("{")?`{${raw.slice(1,-1).trim()}}`:raw;
    dtsReferencePath(label);
    return { kind: "phandle", label };
  }

  const bare = /^\(-(?:0[xX][0-9A-Fa-f]+|\d+)\)$/u.test(token) ? token.slice(1, -1) : token;
  const negative = bare.startsWith("-");
  const magnitudeText = negative ? bare.slice(1) : bare;
  const magnitude = bare.startsWith("(") ? evaluateIntegerExpression(bare) : integerLiteral(magnitudeText);
  const signedValue = negative ? -magnitude : magnitude;

  const maxUnsigned = (1n << BigInt(width)) - 1n;
  const minSigned = -(1n << BigInt(width - 1));
  // Native dtc expressions evaluate as uint64_t and accept sign extension into smaller cells.
  const value = bare.startsWith("(") && signedValue > maxUnsigned && BigInt.asIntN(64, signedValue) >= minSigned
    ? BigInt.asIntN(64, signedValue) : signedValue;
  if (value > maxUnsigned || value < minSigned) {
    throw new RangeError(`Integer literal "${token}" overflows a ${width}-bit cell`);
  }

  // Canonical raw keeps the signed literal without required parentheses; renderCell adds them.
  return { kind: "integer", raw: bare, value: value.toString() };
}

function integerLiteral(raw: string): bigint {
  const literal = raw.replace(/(?:[uU](?:[lL]{1,2})?|[lL]{1,2}[uU]?)$/u, "");
  if (literal.length > 64) throw new RangeError("DTS integer literal exceeds its bounded capacity");
  if (/^0\d*[89]/u.test(literal)) throw new SyntaxError("Invalid octal DTS integer literal");
  const value = BigInt(/^0[0-7]+$/u.test(literal) ? `0o${literal.slice(1)}` : literal);
  if (value > 0xffff_ffff_ffff_ffffn) throw new RangeError("DTS integer literal exceeds 64 bits");
  return value;
}

const INTEGER_PRECEDENCE: Readonly<Record<string, number>> = {
  "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
  "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10,
};

/** Native DTS uint64_t arithmetic; bounded tokens/depth keep untrusted expressions cheap. */
function evaluateIntegerExpression(raw: string): bigint {
  const tokens = raw.match(/0[xX][0-9A-Fa-f]+(?:[uU](?:[lL]{1,2})?|[lL]{1,2}[uU]?)?|\d+(?:[uU](?:[lL]{1,2})?|[lL]{1,2}[uU]?)?|<<|>>|<=|>=|==|!=|&&|\|\||[()+\-*/%~!<>&^|]/gu) ?? [];
  if (tokens.length > 1024 || tokens.join("") !== raw.replace(/\s/gu, "")) throw new SyntaxError("Unsupported or excessive DTS integer expression");
  let cursor = 0;
  const expression = (minimum = 0, depth = 0): bigint => {
    if (depth > 64) throw new RangeError("DTS integer expression exceeds its bounded capacity");
    const token = tokens[cursor++];
    let value: bigint;
    if (token === "(") {
      value = expression(0, depth + 1);
      if (tokens[cursor++] !== ")") throw new SyntaxError("Unclosed DTS integer expression");
    } else if (token === "-" || token === "~" || token === "!") {
      const operand = expression(11, depth + 1);
      value = token === "-" ? -operand : token === "~" ? ~operand : BigInt(operand === 0n);
    } else if (token && /^\d/u.test(token)) value = integerLiteral(token);
    else throw new SyntaxError("Expected a DTS integer expression operand");
    value = BigInt.asUintN(64, value);
    while (cursor < tokens.length) {
      const operator = tokens[cursor]!, precedence = INTEGER_PRECEDENCE[operator];
      if (precedence === undefined || precedence < minimum) break;
      cursor += 1;
      const right = expression(precedence + 1, depth + 1);
      if ((operator === "<<" || operator === ">>") && right >= 64n) throw new RangeError("DTS integer shifts require a count from 0 to 63");
      switch (operator) {
        case "+": value += right; break;
        case "-": value -= right; break;
        case "*": value *= right; break;
        case "/": value /= right; break;
        case "%": value %= right; break;
        case "<<": value <<= right; break;
        case ">>": value >>= right; break;
        case "&": value &= right; break;
        case "|": value |= right; break;
        case "^": value ^= right; break;
        case "==": value = BigInt(value === right); break;
        case "!=": value = BigInt(value !== right); break;
        case "<": value = BigInt(value < right); break;
        case "<=": value = BigInt(value <= right); break;
        case ">": value = BigInt(value > right); break;
        case ">=": value = BigInt(value >= right); break;
        case "&&": value = BigInt(value !== 0n && right !== 0n); break;
        case "||": value = BigInt(value !== 0n || right !== 0n); break;
      }
      value = BigInt.asUintN(64, value);
    }
    return value;
  };
  const value = expression();
  if (cursor !== tokens.length) throw new SyntaxError("Unsupported DTS integer expression tail");
  return value;
}

function combineItems(items: ParsedItem[]): DtsValue {
  if (items.every((item): item is StringItem => item.type === "string")) {
    return {
      kind: "strings",
      values: items.map((item) => item.value),
      items: items.map((item) => ({ value: item.value, raw: item.sourceRaw })),
    };
  }

  if (items.every((item): item is CellsItem => item.type === "cells")) {
    const bits = items[0].bits;
    if (items.every((item) => item.bits === bits)) {
      return { kind: "cells", bits, groups: items.map((item) => item.cells) };
    }
  }

  const segments: DtsValueSegment[] = items.map((item) =>
    item.type === "string"
      ? { kind: "string", raw: item.raw, value: item.value }
      : { kind: "cells", bits: item.bits, cells: item.cells },
  );
  return { kind: "mixed", segments };
}

function isByteLiteral(trimmed: string): boolean {
  return /^\[(?:\s*[0-9A-Fa-f]{2})*\s*\]$/.test(trimmed);
}

function parseByteLiteral(trimmed: string): DtsValue {
  if (!isByteLiteral(trimmed)) {
    throw new SyntaxError("Byte arrays require complete pairs of hexadecimal digits: [00 ff …]");
  }
  const inner = trimmed.slice(1, -1);
  const values = (inner.match(/[0-9A-Fa-f]{2}/g) ?? []).map((hex) => Number.parseInt(hex, 16));
  return { kind: "bytes", values };
}
