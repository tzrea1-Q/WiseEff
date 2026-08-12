import { parseDtsValue, type DtsValue } from "../dts";
import type { ReloadCandidateBlockReason, ReloadCandidateDto } from "./types";

export type CandidateValueShape = {
  kind?: string;
  bits?: number;
  cellsPerGroup?: number;
  groups?: number;
  /** Present on some catalog `bytes` inferences; treated as a single-group cell count. */
  length?: number;
} | null;

const SUPPORTED_CELL_BITS = new Set([8, 16, 32]);

function isIntegerCellFamilyKind(kind: string | undefined): boolean {
  return kind === "cells" || kind === "u32-array" || kind === "bytes";
}

function isPhandleCellFamilyKind(kind: string | undefined): boolean {
  return kind === "mixed" || kind === "phandle-list" || kind === "phandle-cells";
}

export function isSupportedCellBits(bits: number | undefined): bits is 8 | 16 | 32 {
  return typeof bits === "number" && SUPPORTED_CELL_BITS.has(bits);
}

/**
 * GPIO / interrupt-style specifier: each group is `&label` followed by one or more integers,
 * with a uniform group width (typically phandle + pin + flags → 3).
 */
export function isPhandleCellArrayValue(value: DtsValue): boolean {
  if (value.kind !== "cells" || value.bits !== 32 || value.groups.length === 0) return false;
  const widths = value.groups.map((group) => group.length);
  const width = widths[0]!;
  if (width < 2) return false;
  if (widths.some((entry) => entry !== width)) return false;
  return value.groups.every((group) => {
    const [head, ...tail] = group;
    return head?.kind === "phandle" && tail.length > 0 && tail.every((cell) => cell.kind === "integer");
  });
}

/**
 * True when a parsed debug/baseline value is an integer-only cell matrix at a supported width,
 * or an 8-bit square-bracket byte array (dtc's decompiled spelling of `/bits/ 8`).
 */
export function isIntegerCellArrayValue(value: DtsValue, bits?: number): boolean {
  if (value.kind === "bytes") {
    if (bits !== undefined && bits !== 8) return false;
    return value.values.length > 0;
  }
  if (value.kind !== "cells" || value.groups.length === 0) return false;
  if (bits !== undefined && value.bits !== bits) return false;
  if (!isSupportedCellBits(value.bits)) return false;
  return value.groups.every(
    (group) => group.length > 0 && group.every((cell) => cell.kind === "integer")
  );
}

type InferredCellBaseline = {
  bits: 8 | 16 | 32;
  cellsPerGroup: number;
  groups: number;
};

/**
 * Infer bit width and uniform cells-per-group from a library baseline.
 * Accepts `/bits/ N <…>` cell matrices and `[xx yy …]` byte arrays (as bits=8).
 * Rejects phandle-prefixed groups.
 */
export function inferIntegerCellBaseline(
  baselineValue: string | null | undefined
): InferredCellBaseline | null {
  if (!baselineValue || baselineValue.trim().length === 0) return null;
  try {
    const parsed = parseDtsValue("reload-baseline", baselineValue.trim()).value;
    if (parsed.kind === "bytes") {
      if (parsed.values.length === 0) return null;
      return { bits: 8, cellsPerGroup: parsed.values.length, groups: 1 };
    }
    if (parsed.kind !== "cells" || !isSupportedCellBits(parsed.bits) || parsed.groups.length === 0) {
      return null;
    }
    if (isPhandleCellArrayValue(parsed)) return null;
    if (!isIntegerCellArrayValue(parsed, parsed.bits)) return null;
    const widths = parsed.groups.map((group) => group.length);
    const first = widths[0]!;
    if (widths.some((width) => width !== first)) return null;
    return { bits: parsed.bits, cellsPerGroup: first, groups: parsed.groups.length };
  } catch {
    return null;
  }
}

/**
 * Infer a uniform cells-per-group width from a library baseline u32 matrix.
 * Returns null when the baseline is missing, unparsable, empty, irregular, or not 32-bit.
 */
export function inferCellsPerGroupFromBaseline(baselineValue: string | null | undefined): number | null {
  const inferred = inferIntegerCellBaseline(baselineValue);
  if (!inferred || inferred.bits !== 32) return null;
  return inferred.cellsPerGroup;
}

/**
 * Infer phandle-cell group width from a GPIO-style baseline such as `<&gpio13 29 0>`.
 */
