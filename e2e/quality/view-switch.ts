import { requireConsistencyMeasurements, type ConsistencyMeasurements } from "./consistency";

export function requireViewSwitchStyles(measurements: Pick<ConsistencyMeasurements, "viewSwitches" | "viewSwitchSignatures">, path: string) {
  if (!["/organization", "/organization/members", "/parameter-home", "/audit", "/logs", "/parameters"].includes(path)) return;
  requireConsistencyMeasurements(measurements, ["viewSwitches", "viewSwitchSignatures"], path);
  for (const control of measurements.viewSwitches) {
    const matches = measurements.viewSwitchSignatures.filter((style) =>
      control.role === style.role && control.groupRole === style.groupRole
      && control.height === style.height && control.radius === style.radius
      && control.fontSize === style.fontSize && control.lineHeight === style.lineHeight && control.fontWeight === style.fontWeight
      && control.background === (control.selected ? style.selectedBackground : style.background)
    );
    if (matches.length !== 1) {
      throw new Error(`${path}: ${control.dom} must match exactly one view-switch style (matched ${matches.length})`);
    }
  }
}
