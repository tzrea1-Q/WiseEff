import { parseDtsValue } from "@/domain/parameter-topology/parseDtsValue";

export type ValueShapeKind =
  | "unknown"
  | "bool"
  | "empty"
  | "string"
  | "string-list"
  | "cells"
  | "phandle-list"
  | "u32-array"
  | "bytes"
  | "mixed";

export const VALUE_SHAPE_OPTIONS: Array<{ value: ValueShapeKind; label: string }> = [
  { value: "unknown", label: "unknown（草稿可后补）" },
  { value: "bool", label: "bool" },
  { value: "empty", label: "empty" },
  { value: "string", label: "string" },
  { value: "string-list", label: "string-list" },
  { value: "cells", label: "cells" },
  { value: "phandle-list", label: "phandle-list" },
  { value: "u32-array", label: "u32-array" },
  { value: "bytes", label: "bytes" },
  { value: "mixed", label: "mixed" },
];

const KIND_SET = new Set<string>(VALUE_SHAPE_OPTIONS.map((option) => option.value));

export function coerceValueShapeKind(raw: unknown): ValueShapeKind {
  if (typeof raw === "string" && KIND_SET.has(raw)) {
    return raw as ValueShapeKind;
  }
  return "unknown";
}

export function needsCellFields(kind: ValueShapeKind): boolean {
  return kind === "cells" || kind === "phandle-list" || kind === "u32-array";
}

export type ValueShapeFieldState = {
  kind: ValueShapeKind;
  /** null = absent in the stored/emitted shape (edit mode must preserve absence). */
  bits: number | null;
  /**
   * Row count observed when the shape was inferred. Not authored, not enforced, and not
   * shown in the editor; carried through so saving a stored shape does not drop it.
   */
  groups: number | null;
  /** null = column width intentionally unconstrained (variable rows and/or columns). */
  cellsPerGroup: number | null;
  bytesLength: number | null;
};

/** Read a stored shape without inventing missing numeric keys (SE-23). */
export function shapeStateFromValue(shape: Record<string, unknown> | null | undefined): ValueShapeFieldState {
  const kind = coerceValueShapeKind(shape?.kind);
  return {
    kind,
    bits: typeof shape?.bits === "number" && Number.isFinite(shape.bits) ? shape.bits : null,
    groups: typeof shape?.groups === "number" && Number.isFinite(shape.groups) ? shape.groups : null,
    cellsPerGroup:
      typeof shape?.cellsPerGroup === "number" && Number.isFinite(shape.cellsPerGroup)
        ? shape.cellsPerGroup
        : typeof shape?.cells === "number" && Number.isFinite(shape.cells)
          ? shape.cells
          : null,
    bytesLength: typeof shape?.length === "number" && Number.isFinite(shape.length) ? shape.length : null,
  };
}

/**
 * Build a valueShape object.
 * - create: always emit the numeric fields the kind needs (defaults applied).
 * - edit: only emit keys the state actually holds, so incomplete legacy shapes round-trip.
 */
export function valueFromShapeState(
  state: ValueShapeFieldState,
  mode: "create" | "edit",
): Record<string, unknown> {
  const kind = state.kind;
  if (needsCellFields(kind)) {
    if (mode === "create") {
      return {
        kind,
        bits: kind === "u32-array" ? 32 : (state.bits ?? 32),
        ...(state.cellsPerGroup != null ? { cellsPerGroup: state.cellsPerGroup } : {}),
      };
    }
    const next: Record<string, unknown> = { kind };
    const bits = kind === "u32-array" ? 32 : state.bits;
    if (kind === "u32-array") {
      // u32-array always pins bits=32 when the user is editing cell fields;
      // only emit it if other cell fields are present or bits was already stored.
      if (state.bits != null || state.groups != null || state.cellsPerGroup != null) {
        next.bits = 32;
      }
    } else if (bits != null) {
      next.bits = bits;
    }
    if (state.groups != null) next.groups = state.groups;
    if (state.cellsPerGroup != null) next.cellsPerGroup = state.cellsPerGroup;
    return next;
  }
  if (kind === "bytes") {
    if (mode === "create") {
      return { kind, length: state.bytesLength ?? 0 };
    }
    const next: Record<string, unknown> = { kind };
    if (state.bytesLength != null) next.length = state.bytesLength;
    return next;
  }
  return { kind };
}

