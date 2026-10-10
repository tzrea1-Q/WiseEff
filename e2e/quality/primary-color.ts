import type { ConsistencyMeasurements } from "./consistency";

export function requirePrimaryActionColors(measurements: Pick<ConsistencyMeasurements, "primaryActions">, path: string) {
  for (const action of measurements.primaryActions) {
    if (!action.primaryColor || action.background !== action.primaryColor) {
      throw new Error(`${path}: ${action.dom} resting background ${action.background} must equal primary ${action.primaryColor}`);
    }
  }
}
