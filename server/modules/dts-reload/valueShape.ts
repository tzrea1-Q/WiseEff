/**
 * ReloadValueShape engine — the single server-side home for reload value-shape knowledge.
 *
 * The vocabulary (families, structural support check, authoring issue codes, authoring
 * examples) is shared with the frontend from `src/domain/dtsReload/valueShape.ts` and
 * re-exported below (same pattern as `parameter-modules/modulePlacement.ts` — server
 * cannot import `@/domain`). Everything else in this file needs the real DTS value
 * parser and therefore stays server-side:
 *
 * - `resolveReloadValueShape` — catalog shape + library baseline → resolved reload shape
 * - `validateAuthoredDebugValue` — parse and validate an engineer-authored debug value
 * - `compareReloadDebugValue` — coerce a device read-back and compare under the shape
 * - `canonicalizeReloadValue` — canonical decimal form for dtc-decompile comparison
 *
 * Adding a new value shape means extending this file (plus the shared vocabulary when
 * the family set changes) — not touching start validation, behavioural verification,
 * preflight, and the frontend one by one.
 */
import { parseDtsValue, type DtsValue } from "../dts";
import {
  isPhandleCellFamilyKind,
  isIntegerCellFamilyKind,
  isReloadDeletePropertyToken,
  isSupportedCellBits,
  type CandidateValueShape,
  type ReloadAuthoringIssue,
  type ReloadValueShape,
  type SupportedCellBits
} from "../../../src/domain/dtsReload/valueShape";

export * from "../../../src/domain/dtsReload/valueShape";

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
 * Bare phandle list such as `<&gic>` or `<&a>, <&b>`: every cell is a phandle, no integers.
 * Distinct from GPIO-style `<&label N …>` — never coerce one into the other.
 */
export function isBarePhandleListValue(value: DtsValue): boolean {
  if (value.kind !== "cells" || value.bits !== 32 || value.groups.length === 0) return false;
  const widths = value.groups.map((group) => group.length);
  const width = widths[0]!;
  if (width < 1) return false;
  if (widths.some((entry) => entry !== width)) return false;
  return value.groups.every(
    (group) => group.length > 0 && group.every((cell) => cell.kind === "phandle")
  );
}

