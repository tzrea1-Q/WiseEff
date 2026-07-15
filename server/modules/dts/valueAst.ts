import type { DtsCell, DtsValue, DtsValueSegment } from "./types";
import { EMPTY_PROPERTY_NAMES } from "./valueTyping";

export interface DtsValueParseResult {
  value: DtsValue;
  rawText: string;
}

type CellWidth = 8 | 16 | 32 | 64;

const VALID_WIDTHS: ReadonlySet<number> = new Set([8, 16, 32, 64]);

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

  const trimmed = rawText.trim();
  if (isByteLiteral(trimmed)) {
    return { value: parseByteLiteral(trimmed), rawText };
  }

  const items = splitTopLevelItems(rawText).map(parseTopLevelItem);
  return { value: combineItems(items), rawText };
}

/**
 * Render a `DtsValue` back to DTS source text. `previousRawText` is accepted for API symmetry
 * with `parseDtsValue` (future edit flows may use it as a formatting fallback); the current
 * implementation always reconstructs from `value` itself.
 */
export function renderDtsValue(value: DtsValue, previousRawText?: string): string {
  switch (value.kind) {
    case "boolean":
    case "empty":
      return "";
    case "strings":
      return value.values.map((v) => `"${v}"`).join(", ");
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

function renderSegment(segment: DtsValueSegment): string {
  if (segment.kind === "string") return `"${segment.value}"`;
  return renderCellsValue(segment.bits, [segment.cells]);
}

function renderCellsValue(bits: CellWidth, groups: DtsCell[][]): string {
  const prefix = bits === 32 ? "" : `/bits/ ${bits} `;
  const body = groups.map((group) => `<${group.map(renderCell).join(" ")}>`).join(",");
  return `${prefix}${body}`;
}

function renderCell(cell: DtsCell): string {
  return cell.kind === "phandle" ? `&${cell.label}` : cell.raw;
}

interface StringItem {
  type: "string";
  raw: string;
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
  const items: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;

  for (let i = 0; i < rawText.length; i += 1) {
    const ch = rawText[i];
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
    if (ch === "<") {
      depth += 1;
      continue;
    }
    if (ch === ">") {
      depth -= 1;
      continue;
    }
    if (ch === "," && depth === 0) {
      items.push(rawText.slice(start, i));
      start = i + 1;
    }
  }
  items.push(rawText.slice(start));
  return items;
}

const STRING_RE = /^"((?:\\.|[^"\\])*)"$/;
const BITS_GROUP_RE = /^\/bits\/\s+(\d+)\s+<([^>]*)>$/;

function parseTopLevelItem(itemRawWithWhitespace: string): ParsedItem {
  const trimmed = itemRawWithWhitespace.trim();

  const stringMatch = STRING_RE.exec(trimmed);
  if (stringMatch) {
    return { type: "string", raw: trimmed, value: stringMatch[1] };
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

const CELL_TOKEN_RE = /&[A-Za-z_][A-Za-z0-9_]*|-?0[xX][0-9A-Fa-f]+|-?\d+/g;

function parseCellsGroup(inner: string, width: CellWidth): DtsCell[] {
  const tokens = inner.match(CELL_TOKEN_RE) ?? [];
  return tokens.map((token) => parseCellToken(token, width));
}

function parseCellToken(token: string, width: CellWidth): DtsCell {
  if (token.startsWith("&")) {
    return { kind: "phandle", label: token.slice(1) };
  }

  const negative = token.startsWith("-");
  const magnitudeText = negative ? token.slice(1) : token;
  const magnitude = BigInt(magnitudeText);
  const signedValue = negative ? -magnitude : magnitude;

  const maxUnsigned = (1n << BigInt(width)) - 1n;
  const minSigned = -(1n << BigInt(width - 1));
  if (signedValue > maxUnsigned || signedValue < minSigned) {
    throw new RangeError(`Integer literal "${token}" overflows a ${width}-bit cell`);
  }

  return { kind: "integer", raw: token, value: signedValue.toString() };
}

function combineItems(items: ParsedItem[]): DtsValue {
  if (items.every((item): item is StringItem => item.type === "string")) {
    return { kind: "strings", values: items.map((item) => item.value) };
  }

  if (items.every((item): item is CellsItem => item.type === "cells")) {
    const bits = items[0].bits;
    if (items.every((item) => item.bits === bits)) {
      return { kind: "cells", bits, groups: items.map((item) => item.cells) };
    }
  }

  const segments: DtsValueSegment[] = items.map((item) =>
    item.type === "string"
      ? { kind: "string", raw: `"${item.value}"`, value: item.value }
      : { kind: "cells", bits: item.bits, cells: item.cells },
  );
  return { kind: "mixed", segments };
}

function isByteLiteral(trimmed: string): boolean {
  return /^\[[0-9A-Fa-f\s]+\]$/.test(trimmed);
}

function parseByteLiteral(trimmed: string): DtsValue {
  const inner = trimmed.slice(1, -1);
  const values = (inner.match(/[0-9A-Fa-f]{2}/g) ?? []).map((hex) => Number.parseInt(hex, 16));
  return { kind: "bytes", values };
}