export function inferPhandleCellsPerGroupFromBaseline(
  baselineValue: string | null | undefined
): number | null {
  if (!baselineValue || baselineValue.trim().length === 0) return null;
  try {
    const parsed = parseDtsValue("reload-baseline", baselineValue.trim()).value;
    if (!isPhandleCellArrayValue(parsed) || parsed.kind !== "cells") return null;
    return parsed.groups[0]!.length;
  } catch {
    return null;
  }
}

/**
 * Normalize catalog shapes onto the reload surface vocabulary.
 * - `u32-array` / `cells` → `cells` (width may be inferred from a regular integer baseline)
 * - catalog `bytes` with `/bits/ 8 <…>` (or `[…]`) baselines → `cells` with bits=8
 * - `mixed` / `phandle-list` that match GPIO-style `<&label N …>` → `phandle-cells`
 * - catalog `string` (single quoted string) stays `string`; `string-list` stays `string-list`
 */
export function resolveReloadValueShape(
  valueShape: CandidateValueShape,
  baselineValue: string | null | undefined
): CandidateValueShape {
  if (!valueShape || typeof valueShape !== "object") return null;
  if (valueShape.kind === "string-list") {
    return { kind: "string-list" };
  }
  if (valueShape.kind === "string") {
    return { kind: "string" };
  }

  if (isPhandleCellFamilyKind(valueShape.kind)) {
    let cellsPerGroup =
      typeof valueShape.cellsPerGroup === "number" &&
      Number.isInteger(valueShape.cellsPerGroup) &&
      valueShape.cellsPerGroup >= 2
        ? valueShape.cellsPerGroup
        : undefined;
    if (cellsPerGroup === undefined) {
      const inferred = inferPhandleCellsPerGroupFromBaseline(baselineValue);
      if (inferred !== null) cellsPerGroup = inferred;
    }
    const resolved: NonNullable<CandidateValueShape> = {
      kind: "phandle-cells",
      bits: 32,
      ...(cellsPerGroup !== undefined ? { cellsPerGroup } : {})
    };
    if (
      typeof valueShape.groups === "number" &&
      Number.isInteger(valueShape.groups) &&
      valueShape.groups >= 1
    ) {
      resolved.groups = valueShape.groups;
    }
    return resolved;
  }

  if (!isIntegerCellFamilyKind(valueShape.kind)) {
    return valueShape;
  }

  const inferred = inferIntegerCellBaseline(baselineValue);

  let bits: number | undefined =
    typeof valueShape.bits === "number" && Number.isInteger(valueShape.bits)
      ? valueShape.bits
      : undefined;
  if (bits === undefined) {
    if (valueShape.kind === "u32-array") bits = 32;
    else if (valueShape.kind === "bytes") bits = inferred?.bits ?? 8;
    else if (inferred) bits = inferred.bits;
  }

  let cellsPerGroup =
    typeof valueShape.cellsPerGroup === "number" &&
    Number.isInteger(valueShape.cellsPerGroup) &&
    valueShape.cellsPerGroup >= 1
      ? valueShape.cellsPerGroup
      : undefined;

  if (
    cellsPerGroup === undefined &&
    typeof valueShape.length === "number" &&
    Number.isInteger(valueShape.length) &&
    valueShape.length >= 1
  ) {
    cellsPerGroup = valueShape.length;
  }

  if (cellsPerGroup === undefined && inferred) {
    cellsPerGroup = inferred.cellsPerGroup;
  }

  const resolved: NonNullable<CandidateValueShape> = {
    kind: "cells",
    ...(bits !== undefined ? { bits } : {}),
    ...(cellsPerGroup !== undefined ? { cellsPerGroup } : {})
  };

  if (
    typeof valueShape.groups === "number" &&
    Number.isInteger(valueShape.groups) &&
    valueShape.groups >= 1
  ) {
    resolved.groups = valueShape.groups;
  } else if (valueShape.kind === "bytes" && cellsPerGroup !== undefined) {
    resolved.groups = 1;
  }

  return resolved;
}

/**
 * Supported reload shapes: integer cell arrays at bits 8/16/32 (including catalog `bytes`
 * authored as `/bits/ 8 <…>`), single strings, string lists, and GPIO-style phandle cell arrays.
 */
