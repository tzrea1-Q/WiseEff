export type NumericStructuredEditorState = {
  kind: "cells" | "bytes";
  groups: string[][];
  bits: 8 | 16 | 32 | 64;
};

/** Unfinished or unconfirmed inputs that must not yet replace a DTS value. */
export type StructuredEditorState = NumericStructuredEditorState | {
  kind: "string-input";
  format: "lines";
  text: string;
} | {
  kind: "numeric-input";
  text: string;
  source: NumericStructuredEditorState;
  format?: "dts" | "table";
};

export function readStructuredEditorState(value: unknown): StructuredEditorState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (state.kind === "string-input") {
    if (Object.keys(state).length !== 3 || !["kind", "format", "text"].every((key) => Object.hasOwn(state, key))) return null;
    if (state.format !== "lines" || typeof state.text !== "string") return null;
    return { kind: "string-input", format: "lines", text: state.text };
  }
  if (state.kind === "numeric-input") {
    const hasFormat = Object.hasOwn(state, "format");
    if (Object.keys(state).length !== (hasFormat ? 4 : 3) || !["kind", "text", "source"].every((key) => Object.hasOwn(state, key))) return null;
    if (typeof state.text !== "string") return null;
    if (hasFormat && state.format !== "dts" && state.format !== "table") return null;
    const source = readNumericState(state.source);
    return source ? { kind: "numeric-input", text: state.text, source,
      ...(hasFormat ? { format: state.format as "dts" | "table" } : {}) } : null;
  }
  return readNumericState(state);
}

function readNumericState(value: unknown): NumericStructuredEditorState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const state = value as Record<string, unknown>;
  if (Object.keys(state).length !== 3 || !["kind", "groups", "bits"].every((key) => Object.hasOwn(state, key))) return null;
  if (state.kind !== "cells" && state.kind !== "bytes") return null;
  if (state.bits !== 8 && state.bits !== 16 && state.bits !== 32 && state.bits !== 64) return null;
  if (!Array.isArray(state.groups) || state.groups.length === 0) return null;
  const groups: string[][] = [];
  for (const group of state.groups) {
    if (!Array.isArray(group)) return null;
    const tokens: string[] = [];
    for (const token of group) {
      if (typeof token !== "string") return null;
      tokens.push(token);
    }
    groups.push(tokens);
  }
  return { kind: state.kind, groups, bits: state.bits };
}

export function sameStructuredEditorState(
  left: StructuredEditorState | undefined,
  right: StructuredEditorState | undefined
): boolean {
  if (!left || !right) return left === right;
  if (left.kind === "string-input") {
    return right.kind === "string-input" && left.format === right.format && left.text === right.text;
  }
  if (right.kind === "string-input") return false;
  if (left.kind === "numeric-input") {
    return right.kind === "numeric-input" && left.text === right.text
      && (left.format ?? "dts") === (right.format ?? "dts")
      && sameStructuredEditorState(left.source, right.source);
  }
  if (right.kind === "numeric-input") return false;
  return left.kind === right.kind && left.bits === right.bits && left.groups.length === right.groups.length
    && left.groups.every((group, index) => group.length === right.groups[index]!.length
      && group.every((token, tokenIndex) => token === right.groups[index]![tokenIndex]));
}
