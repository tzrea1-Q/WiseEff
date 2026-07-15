import { parseDts, resolveDts, type ResolvedDts } from "../dts";
import type { ParsedIndex } from "./types";

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

export function derivedParsedIndexFromResolved(resolved: ResolvedDts): ParsedIndex {
  const index: ParsedIndex = {};
  for (const node of resolved.nodes) {
    for (const prop of node.properties) {
      const key = node.nodePath ? `${node.nodePath}/${prop.name}` : prop.name;
      index[key] = { value: prop.normalizedValue };
    }
  }
  return index;
}

/** Derive a flat path→normalizedValue index from the merged DTS node model. */
export function buildDtsParsedIndex(source: string): ParsedIndex {
  const resolved = resolveDts(parseDts(source));
  return derivedParsedIndexFromResolved(resolved);
}
