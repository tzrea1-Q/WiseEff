export type DeltaInput = {
  baseValue: string | null;
  targetValue: string | null;
  unit: string;
};

export type DeltaDescriptor =
  | { kind: "synced" }
  | { kind: "percent"; percent: number; direction: "up" | "down" }
  | { kind: "absolute"; amount: number; unit: string; direction: "up" | "down" }
  | { kind: "changed" }
  | { kind: "new" }
  | { kind: "missing" };

const PERCENT_FALLBACK_THRESHOLD = 999;

function isMissing(value: string | null | undefined) {
  return value === null || value === undefined || value.trim() === "";
}

export function parseNumeric(value: string | null): number | null {
  if (value === null || isMissing(value)) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function calculateDelta(input: DeltaInput): DeltaDescriptor {
  const { baseValue, targetValue, unit } = input;

  if (isMissing(baseValue)) {
    return isMissing(targetValue) ? { kind: "synced" } : { kind: "new" };
  }
  if (isMissing(targetValue)) {
    return { kind: "missing" };
  }
  if (baseValue === targetValue) {
    return { kind: "synced" };
  }

  const baseNumeric = parseNumeric(baseValue);
  const targetNumeric = parseNumeric(targetValue);

  if (baseNumeric === null || targetNumeric === null) {
    return { kind: "changed" };
  }

  const amount = targetNumeric - baseNumeric;
  const direction = amount >= 0 ? "up" : "down";

  if (baseNumeric === 0) {
    return { kind: "absolute", amount, unit, direction };
  }

  const percent = (amount / Math.abs(baseNumeric)) * 100;
  if (Math.abs(percent) > PERCENT_FALLBACK_THRESHOLD) {
    return { kind: "absolute", amount, unit, direction };
  }

  return { kind: "percent", percent, direction };
}
