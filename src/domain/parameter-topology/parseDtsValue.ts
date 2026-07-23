/**
 * Frontend parser for typed binding draft payloads.
 * Mirrors server `parseDtsValue` for the forms used by the topology editor.
 */
import type { DtsCell, DtsValue, DtsValueSegment } from "./types";

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
  if (isByteLiteral(trimmed)) {
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

  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return { type: "cells", bits: 32, cells: parseCellsGroup(trimmed.slice(1, -1), 32) };
  }

  throw new Error(`Unrecognized DTS value token: "${trimmed}"`);
}

const CELL_TOKEN_RE = /&[A-Za-z_][A-Za-z0-9_]*|\(-(?:0[xX][0-9A-Fa-f]+|\d+)\)|-?0[xX][0-9A-Fa-f]+|-?\d+/g;

function parseCellsGroup(inner: string, width: CellWidth): DtsCell[] {
  const tokens = inner.match(CELL_TOKEN_RE) ?? [];
  return tokens.map((token) => parseCellToken(token, width));
}

function parseCellToken(token: string, width: CellWidth): DtsCell {
  if (token.startsWith("&")) {
    return { kind: "phandle", label: token.slice(1) };
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

function isByteLiteral(trimmed: string): boolean {
  return /^\[[0-9A-Fa-f\s]+\]$/.test(trimmed);
}

function parseByteLiteral(trimmed: string): DtsValue {
  const inner = trimmed.slice(1, -1);
  const values = (inner.match(/[0-9A-Fa-f]{2}/g) ?? []).map((hex) => Number.parseInt(hex, 16));
  return { kind: "bytes", values };
}