/** Defaults applied when the operator deliberately changes kind in the editor. */
export function shapeStateForNewKind(kind: ValueShapeKind): ValueShapeFieldState {
  if (needsCellFields(kind)) {
    // Column width is left undecided rather than guessed at 1; the example value infers it.
    return {
      kind,
      bits: 32,
      groups: null,
      cellsPerGroup: null,
      bytesLength: null,
    };
  }
  if (kind === "bytes") {
    return { kind, bits: null, groups: null, cellsPerGroup: null, bytesLength: 1 };
  }
  return { kind, bits: null, groups: null, cellsPerGroup: null, bytesLength: null };
}

/**
 * `cells: null` is an explicit decision ("column width is variable, do not enforce it"),
 * which is what keeps a spec activatable and resolvable without inventing a width.
 * An absent `cells` key means nobody decided and stays fail-closed server-side.
 */
export function defaultConstraintsForShape(shape: Record<string, unknown>): Record<string, unknown> {
  const kind = String(shape.kind ?? "");
  if (kind === "cells" || kind === "u32-array" || kind === "phandle-list") {
    const cells =
      typeof shape.cellsPerGroup === "number" && Number.isInteger(shape.cellsPerGroup)
        ? shape.cellsPerGroup
        : typeof shape.cells === "number" && Number.isInteger(shape.cells)
          ? shape.cells
          : null;
    return { cells };
  }
  if (kind === "bytes" && typeof shape.length === "number" && Number.isFinite(shape.length)) {
    return { minLength: shape.length, maxLength: shape.length };
  }
  return {};
}

export function parseOptionalJson(
  raw: string,
  label: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch {
    return { ok: false, error: `${label} 不是合法 JSON。` };
  }
}

export function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

export type InferCellFieldsResult =
  | { ok: true; bits: number; cellsPerGroup: number }
  | { ok: false; error: string };

/**
 * Infer bits and column width from an illustrative example (DTS RHS or JSON array).
 * Used when the operator changes the example or switches into a cell kind.
 * Row count is not inferred: one example cannot tell a fixed row count from a variable one.
 * Does not invent fields on dialog open/save (SE-23).
 */
export function inferCellFieldsFromExample(
  raw: string,
  propertyKey = "property",
): InferCellFieldsResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "请先填写示例值，再推断 cellsPerGroup。" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return { ok: true, bits: 32, cellsPerGroup: parsed.length };
    }
    if (typeof parsed === "string") {
      return inferCellFieldsFromDtsRaw(parsed, propertyKey);
    }
  } catch {
    // Not JSON — fall through to DTS parse.
  }

  return inferCellFieldsFromDtsRaw(trimmed, propertyKey);
}

function inferCellFieldsFromDtsRaw(raw: string, propertyKey: string): InferCellFieldsResult {
  try {
    const { value } = parseDtsValue(propertyKey, raw);
    if (value.kind !== "cells") {
      return {
        ok: false,
        error: "示例值不是 cell / phandle 数组，无法推断 cellsPerGroup。",
      };
    }
    const cellsPerGroup = value.groups[0]?.length ?? 0;
    if (
      value.groups.length < 1 ||
      cellsPerGroup < 1 ||
      value.groups.some((group) => group.length !== cellsPerGroup)
    ) {
      return {
        ok: false,
        error: "示例值各组 cell 数不一致，无法推断统一的 cellsPerGroup；请留空表示列宽不约束。",
      };
    }
    return { ok: true, bits: value.bits, cellsPerGroup };
  } catch {
    return {
      ok: false,
      error: "无法解析示例值。请使用 DTS 写法如 <&gpio13 29 0>，或 JSON 数组 [1,2,3]。",
    };
  }
}
