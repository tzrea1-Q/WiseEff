/**
 * Client-side authoring pre-check for DTS reload debug values.
 *
 * Pure validation logic extracted from `DtsReloadPage.tsx` (TD-069): structural parsers for
 * the supported reload value shapes plus the declared min/max/cells constraint check. This
 * module guards values written to physical hardware, so every supported family and boundary
 * has direct unit coverage in `debugValue.test.ts`.
 *
 * The server, through the real DTS parser, remains the source of truth (including per-width
 * integer overflow); this is a best-effort structural mirror for immediate feedback.
 */

import type { DtsReloadCandidate } from "./types";
import {
  describeReloadValueShapeAuthoring,
  isPhandleCellFamilyKind,
  isSupportedCellBits
} from "./valueShape";

/** The candidate slice the authoring pre-check actually reads. */
export type DtsReloadDebugValueTarget = Pick<
  DtsReloadCandidate,
  "resolvedValueShape" | "constraints"
>;

/** True when the draft debug value is non-empty and differs from the library baseline. */
export function hasMeaningfulDebugChange(
  debugValue: string,
  baselineValue: string | null | undefined
): boolean {
  const trimmed = debugValue.trim();
  if (!trimmed) return false;
  return trimmed !== (baselineValue ?? "").trim();
}

function parseCellIntegers(raw: string): number[] | null {
  const trimmed = raw.trim();
  const bracket = /^\[([0-9a-fA-F\s]+)\]$/.exec(trimmed);
  if (bracket) {
    const tokens = bracket[1]!.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    const values = tokens.map((token) => Number.parseInt(token, 16));
    return values.every((value) => Number.isFinite(value)) ? values : null;
  }
  const groups = trimmed.match(/<[^>]+>/g);
  if (!groups || groups.length === 0) {
    const bare = /^(0x[0-9a-fA-F]+|-?\d+)(?:\s+(0x[0-9a-fA-F]+|-?\d+))*$/.exec(trimmed);
    if (!bare) return null;
    return trimmed.split(/\s+/).map((token) => Number(token));
  }
  const values: number[] = [];
  for (const group of groups) {
    const body = group.slice(1, -1).trim();
    if (!body) return null;
    for (const token of body.split(/\s+/)) {
      if (!/^(0x[0-9a-fA-F]+|-?\d+)$/.test(token)) return null;
      values.push(Number(token));
    }
  }
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

/** GPIO-style groups: each `<&label N …>` with uniform width (phandle + ≥1 integers). */
function parsePhandleCellGroups(
  raw: string
): Array<{ label: string; integers: number[]; width: number }> | null {
  const trimmed = raw.trim();
  const groups = trimmed.match(/<[^>]+>/g);
  if (!groups || groups.length === 0) return null;
  const parsed: Array<{ label: string; integers: number[]; width: number }> = [];
  for (const group of groups) {
    const tokens = group.slice(1, -1).trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const labelMatch = /^&([A-Za-z_][\w]*)$/.exec(tokens[0]!);
    if (!labelMatch) return null;
    const integers: number[] = [];
    for (const token of tokens.slice(1)) {
      if (!/^(0x[0-9a-fA-F]+|-?\d+)$/.test(token)) return null;
      integers.push(Number(token));
    }
    if (integers.length === 0 || integers.some((value) => !Number.isFinite(value))) return null;
    parsed.push({ label: labelMatch[1]!, integers, width: integers.length + 1 });
  }
  const width = parsed[0]!.width;
  if (parsed.some((group) => group.width !== width)) return null;
  return parsed;
}

function countQuotedStrings(raw: string): number {
  const matches = raw.match(/"(?:\\.|[^"\\])*"/g);
  return matches?.length ?? 0;
}

function looksLikeStringList(raw: string): boolean {
  return countQuotedStrings(raw) >= 1;
}

