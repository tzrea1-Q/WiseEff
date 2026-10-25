/**
 * Frontend parser for typed binding draft payloads.
 * Mirrors server `parseDtsValue` for the forms used by the topology editor.
 */
import type { DtsCell, DtsValue, DtsValueSegment } from "./types";
import { dtsReferencePath } from "../dts/reference";

type CellWidth = 8 | 16 | 32 | 64;

const VALID_WIDTHS: ReadonlySet<number> = new Set([8, 16, 32, 64]);
const EMPTY_PROPERTY_NAMES = new Set(["ranges", "dma-ranges"]);

export type DtsValueParseResult = {
  value: DtsValue;
  rawText: string;
};

export function parseDtsValue(propertyName: string, rawText: string): DtsValueParseResult {
  if (rawText.trim() === "") {
    return {
      value: EMPTY_PROPERTY_NAMES.has(propertyName) ? { kind: "empty" } : { kind: "boolean", present: true },
      rawText
    };
  }

  const trimmed = rawText.trim();
  if (trimmed.startsWith("[")) {
    return { value: parseByteLiteral(trimmed), rawText };
  }

  const items = splitTopLevelItems(rawText).map(parseTopLevelItem);
  return { value: combineItems(items), rawText };
}

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
      if (depth > 1) throw new SyntaxError("Nested DTS cell groups are not supported");
      continue;
    }
    if (ch === ">") {
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
  if (depth !== 0) throw new SyntaxError("Unterminated DTS cell group");
  items.push(rawText.slice(start));
  return items;
}

const STRING_RE = /^"((?:\\.|[^"\\])*)"$/;
const BITS_GROUP_RE = /^\/bits\/\s+(\d+)\s+<([^>]*)>$/;

type StringItem = { type: "string"; raw: string; sourceRaw: string; value: string };
type CellsItem = { type: "cells"; bits: CellWidth; cells: DtsCell[] };
type ParsedItem = StringItem | CellsItem;

function parseTopLevelItem(itemRawWithWhitespace: string): ParsedItem {
  const trimmed = itemRawWithWhitespace.trim();

  const stringMatch = STRING_RE.exec(trimmed);
  if (stringMatch) {
    return { type: "string", raw: trimmed, sourceRaw: itemRawWithWhitespace, value: stringMatch[1]! };
  }

  const bitsMatch = BITS_GROUP_RE.exec(trimmed);
  if (bitsMatch) {
    const width = Number(bitsMatch[1]);
    if (!VALID_WIDTHS.has(width)) {
      throw new RangeError(`Unsupported /bits/ width: ${bitsMatch[1]}`);
    }
    const bits = width as CellWidth;
    return { type: "cells", bits, cells: parseCellsGroup(bitsMatch[2]!, bits) };
  }

  if (/^<[^<>]*>$/.test(trimmed)) {
    return { type: "cells", bits: 32, cells: parseCellsGroup(trimmed.slice(1, -1), 32) };
  }

  throw new Error(`Unrecognized DTS value token: "${trimmed}"`);
}

const CELL_TOKEN_RE = /&\s*\{[^{}]*\}|&[A-Za-z_][A-Za-z0-9_]*|\(-(?:0[xX][0-9A-Fa-f]+|\d+)\)|-?0[xX][0-9A-Fa-f]+|-?\d+/g;

function parseCellsGroup(inner: string, width: CellWidth): DtsCell[] {
  const cells: DtsCell[] = [];
  let cursor = 0;
  for (const match of inner.matchAll(CELL_TOKEN_RE)) {
    const start = match.index!;
    if (inner.slice(cursor, start).trim() !== "" || (cursor > 0 && start === cursor)) {
      throw new SyntaxError(`Invalid DTS cell token at position ${cursor + 1}`);
    }
    cells.push(parseCellToken(match[0], width));
    cursor = start + match[0].length;
  }
  if (inner.slice(cursor).trim() !== "") {
    throw new SyntaxError(`Invalid DTS cell token at position ${cursor + 1}`);
  }
  return cells;
}

function parseCellToken(token: string, width: CellWidth): DtsCell {
  if (token.startsWith("&")) {
    const raw=token.slice(1).trim(),label=raw.startsWith("{")?`{${raw.slice(1,-1).trim()}}`:raw;
    dtsReferencePath(label);
    return { kind: "phandle", label };
  }

  const bare = token.startsWith("(") && token.endsWith(")") ? token.slice(1, -1) : token;
  const negative = bare.startsWith("-");
  const magnitudeText = negative ? bare.slice(1) : bare;
  const magnitude = BigInt(magnitudeText);
  const signedValue = negative ? -magnitude : magnitude;

  const maxUnsigned = (1n << BigInt(width)) - 1n;
  const minSigned = -(1n << BigInt(width - 1));
  if (signedValue > maxUnsigned || signedValue < minSigned) {
    throw new RangeError(`Integer literal "${token}" overflows a ${width}-bit cell`);
  }

  // Canonical raw keeps the signed literal without required parentheses; renderCell adds them.
  return { kind: "integer", raw: bare, value: signedValue.toString() };
}

function combineItems(items: ParsedItem[]): DtsValue {
  if (items.every((item): item is StringItem => item.type === "string")) {
    return {
      kind: "strings",
      values: items.map((item) => item.value),
      items: items.map((item) => ({ value: item.value, raw: item.sourceRaw }))
    };
  }

  if (items.every((item): item is CellsItem => item.type === "cells")) {
    const bits = items[0]!.bits;
    if (items.every((item) => item.bits === bits)) {
      return { kind: "cells", bits, groups: items.map((item) => item.cells) };
    }
  }

  const segments: DtsValueSegment[] = items.map((item) =>
    item.type === "string"
      ? { kind: "string", raw: item.raw, value: item.value }
      : { kind: "cells", bits: item.bits, cells: item.cells }
  );
  return { kind: "mixed", segments };
}

function parseByteLiteral(trimmed: string): DtsValue {
  if (!/^\[(?:\s*[0-9A-Fa-f]{2})*\s*\]$/.test(trimmed)) {
    throw new SyntaxError("Byte arrays require complete pairs of hexadecimal digits: [00 ff …]");
  }
  const inner = trimmed.slice(1, -1);
  const values = (inner.match(/[0-9A-Fa-f]{2}/g) ?? []).map((hex) => Number.parseInt(hex, 16));
  return { kind: "bytes", values };
}