export function isSupportedReloadValueShape(valueShape: CandidateValueShape): boolean {
  if (!valueShape || typeof valueShape !== "object") return false;
  if (valueShape.kind === "string-list" || valueShape.kind === "string") return true;

  if (valueShape.kind === "phandle-cells") {
    if (valueShape.bits !== undefined && valueShape.bits !== 32) return false;
    if (
      typeof valueShape.cellsPerGroup !== "number" ||
      !Number.isInteger(valueShape.cellsPerGroup) ||
      valueShape.cellsPerGroup < 2
    ) {
      return false;
    }
    if (
      valueShape.groups !== undefined &&
      (typeof valueShape.groups !== "number" || !Number.isInteger(valueShape.groups) || valueShape.groups < 1)
    ) {
      return false;
    }
    return true;
  }

  if (valueShape.kind !== "cells" && valueShape.kind !== "u32-array") return false;
  const bits = valueShape.bits ?? (valueShape.kind === "u32-array" ? 32 : undefined);
  if (!isSupportedCellBits(bits)) return false;
  if (
    typeof valueShape.cellsPerGroup !== "number" ||
    !Number.isInteger(valueShape.cellsPerGroup) ||
    valueShape.cellsPerGroup < 1
  ) {
    return false;
  }
  if (
    valueShape.groups !== undefined &&
    (typeof valueShape.groups !== "number" || !Number.isInteger(valueShape.groups) || valueShape.groups < 1)
  ) {
    return false;
  }
  return true;
}

export type CandidateClassificationInput = {
  bindingId: string;
  projectId: string;
  propertyKey: string;
  displayName: string;
  module: string;
  moduleId?: string | null;
  nodePath: string | null;
  baselineValue: string | null;
  description?: string | null;
  valueShape: CandidateValueShape;
  valueShapeKind: string | null;
  unit: string | null;
  constraints: Record<string, unknown>;
};

export function classifyReloadCandidate(input: CandidateClassificationInput): ReloadCandidateDto {
  const resolvedShape = resolveReloadValueShape(input.valueShape, input.baselineValue);
  const base = {
    bindingId: input.bindingId,
    projectId: input.projectId,
    propertyKey: input.propertyKey,
    displayName: input.displayName,
    module: input.module,
    moduleId: input.moduleId ?? null,
    nodePath: input.nodePath,
    compatible: null as string | null,
    baselineValue: input.baselineValue,
    description: input.description?.trim() ? input.description.trim() : null,
    // Preserve catalog kind for UI/debug; resolved shape drives debuggability only.
    valueShapeKind: input.valueShapeKind,
    unit: input.unit,
    constraints: input.constraints,
    sensitiveMatch: null as ReloadCandidateDto["sensitiveMatch"],
    lastReload: null as ReloadCandidateDto["lastReload"]
  };

  const blockReason = classifyBlockReason(input, resolvedShape);
  if (blockReason) {
    return { ...base, debuggable: false, blockReason };
  }

  return { ...base, debuggable: true };
}

function classifyBlockReason(
  input: CandidateClassificationInput,
  resolvedShape: CandidateValueShape
): ReloadCandidateBlockReason | undefined {
  if (!input.nodePath || input.nodePath.trim().length === 0) {
    return "no-node-path";
  }
  if (!isSupportedReloadValueShape(resolvedShape)) {
    return "unsupported-value-shape";
  }
  if (input.baselineValue === null || input.baselineValue.trim().length === 0) {
    return "no-baseline-value";
  }
  return undefined;
}

/**
 * Collapse list rows that share the same overlay identity (propertyKey + absolute path).
 * Preference: debuggable > has absolute path > earlier list order (stable).
 * Different absolute paths for the same property stay distinct.
 */
export function normalizeReloadCandidates<T extends ReloadCandidateDto>(items: readonly T[]): T[] {
  const winners = new Map<string, T>();
  const order: string[] = [];

  for (const item of items) {
    const key = `${item.propertyKey}\0${item.nodePath ?? ""}`;
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, item);
      order.push(key);
      continue;
    }
    if (preferCandidate(item, existing)) {
      winners.set(key, item);
    }
  }

  return order.map((key) => winners.get(key)!);
}

function preferCandidate(next: ReloadCandidateDto, current: ReloadCandidateDto): boolean {
  if (next.debuggable !== current.debuggable) return next.debuggable;
  const nextHasPath = Boolean(next.nodePath?.trim());
  const currentHasPath = Boolean(current.nodePath?.trim());
  if (nextHasPath !== currentHasPath) return nextHasPath;
  return false;
}
