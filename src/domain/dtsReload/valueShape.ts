/**
 * Reload value shape — shared vocabulary for DTS reload debugging value shapes.
 *
 * A resolved reload value shape (CONTEXT.md "Reload value shape") is the normalized
 * vocabulary a debug value must conform to. Families: integer cell arrays at
 * `/bits/` 8|16|32, GPIO-style phandle cell arrays, bare phandle lists, single strings,
 * string lists, booleans, empty properties, mixed string+cell values, and explicit
 * property deletion (`/delete-property/`). Encodings are never guessed.
 *
 * This file is pure vocabulary plus authoring expectations: family predicates, the
 * structural support check, authoring issue codes, and per-family authoring examples.
 * It must stay free of parser dependencies so frontend and server share one copy
 * (server re-exports it from `server/modules/dts-reload/valueShape.ts`, the same
 * pattern as `parameter-modules/modulePlacement.ts`). The parsing engine — baseline
 * inference, authored-value validation, read-back coercion, canonicalization — needs
 * the real DTS value parser and lives server-side in that engine file.
 */

/** Catalog-side shape input as stored on parameter definitions — not yet normalized. */
export type CandidateValueShape = {
  kind?: string;
  bits?: number;
  cellsPerGroup?: number;
  groups?: number;
  /** Present on some catalog `bytes` inferences; treated as a single-group cell count. */
  length?: number;
} | null;

/**
 * A shape after `resolveReloadValueShape` normalized it onto the reload vocabulary.
 * Structurally identical to `CandidateValueShape`; the name states that resolution has run.
 */
export type ReloadValueShape = CandidateValueShape;

export type SupportedCellBits = 8 | 16 | 32;

/** Exact overlay token for property deletion. Never inferred from an empty RHS. */
export const RELOAD_DELETE_PROPERTY_TOKEN = "/delete-property/";

const SUPPORTED_CELL_BITS = new Set([8, 16, 32]);

export function isSupportedCellBits(bits: number | undefined): bits is SupportedCellBits {
  return typeof bits === "number" && SUPPORTED_CELL_BITS.has(bits);
}

export function isIntegerCellFamilyKind(kind: string | null | undefined): boolean {
  return kind === "cells" || kind === "u32-array" || kind === "bytes";
}

export function isPhandleCellFamilyKind(kind: string | null | undefined): boolean {
  return kind === "mixed" || kind === "phandle-list" || kind === "phandle-cells";
}

export function isReloadDeletePropertyToken(raw: string): boolean {
  return raw.trim() === RELOAD_DELETE_PROPERTY_TOKEN;
}

/**
 * Supported reload shapes: integer cell arrays at bits 8/16/32 (including catalog `bytes`
 * authored as `/bits/ 8 <…>`), single strings, string lists, GPIO-style phandle cell arrays,
 * bare phandle lists, booleans, empty properties, mixed values, and explicit deletion.
 * Purely structural — expects a resolved shape and never parses values.
 */
export function isSupportedReloadValueShape(valueShape: ReloadValueShape): boolean {
  if (!valueShape || typeof valueShape !== "object") return false;
  if (
    valueShape.kind === "string-list" ||
    valueShape.kind === "string" ||
    valueShape.kind === "boolean" ||
    valueShape.kind === "empty" ||
    valueShape.kind === "mixed" ||
    valueShape.kind === "delete"
  ) {
    return true;
  }

  if (valueShape.kind === "phandle-list") {
    if (valueShape.bits !== undefined && valueShape.bits !== 32) return false;
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

/**
 * Why an authored debug value does not conform to its resolved shape.
 * Pure data — the server edge maps issues onto `ApiError` English messages and the
 * frontend edge maps them onto Chinese copy, so the rules live in exactly one place.
 *
 * Per-width unsigned overflow needs no code here: the DTS value parser refuses
 * `Integer literal "…" overflows a N-bit cell` at parse time (signed minima wrap like
 * dtc), so oversized cells surface as `unparsable` with that message.
 */
export type ReloadAuthoringIssue =
  | { reason: "unparsable"; message: string }
  | { reason: "not-single-string" }
  | { reason: "not-string-list" }
  | { reason: "not-phandle-cell-array" }
  | { reason: "not-phandle-list" }
  | { reason: "not-mixed" }
  | { reason: "not-boolean" }
  | { reason: "not-empty" }
  | { reason: "not-integer-cell-array"; expectedBits: SupportedCellBits }
  | {
      reason: "cells-per-group-mismatch";
      expectedCellsPerGroup: number;
      actualCellsPerGroup: number[];
    }
  | { reason: "group-count-mismatch"; expectedGroups: number; actualGroups: number };

export type ReloadValueShapeAuthoringExpectation = {
  /**
   * Canonical, language-neutral example token for a resolved shape. Used verbatim as the
   * debug-value input placeholder and embedded in each edge's own prose ("for example X" /
   * "例如 X"), so the example lives in one place while the sentence wrapping stays local.
   */
  placeholder: string;
};

/** Single source for the example token both runtimes show for a resolved shape. */
export function describeReloadValueShapeAuthoring(
  valueShape: ReloadValueShape
): ReloadValueShapeAuthoringExpectation {
  if (valueShape?.kind === "string") {
    return { placeholder: '"bat0_raw_temp"' };
  }
  if (valueShape?.kind === "string-list") {
    return { placeholder: '"okay"' };
  }
  if (valueShape?.kind === "boolean") {
    return { placeholder: "true" };
  }
  if (valueShape?.kind === "empty") {
    return { placeholder: "" };
  }
  if (valueShape?.kind === "delete") {
    return { placeholder: RELOAD_DELETE_PROPERTY_TOKEN };
  }
  if (valueShape?.kind === "mixed") {
    return { placeholder: '"name", <1 0>' };
  }
  if (valueShape?.kind === "phandle-list") {
    return { placeholder: "<&gic>" };
  }
  if (valueShape?.kind === "phandle-cells" || isPhandleCellFamilyKind(valueShape?.kind)) {
    return { placeholder: "<&gpio13 29 0>" };
  }
  const bits = isSupportedCellBits(valueShape?.bits) ? valueShape!.bits! : 32;
  if (bits !== 32) {
    return { placeholder: `/bits/ ${bits} <17>` };
  }
  return { placeholder: "<7000>" };
}
