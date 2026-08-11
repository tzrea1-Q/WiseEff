import { parseDtsValue } from "../dts";
import type { ReloadCandidateBlockReason, ReloadCandidateDto } from "./types";

/**
 * A synthesised dangling-label anchor is a single root segment with no unit address
 * (shape `/label`). Real hardware nodes usually carry `@unit`; descendants hanging under
 * a synthesised parent (e.g. `/amba/i2c@…`) keep multi-segment absolute paths and stay
 * debuggable — only the parameter's *own* locator being that synthesised shape is refused.
 */
export function isSynthesisedAnchorLocator(nodePath: string | null | undefined): boolean {
  if (!nodePath) return false;
  return /^\/[A-Za-z_][\w-]*$/.test(nodePath);
}

export type CandidateValueShape = {
  kind?: string;
  bits?: number;
  cellsPerGroup?: number;
  groups?: number;
} | null;

function isU32CellFamilyKind(kind: string | undefined): boolean {
  return kind === "cells" || kind === "u32-array";
}

/**
 * Infer a uniform cells-per-group width from a library baseline u32 matrix.
 * Returns null when the baseline is missing, unparsable, empty, or irregular.
 */
export function inferCellsPerGroupFromBaseline(baselineValue: string | null | undefined): number | null {
  if (!baselineValue || baselineValue.trim().length === 0) return null;
  try {
    const parsed = parseDtsValue("reload-baseline", baselineValue.trim()).value;
    if (parsed.kind !== "cells" || parsed.bits !== 32 || parsed.groups.length === 0) return null;
    const widths = parsed.groups.map((group) => group.length);
    if (widths.some((width) => width < 1)) return null;
    const first = widths[0]!;
    if (widths.some((width) => width !== first)) return null;
    return first;
  } catch {
    return null;
  }
}

/**
 * Normalize catalog shapes onto the reload surface vocabulary.
 * Spec/DTS layers use `u32-array`; reload AST uses `cells`. Incomplete shapes may borrow
 * `cellsPerGroup` (and default bits=32 for u32-array) from a regular baseline matrix.
 */
export function resolveReloadValueShape(
  valueShape: CandidateValueShape,
  baselineValue: string | null | undefined
): CandidateValueShape {
  if (!valueShape || typeof valueShape !== "object") return null;
  if (valueShape.kind === "string-list") {
    return { kind: "string-list" };
  }
  if (!isU32CellFamilyKind(valueShape.kind)) {
    return valueShape;
  }

  const bits =
    typeof valueShape.bits === "number" && Number.isInteger(valueShape.bits)
      ? valueShape.bits
      : valueShape.kind === "u32-array"
        ? 32
        : undefined;

  let cellsPerGroup =
    typeof valueShape.cellsPerGroup === "number" &&
    Number.isInteger(valueShape.cellsPerGroup) &&
    valueShape.cellsPerGroup >= 1
      ? valueShape.cellsPerGroup
      : undefined;

  if (cellsPerGroup === undefined) {
    const inferred = inferCellsPerGroupFromBaseline(baselineValue);
    if (inferred !== null) cellsPerGroup = inferred;
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
  }

  return resolved;
}

/**
 * Supported reload shapes for this surface: unsigned 32-bit cell arrays (catalog `cells` or
 * `u32-array`, any cell count / group count once bits=32 and cellsPerGroup are known) and
 * string lists. Booleans, empty properties, byte arrays, phandle lists, and mixed values stay refused.
 *
 * Callers should pass a shape already run through `resolveReloadValueShape` when baseline
 * inference is needed for incomplete catalog metadata.
 */
export function isSupportedReloadValueShape(valueShape: CandidateValueShape): boolean {
  if (!valueShape || typeof valueShape !== "object") return false;
  if (valueShape.kind === "string-list") return true;
  if (!isU32CellFamilyKind(valueShape.kind)) return false;
  const bits = valueShape.bits ?? (valueShape.kind === "u32-array" ? 32 : undefined);
  if (bits !== 32) return false;
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
  if (isSynthesisedAnchorLocator(input.nodePath)) {
    return "synthesised-anchor";
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
