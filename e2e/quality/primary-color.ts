import type { ConsistencyMeasurements } from "./consistency-collector";
import { requireMeasuredCategories } from "./consistency-assertions";

export function requirePrimaryActionColors(
  measurements: Pick<ConsistencyMeasurements, "primaryActions"> & Partial<Pick<ConsistencyMeasurements, "enabledPrimaryActionCount">>,
  path: string
) {
  if (measurements.enabledPrimaryActionCount) {
    requireMeasuredCategories(measurements, ["primaryActions"], path);
    if (measurements.primaryActions.filter((action) => !action.disabled).length !== measurements.enabledPrimaryActionCount) {
      throw new Error(`${path}: missing enabled primary action measurements`);
    }
  }
  for (const action of measurements.primaryActions) {
    if (!action.disabled && (!action.primaryColor || action.background !== action.primaryColor)) {
      throw new Error(`${path}: ${action.dom} resting background ${action.background} must equal primary ${action.primaryColor}`);
    }
  }
}