function tryParseBaseline(baselineValue: string | null | undefined): DtsValue | null {
  if (!baselineValue || baselineValue.trim().length === 0) return null;
  try {
    return parseDtsValue("reload-baseline", baselineValue.trim()).value;
  } catch {
    return null;
  }
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
  bits: SupportedCellBits;
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

function resolvePhandleCellsShape(
  valueShape: NonNullable<CandidateValueShape>,
  parsedBaseline: DtsValue | null
): ReloadValueShape {
  let cellsPerGroup =
    typeof valueShape.cellsPerGroup === "number" &&
    Number.isInteger(valueShape.cellsPerGroup) &&
    valueShape.cellsPerGroup >= 1
      ? valueShape.cellsPerGroup
      : undefined;
  if (cellsPerGroup === undefined && parsedBaseline && isPhandleCellArrayValue(parsedBaseline)) {
    const inferred = parsedBaseline.kind === "cells" ? parsedBaseline.groups[0]?.length : undefined;
    if (typeof inferred === "number") cellsPerGroup = inferred;
  }

  if (cellsPerGroup === 1) {
    const resolvedList: NonNullable<ReloadValueShape> = {
      kind: "phandle-list",
      bits: 32,
      cellsPerGroup: 1
    };
    if (
      typeof valueShape.groups === "number" &&
      Number.isInteger(valueShape.groups) &&
      valueShape.groups >= 1
    ) {
      resolvedList.groups = valueShape.groups;
    }
    return resolvedList;
  }

  const resolved: NonNullable<ReloadValueShape> = {
    kind: "phandle-cells",
    bits: 32,
    ...(cellsPerGroup !== undefined && cellsPerGroup >= 2 ? { cellsPerGroup } : {})
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
 * Normalize catalog shapes onto the reload surface vocabulary.
 * - `u32-array` / `cells` → `cells` (width may be inferred from a regular integer baseline)
 * - catalog `bytes` with `/bits/ 8 <…>` (or `[…]`) baselines → `cells` with bits=8
 * - `mixed` / `phandle-list` that match GPIO-style `<&label N …>` → `phandle-cells`
 * - bare phandle lists such as `<&gic>` → `phandle-list` (never invent GPIO width)
 * - true mixed string+cell baselines stay `mixed` (never coerced to cells or GPIO)
 * - catalog `bool` / `empty` stay presence shapes; empty RHS is valid
 * - catalog `string` (single quoted string) stays `string`; `string-list` stays `string-list`
 * Encodings that cannot be confirmed from the catalog kind plus baseline are left unsupported.
 */
export function resolveReloadValueShape(
  valueShape: CandidateValueShape,
  baselineValue: string | null | undefined
): ReloadValueShape {
  if (!valueShape || typeof valueShape !== "object") return null;
  if (valueShape.kind === "string-list") {
    return { kind: "string-list" };
  }
  if (valueShape.kind === "string") {
    return { kind: "string" };
  }
  if (valueShape.kind === "bool" || valueShape.kind === "boolean") {
    return { kind: "boolean" };
  }
  if (valueShape.kind === "empty") {
    return { kind: "empty" };
  }
  if (valueShape.kind === "delete") {
    return { kind: "delete" };
  }

  const parsedBaseline = tryParseBaseline(baselineValue);

  if (valueShape.kind === "mixed") {
    if (parsedBaseline && isPhandleCellArrayValue(parsedBaseline)) {
      return resolvePhandleCellsShape(valueShape, parsedBaseline);
    }
    if (parsedBaseline?.kind === "mixed") {
      return { kind: "mixed" };
    }
    return null;
  }

  if (valueShape.kind === "phandle-list" || valueShape.kind === "phandle-cells") {
    if (parsedBaseline && isPhandleCellArrayValue(parsedBaseline)) {
      return resolvePhandleCellsShape(valueShape, parsedBaseline);
    }
    if (parsedBaseline && isBarePhandleListValue(parsedBaseline)) {
      return {
        kind: "phandle-list",
        bits: 32,
        cellsPerGroup: parsedBaseline.kind === "cells" ? parsedBaseline.groups[0]!.length : 1
      };
    }
    if (
      valueShape.kind === "phandle-list" &&
      typeof valueShape.cellsPerGroup === "number" &&
      valueShape.cellsPerGroup === 1 &&
      !parsedBaseline
    ) {
      return { kind: "phandle-list", bits: 32, cellsPerGroup: 1 };
    }
    if (valueShape.kind === "phandle-cells") {
      return resolvePhandleCellsShape(valueShape, parsedBaseline);
    }
    return null;
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

  const resolved: NonNullable<ReloadValueShape> = {
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

export type ValidatedAuthoredDebugValue =
  | { ok: true; parsed: DtsValue; deleteProperty?: boolean }
  | { ok: false; issue: ReloadAuthoringIssue };

/**
 * Parse and validate an engineer-authored debug value against its resolved shape.
 * Accepts the raw authored text (callers need no parse-then-validate ordering) and
 * returns the parsed value for overlay generation on success.
 *
 * Authoring form for integer cells is `/bits/ N <…>` or `<…>` — not dtc's decompiled
 * square-bracket `[…]` spelling. Per-width overflow is enforced by the parser itself
 * (`Integer literal "…" overflows a N-bit cell`) and surfaces as an `unparsable` issue;
 * signed minima wrap like dtc, so `<-1>` stays a legal 32-bit authoring form.
 *
 * Empty RHS is never guessed as boolean/empty from the property name: catalog shape
 * decides. `/delete-property/` is an overlay verb, never inferred from empty cells.
 */
export function validateAuthoredDebugValue(
  propertyKey: string,
  rawDebugValue: string,
  valueShape: ReloadValueShape
): ValidatedAuthoredDebugValue {
  const trimmed = rawDebugValue.trim();

  if (isReloadDeletePropertyToken(trimmed) || (valueShape?.kind === "boolean" && trimmed === "false")) {
    return { ok: true, parsed: { kind: "empty" }, deleteProperty: true };
  }

  if (!trimmed) {
    if (valueShape?.kind === "boolean") {
      return { ok: true, parsed: { kind: "boolean", present: true } };
    }
    if (valueShape?.kind === "empty") {
      return { ok: true, parsed: { kind: "empty" } };
    }
    return {
      ok: false,
      issue: { reason: "unparsable", message: "empty debug value" }
    };
  }

  if (valueShape?.kind === "boolean") {
    if (trimmed === "true") {
      return { ok: true, parsed: { kind: "boolean", present: true } };
    }
    return { ok: false, issue: { reason: "not-boolean" } };
  }

  if (valueShape?.kind === "empty") {
    return { ok: false, issue: { reason: "not-empty" } };
  }

  if (valueShape?.kind === "delete") {
    return { ok: false, issue: { reason: "unparsable", message: "expected /delete-property/" } };
  }

  let parsed: DtsValue;
  try {
    parsed = parseDtsValue(propertyKey, trimmed).value;
  } catch (error) {
    return {
      ok: false,
      issue: {
        reason: "unparsable",
        message: error instanceof Error ? error.message : "invalid value"
      }
    };
  }

  const issue = authoringIssueForParsedValue(parsed, valueShape);
  if (issue) return { ok: false, issue };
  return { ok: true, parsed };
}

function authoringIssueForParsedValue(
  parsedValue: DtsValue,
  valueShape: ReloadValueShape
): ReloadAuthoringIssue | null {
  if (valueShape?.kind === "string") {
    if (parsedValue.kind !== "strings" || parsedValue.values.length !== 1) {
      return { reason: "not-single-string" };
    }
    return null;
  }

  if (valueShape?.kind === "string-list") {
    if (parsedValue.kind !== "strings" || parsedValue.values.length === 0) {
      return { reason: "not-string-list" };
    }
    return null;
  }

  if (valueShape?.kind === "mixed") {
    if (parsedValue.kind !== "mixed") return { reason: "not-mixed" };
    return null;
  }

  if (valueShape?.kind === "phandle-list") {
    if (!isBarePhandleListValue(parsedValue)) return { reason: "not-phandle-list" };
    const cellsPerGroup = valueShape.cellsPerGroup;
    if (
      typeof cellsPerGroup === "number" &&
      Number.isInteger(cellsPerGroup) &&
      cellsPerGroup >= 1 &&
      parsedValue.kind === "cells"
    ) {
      const mismatched = parsedValue.groups.some((group) => group.length !== cellsPerGroup);
      if (mismatched) {
        return {
          reason: "cells-per-group-mismatch",
          expectedCellsPerGroup: cellsPerGroup,
          actualCellsPerGroup: parsedValue.groups.map((group) => group.length)
        };
      }
    }
    return null;
  }

  if (valueShape?.kind === "phandle-cells") {
    if (!isPhandleCellArrayValue(parsedValue)) {
      return { reason: "not-phandle-cell-array" };
    }

    const cellsPerGroup = valueShape.cellsPerGroup;
    if (typeof cellsPerGroup === "number" && Number.isInteger(cellsPerGroup) && cellsPerGroup >= 2) {
      const mismatched =
        parsedValue.kind === "cells" &&
        parsedValue.groups.some((group) => group.length !== cellsPerGroup);
      if (mismatched) {
        return {
          reason: "cells-per-group-mismatch",
          expectedCellsPerGroup: cellsPerGroup,
          actualCellsPerGroup:
            parsedValue.kind === "cells" ? parsedValue.groups.map((group) => group.length) : []
        };
      }
    }

    const expectedGroups = valueShape.groups;
    if (
      typeof expectedGroups === "number" &&
      Number.isInteger(expectedGroups) &&
      expectedGroups >= 1 &&
      parsedValue.kind === "cells" &&
      parsedValue.groups.length !== expectedGroups
    ) {
      return {
        reason: "group-count-mismatch",
        expectedGroups,
        actualGroups: parsedValue.groups.length
      };
    }

    return null;
  }

  const expectedBits: SupportedCellBits =
    typeof valueShape?.bits === "number" && isSupportedCellBits(valueShape.bits) ? valueShape.bits : 32;

  // Authoring form is `/bits/ N <…>` or `<…>` cells — not dtc's square-bracket `[…]` spelling.
  if (parsedValue.kind !== "cells" || !isIntegerCellArrayValue(parsedValue, expectedBits)) {
    return { reason: "not-integer-cell-array", expectedBits };
  }

  const cellsPerGroup = valueShape?.cellsPerGroup;
  if (typeof cellsPerGroup === "number" && Number.isInteger(cellsPerGroup) && cellsPerGroup >= 1) {
    const mismatched = parsedValue.groups.some((group) => group.length !== cellsPerGroup);
    if (mismatched) {
      return {
        reason: "cells-per-group-mismatch",
        expectedCellsPerGroup: cellsPerGroup,
        actualCellsPerGroup: parsedValue.groups.map((group) => group.length)
      };
    }
  }

  const expectedGroups = valueShape?.groups;
  if (typeof expectedGroups === "number" && Number.isInteger(expectedGroups) && expectedGroups >= 1) {
    if (parsedValue.groups.length !== expectedGroups) {
      return {
        reason: "group-count-mismatch",
        expectedGroups,
        actualGroups: parsedValue.groups.length
      };
    }
  }

  return null;
}

function parseIntegerToken(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function cellIntegers(value: DtsValue): number[] | null {
  if (value.kind === "bytes") {
    return value.values.length > 0 ? [...value.values] : null;
  }
  if (value.kind !== "cells") return null;
  const out: number[] = [];
  for (const group of value.groups) {
    for (const cell of group) {
      if (cell.kind !== "integer") return null;
      const parsed = parseIntegerToken(cell.value);
      if (parsed === null) return null;
      out.push(parsed);
    }
  }
  return out;
}

function coerceReadAsCells(propertyKey: string, readValue: string): DtsValue | null {
  const trimmed = readValue.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseDtsValue(propertyKey, trimmed).value;
    if (parsed.kind === "cells" || parsed.kind === "bytes") return parsed;
  } catch {
    // Fall through to bare-token wrapping.
  }

  // Sysfs/debugfs surfaces often emit bare decimals ("7000") rather than DTS cells ("<7000>").
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.some((token) => parseIntegerToken(token) === null)) {
    return null;
  }
  try {
    return parseDtsValue(propertyKey, `<${tokens.join(" ")}>`).value;
  } catch {
    return null;
  }
}

/** GPIO-style specifier: each group is `&label` followed by one or more integers. */
function isPhandleCellSequence(value: DtsValue): boolean {
  if (value.kind !== "cells" || value.groups.length === 0) return false;
  const widths = value.groups.map((group) => group.length);
  const width = widths[0]!;
  if (width < 2 || widths.some((entry) => entry !== width)) return false;
  return value.groups.every((group) => {
    const [head, ...tail] = group;
    return head?.kind === "phandle" && tail.length > 0 && tail.every((cell) => cell.kind === "integer");
  });
}

function serializePhandleCellSequence(value: DtsValue): string[] {
  if (value.kind !== "cells") return [];
  const out: string[] = [];
  for (const group of value.groups) {
    for (const cell of group) {
      if (cell.kind === "phandle") {
        out.push(`&${cell.label}`);
        continue;
      }
      const parsed = parseIntegerToken(cell.value);
      out.push(parsed === null ? cell.value : String(parsed));
    }
  }
  return out;
}

function coerceReadAsPhandleCells(propertyKey: string, readValue: string): DtsValue | null {
  const trimmed = readValue.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseDtsValue(propertyKey, trimmed).value;
    if (isPhandleCellSequence(parsed)) return parsed;
  } catch {
    // Fall through — bare integer streams cannot recover phandle identity.
  }
  return null;
}

function coerceReadAsStrings(propertyKey: string, readValue: string): string[] | null {
  const trimmed = readValue.trim();
  if (!trimmed) return null;
  try {
    const parsed = parseDtsValue(propertyKey, trimmed).value;
    if (parsed.kind === "strings" && parsed.values.length > 0) {
      return parsed.values;
    }
  } catch {
    // Fall through to bare string.
  }
  // Driver surfaces often omit DTS quotes.
  if (!trimmed.includes('"')) {
    return [trimmed];
  }
  return null;
}

/**
 * Shape-aware comparison of a reload debug value against a debug-node read-back.
 * Uses DTS value parsing — never raw string equality alone for cells / string lists.
 *
 * - matched: values agree under the declared shape
 * - contradicted: both sides parsed/coerced and numeric/string values disagree
 * - incomparable: expected value cannot be parsed, or read-back cannot be coerced into the shape
 *   (not a driver contradiction — treat as read-failed at the call site)
 */
export type ReloadDebugValueCompareResult = "matched" | "contradicted" | "incomparable";

export function compareReloadDebugValue(input: {
  propertyKey: string;
  debugValue: string;
  readValue: string;
  valueShape: CandidateValueShape;
}): ReloadDebugValueCompareResult {
  if (input.valueShape?.kind === "boolean" || input.valueShape?.kind === "empty") {
    return comparePresenceValue(input);
  }

  let expected: DtsValue;
  try {
    expected = parseDtsValue(input.propertyKey, input.debugValue).value;
  } catch {
    return "incomparable";
  }

  if (input.valueShape?.kind === "string-list" || input.valueShape?.kind === "string") {
    if (expected.kind !== "strings") return "incomparable";
    if (input.valueShape.kind === "string" && expected.values.length !== 1) return "incomparable";
    const actual = coerceReadAsStrings(input.propertyKey, input.readValue);
    if (!actual) return "incomparable";
    if (actual.length !== expected.values.length) return "contradicted";
    return actual.every((value, index) => value === expected.values[index]) ? "matched" : "contradicted";
  }

  if (input.valueShape?.kind === "mixed" && expected.kind === "mixed") {
    let actual: DtsValue;
    try {
      actual = parseDtsValue(input.propertyKey, input.readValue).value;
    } catch {
      return "incomparable";
    }
    if (actual.kind !== "mixed") return "incomparable";
    const left = canonicalizeReloadValue(expected, "");
    const right = canonicalizeReloadValue(actual, "");
    return left === right ? "matched" : "contradicted";
  }

  if (input.valueShape?.kind === "phandle-list" || isBarePhandleListValue(expected)) {
    if (!isBarePhandleListValue(expected)) return "incomparable";
    let actual: DtsValue;
    try {
      actual = parseDtsValue(input.propertyKey, input.readValue).value;
    } catch {
      return "incomparable";
    }
    if (!isBarePhandleListValue(actual)) return "incomparable";
    const left = serializePhandleCellSequence(expected);
    const right = serializePhandleCellSequence(actual);
    if (left.length !== right.length) return "contradicted";
    return left.every((value, index) => value === right[index]) ? "matched" : "contradicted";
  }

  const phandleFamily = isPhandleCellFamilyKind(input.valueShape?.kind);
  if (phandleFamily || isPhandleCellSequence(expected)) {
    if (!isPhandleCellSequence(expected)) return "incomparable";
    const actualValue = coerceReadAsPhandleCells(input.propertyKey, input.readValue);
    if (!actualValue || !isPhandleCellSequence(actualValue)) return "incomparable";
    const left = serializePhandleCellSequence(expected);
    const right = serializePhandleCellSequence(actualValue);
    if (left.length !== right.length) return "contradicted";
    return left.every((value, index) => value === right[index]) ? "matched" : "contradicted";
  }

  // Default / cells shapes: compare numeric cell sequences.
  const expectedCells = cellIntegers(expected);
  if (!expectedCells) return "incomparable";
  const actualValue = coerceReadAsCells(input.propertyKey, input.readValue);
  const actualCells = actualValue ? cellIntegers(actualValue) : null;
  if (!actualCells) return "incomparable";
  if (actualCells.length !== expectedCells.length) return "contradicted";
  return actualCells.every((value, index) => value === expectedCells[index]) ? "matched" : "contradicted";
}

function comparePresenceValue(input: {
  propertyKey: string;
  debugValue: string;
  readValue: string;
}): ReloadDebugValueCompareResult {
  const debug = input.debugValue.trim();
  const expectedPresent = debug !== "false" && !isReloadDeletePropertyToken(debug);
  const actual = coerceReadAsPresence(input.propertyKey, input.readValue);
  if (actual === "incomparable") return "incomparable";
  return expectedPresent === (actual === "present") ? "matched" : "contradicted";
}

function coerceReadAsPresence(
  propertyKey: string,
  readValue: string
): "present" | "absent" | "incomparable" {
  const trimmed = readValue.trim();
  if (!trimmed) return "present";
  try {
    const parsed = parseDtsValue(propertyKey, trimmed).value;
    if (parsed.kind === "boolean" || parsed.kind === "empty") return "present";
    return "incomparable";
  } catch {
    return "incomparable";
  }
}

/**
 * Compare values by cell or string content, not by text spelling: `dtc` decompiles to
 * hexadecimal while a debug value may be entered in decimal, and string quotes may differ.
 * Phandle labels are rendered through the injected resolver (preflight supplies the
 * numeric phandles that `dtc -@` assigns on labeled nodes); unresolved labels keep their
 * `&label` spelling. `/bits/ 8` authoring forms and dtc's square-bracket `[…]` decompile
 * spelling share one canonical decimal sequence so assert-effect can confirm the overlay
 * took effect.
 */
export function canonicalizeReloadValue(
  value: DtsValue | undefined,
  fallback: string,
  resolvePhandle: (label: string) => string | null = () => null
): string {
  if (value?.kind === "boolean" || value?.kind === "empty") {
    return "";
  }
  if (value?.kind === "mixed") {
    return value.segments
      .map((segment) => {
        if (segment.kind === "string") return JSON.stringify(segment.value);
        const cells = segment.cells
          .map((cell) => {
            if (cell.kind === "integer") return decimalCellText(cell);
            const resolved = resolvePhandle(cell.label);
            return resolved ?? `&${cell.label}`;
          })
          .join(" ");
        const group = `<${cells}>`;
        return segment.bits === 32 ? group : `/bits/ ${segment.bits} ${group}`;
      })
      .join(", ");
  }
  if (value?.kind === "bytes") {
    return value.values.map((entry) => String(entry)).join(" ");
  }
  if (value?.kind === "cells") {
    const hasPhandle = value.groups.some((group) => group.some((cell) => cell.kind === "phandle"));
    if (!hasPhandle && value.bits !== 32) {
      const integers: string[] = [];
      for (const group of value.groups) {
        for (const cell of group) {
          if (cell.kind !== "integer") return fallback.trim();
          integers.push(decimalCellText(cell));
        }
      }
      return integers.join(" ");
    }
    const groups = value.groups.map((group) =>
      group
        .map((cell) => {
          if (cell.kind === "integer") return decimalCellText(cell);
          const resolved = resolvePhandle(cell.label);
          return resolved ?? `&${cell.label}`;
        })
        .join(" ")
    );
    return groups.map((group) => `<${group}>`).join(" ");
  }
  if (value?.kind === "strings") {
    return value.values.map((entry) => JSON.stringify(entry)).join(", ");
  }
  return fallback.trim();
}

/** Decimal rendering of one integer cell (hex or decimal authored spelling). */
export function decimalCellText(cell: { raw: string; value: string }): string {
  const parsed = BigInt(cell.value.length > 0 ? cell.value : cell.raw);
  return parsed.toString(10);
}

/**
 * DTB property-value layout for mixed string+cell overlays. dtc concatenates
 * NUL-terminated strings (4-byte aligned) with big-endian cells; decompile then
 * shows a cell array. This is the Device Tree Spec encoding, not a catalog-shape guess.
 */
export function canonicalizeMixedAsDtbCells(
  value: DtsValue,
  resolvePhandle: (label: string) => string | null = () => null
): string | null {
  if (value.kind !== "mixed") return null;
  const bytes: number[] = [];
  for (const segment of value.segments) {
    if (segment.kind === "string") {
      for (const byte of Buffer.from(segment.value, "utf8")) bytes.push(byte);
      bytes.push(0);
      while (bytes.length % 4 !== 0) bytes.push(0);
      continue;
    }
    if (segment.bits !== 32) return null;
    for (const cell of segment.cells) {
      if (cell.kind === "phandle") {
        const resolved = resolvePhandle(cell.label);
        if (resolved === null) return null;
        const numeric = Number(BigInt(resolved));
        bytes.push((numeric >>> 24) & 0xff, (numeric >>> 16) & 0xff, (numeric >>> 8) & 0xff, numeric & 0xff);
        continue;
      }
      const numeric = Number(BigInt(cell.value.length > 0 ? cell.value : cell.raw));
      bytes.push((numeric >>> 24) & 0xff, (numeric >>> 16) & 0xff, (numeric >>> 8) & 0xff, numeric & 0xff);
    }
  }
  if (bytes.length === 0 || bytes.length % 4 !== 0) return null;
  const cells: string[] = [];
  for (let index = 0; index < bytes.length; index += 4) {
    const numeric =
      ((bytes[index]! << 24) | (bytes[index + 1]! << 16) | (bytes[index + 2]! << 8) | bytes[index + 3]!) >>> 0;
    cells.push(String(numeric));
  }
  return `<${cells.join(" ")}>`;
}
