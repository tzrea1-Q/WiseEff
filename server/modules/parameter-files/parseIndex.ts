import { stripDtsComments } from "./preprocess";
import type { ParsedIndex } from "./types";

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

function stringifyLeaf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function walkJson(value: unknown, path: string[], index: ParsedIndex): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      walkJson(child, [...path, key], index);
    }
    return;
  }
  if (path.length === 0) {
    return;
  }
  index[path.join("/")] = { value: stringifyLeaf(value) };
}

export function buildJsonParsedIndex(source: string): ParsedIndex {
  const root = JSON.parse(source) as unknown;
  const index: ParsedIndex = {};
  walkJson(root, [], index);
  return index;
}

function parseDtsProperties(source: string, pathPrefix: string[] = []): ParsedIndex {
  const index: ParsedIndex = {};
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

    if (source[cursor] === "{") {
      const block = readBalanced(source, cursor, "{", "}");
      const nested = parseDtsProperties(source.slice(cursor + 1, block.end - 1), [...pathPrefix, identifier.name]);
      Object.assign(index, nested);
      i = block.end;
      continue;
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

    index[[...pathPrefix, identifier.name].join("/")] = { value: valueResult.value };
    i = cursor;
  }

  return index;
}

export function buildDtsParsedIndex(source: string): ParsedIndex {
  return parseDtsProperties(stripDtsComments(source));
}
