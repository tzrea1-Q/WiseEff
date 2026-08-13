/**
 * Shared percent formatter mandated by the design system (§Content and
 * Language): normalizes the two source shapes seen in the codebase —
 * 0–1 fractions (× 100) and 0–100 numbers — so a confidence of 0.91 renders
 * as "91%" instead of "0.91%".
 *
 * Decision rule: `0 < value <= 1` is treated as a fraction. This makes the
 * literal value 1 render as "100%" (fraction), not "1%"; callers whose domain
 * legitimately produces integer 1 percent must not use this formatter.
 */

/** Normalize to the 0–100 domain (for widths and thresholds). */
export function normalizePercentValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return value <= 1 ? value * 100 : value;
}

/** Render "91%" with at most 1 decimal place; integers carry no decimals. */
export function formatPercent(value: number): string {
  const normalized = normalizePercentValue(value);
  if (normalized === 0) {
    return "0%";
  }
  if (normalized >= 100) {
    return "100%";
  }
  const rounded = Math.round(normalized * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