/**
 * Validate an authored debug value against the candidate's server-resolved value shape and
 * declared constraints. Returns a Chinese error message, or `null` when the value passes.
 *
 * Dispatches on the server-resolved `resolvedValueShape` (never the raw catalog kind) and
 * sources every example token from the shared `describeReloadValueShapeAuthoring`, so the
 * family set and examples stay in one place.
 */
export function validateDebugValue(
  raw: string,
  candidate: DtsReloadDebugValueTarget
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "请输入调试值。";

  const shape = candidate.resolvedValueShape;
  const example = describeReloadValueShapeAuthoring(shape).placeholder;

  if (shape?.kind === "string") {
    if (countQuotedStrings(trimmed) !== 1) {
      return `调试值必须是单个字符串，例如 ${example}。`;
    }
    return null;
  }

  if (shape?.kind === "string-list") {
    if (!looksLikeStringList(trimmed)) {
      return `调试值必须是字符串列表，例如 ${example}。`;
    }
    return null;
  }

  if (isPhandleCellFamilyKind(shape?.kind)) {
    const groups = parsePhandleCellGroups(trimmed);
    if (!groups) {
      return `调试值必须是 GPIO 风格 phandle 数组，例如 ${example}。`;
    }
    const { constraints } = candidate;
    const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
    const min = typeof constraints.min === "number" ? constraints.min : undefined;
    const max = typeof constraints.max === "number" ? constraints.max : undefined;
    if (expectedCells !== undefined && groups.some((group) => group.width !== expectedCells)) {
      return `调试值 cell 数量应为 ${expectedCells}，当前为 ${groups.map((group) => group.width).join(", ")}。`;
    }
    const integers = groups.flatMap((group) => group.integers);
    if (min !== undefined && integers.some((value) => value < min)) {
      return `调试值低于声明的最小值 ${min}。`;
    }
    if (max !== undefined && integers.some((value) => value > max)) {
      return `调试值超过声明的最大值 ${max}。`;
    }
    return null;
  }

  // Integer cell family: sub-32-bit widths use the `/bits/ N <…>` authoring form.
  const bits = isSupportedCellBits(shape?.bits) ? shape.bits : 32;
  if (bits !== 32) {
    if (!new RegExp(`^/bits/\\s+${bits}\\s+<[^>]+>$`).test(trimmed)) {
      return `调试值必须是 /bits/ ${bits} cell 数组，例如 ${example}。`;
    }
    const numeric = parseCellIntegers(trimmed);
    if (numeric === null) {
      return `调试值必须是 /bits/ ${bits} cell 数组，例如 ${example}。`;
    }
    const maxUnsigned = 2 ** bits - 1;
    if (numeric.some((value) => value < 0 || value > maxUnsigned)) {
      return `调试值中的每个数值必须在 0–${maxUnsigned} 范围内。`;
    }
    const { constraints } = candidate;
    const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
    if (expectedCells !== undefined && numeric.length !== expectedCells) {
      return `调试值 cell 数量应为 ${expectedCells}，当前为 ${numeric.length}。`;
    }
    return null;
  }

  const numeric = parseCellIntegers(trimmed);
  if (numeric === null) {
    return `调试值必须是 u32 cell 数组，例如 ${example}。`;
  }

  const { constraints } = candidate;
  const expectedCells = typeof constraints.cells === "number" ? constraints.cells : undefined;
  const min = typeof constraints.min === "number" ? constraints.min : undefined;
  const max = typeof constraints.max === "number" ? constraints.max : undefined;
  if (expectedCells !== undefined && numeric.length !== expectedCells) {
    return `调试值 cell 数量应为 ${expectedCells}，当前为 ${numeric.length}。`;
  }
  if (min !== undefined && numeric.some((value) => value < min)) {
    return `调试值低于声明的最小值 ${min}。`;
  }
  if (max !== undefined && numeric.some((value) => value > max)) {
    return `调试值超过声明的最大值 ${max}。`;
  }
  return null;
}
