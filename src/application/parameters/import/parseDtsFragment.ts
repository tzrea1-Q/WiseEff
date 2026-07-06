import { normalizeRow } from "./normalizeRow";
import type { ParsedImportRow } from "./types";

const IDENTIFIER_PATTERN = /[a-zA-Z0-9_-]+/;

function readBalanced(source: string, start: number, open: string, close: string): { value: string; end: number } {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return { value: source.slice(start, i + 1).trim(), end: i + 1 };
      }
    }
    i += 1;
  }
  return { value: source.slice(start).trim(), end: source.length };
}

function readUntilSemicolon(source: string, start: number): { value: string; end: number } {
  let i = start;
  let inString: string | null = null;
  while (i < source.length) {
    const ch = source[i];
    if (inString) {
      if (ch === inString && source[i - 1] !== "\\") {
        inString = null;
      }
    } else if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === ";") {
      return { value: source.slice(start, i).trim(), end: i + 1 };
    }
    i += 1;
  }
  return { value: source.slice(start).trim(), end: source.length };
}

function readPropertyValue(source: string, start: number): { value: string; end: number } | null {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) {
    i += 1;
  }
  if (i >= source.length) {
    return null;
  }

  const ch = source[i];
  if (ch === "<") {
    return readBalanced(source, i, "<", ">");
  }
  if (ch === "{") {
    return readBalanced(source, i, "{", "}");
  }
  return readUntilSemicolon(source, i);
}

function readIdentifier(source: string, start: number): { name: string; end: number } | null {
  let i = start;
  while (i < source.length && /\s/.test(source[i])) {
    i += 1;
  }

  const match = source.slice(i).match(new RegExp(`^(${IDENTIFIER_PATTERN.source})`));
  if (!match) {
    return null;
  }

  return { name: match[1], end: i + match[1].length };
}

export function parseDtsFragmentImport(source: string): ParsedImportRow[] {
  const rows: ParsedImportRow[] = [];
  let i = 0;

  while (i < source.length) {
    const identifier = readIdentifier(source, i);
    if (!identifier) {
      i += 1;
      continue;
    }

    let cursor = identifier.end;
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1;
    }
    if (source[cursor] !== "=") {
      i = identifier.end;
      continue;
    }
    cursor += 1;

    const valueResult = readPropertyValue(source, cursor);
    if (!valueResult) {
      i = cursor;
      continue;
    }

    cursor = valueResult.end;
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1;
    }
    if (source[cursor] === ";") {
      cursor += 1;
    }

    const row = normalizeRow(
      {
        name: identifier.name,
        module: "",
        currentValue: valueResult.value,
        recommendedValue: valueResult.value
      },
      "dts-fragment",
      identifier.name
    );
    if (row) {
      rows.push(row);
    }

    i = cursor;
  }

  return rows;
}
