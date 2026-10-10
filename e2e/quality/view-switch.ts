import { requireConsistencyMeasurements, viewSwitchStylePaths, type ConsistencyMeasurements } from "./consistency";

export function requireViewSwitchStyles(measurements: Pick<ConsistencyMeasurements, "viewSwitches" | "viewSwitchSignatures">, path: string) {
  if (!viewSwitchStylePaths.includes(path)) return;
  requireConsistencyMeasurements(measurements, ["viewSwitches", "viewSwitchSignatures"], path);
  for (const control of measurements.viewSwitches) {
    if (control.role === "listitem" && control.group.includes(".local-device-bridge-wizard__steps")) continue;
    const matches = measurements.viewSwitchSignatures.filter((style) =>
      (!["/node-debugging", "/dts-reload"].includes(path) || style.variant === "tabs")
      && control.role === style.role && control.groupRole === style.groupRole
      && control.height === style.height && control.radius === style.radius
      && control.fontSize === style.fontSize && control.lineHeight === style.lineHeight && control.fontWeight === style.fontWeight
      && control.background === (control.selected ? style.selectedBackground : style.background)
    );
    if (matches.length !== 1) {
      throw new Error(`${path}: ${control.dom} must match exactly one view-switch style (matched ${matches.length})`);
    }
  }
}
