import type { DebugParameter, PrototypeState } from "./mockData";

export function parseRange(range: string): [number, number] | null {
  const match = range.match(/^\s*(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) {
    return null;
  }

  const min = Number.parseFloat(match[1]);
  const max = Number.parseFloat(match[2]);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    return null;
  }

  return [min, max];
}

export function computeDeviation(currentValue: string, targetValue: string): number | null {
  const current = Number.parseFloat(currentValue);
  const target = Number.parseFloat(targetValue);
  if (Number.isNaN(current) || Number.isNaN(target) || current === 0) {
    return null;
  }

  return Math.round(((target - current) / current) * 10_000) / 100;
}

export function deriveDebugParameterStatus(
  parameter: DebugParameter,
  pushedIds: Set<string>
): DebugParameter["status"] {
  if (pushedIds.has(parameter.id)) {
    return "下发成功";
  }

  if (parameter.targetValue === parameter.currentValue) {
    return "已同步";
  }

  return "待下发";
}

export type DebugSessionMetrics = {
  sessionDurationMinutes: number | null;
  pushedCount: number;
  pendingCount: number;
  failedCount: number;
};

export function deriveSessionMetrics(state: PrototypeState, now: Date): DebugSessionMetrics {
  const pushedIds = new Set(state.pushedDebugIds);
  const startedAt = state.debuggingSessionStartedAt
    ? new Date(state.debuggingSessionStartedAt)
    : null;
  const sessionDurationMinutes = startedAt
    ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60_000))
    : null;

  let pushedCount = 0;
  let pendingCount = 0;
  for (const parameter of state.debugParameters) {
    const status = deriveDebugParameterStatus(parameter, pushedIds);
    if (status === "下发成功") {
      pushedCount += 1;
    } else if (status === "待下发") {
      pendingCount += 1;
    }
  }

  return {
    sessionDurationMinutes,
    pushedCount,
    pendingCount,
    failedCount: 0
  };
}
