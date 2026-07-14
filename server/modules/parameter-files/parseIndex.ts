import { parseDts, resolveDts } from "../dts";
import type { ParsedIndex } from "./types";
import { derivedParsedIndexFromResolved } from "./structuralIngest";

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

/** Derive a flat path→normalizedValue index from the merged DTS node model. */
export function buildDtsParsedIndex(source: string): ParsedIndex {
  const resolved = resolveDts(parseDts(source));
  return derivedParsedIndexFromResolved(resolved);
}
