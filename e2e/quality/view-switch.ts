import { requireConsistencyMeasurements, viewSwitchStyleExpectations, type ConsistencyMeasurements } from "./consistency";

export function requireViewSwitchStyles(measurements: Pick<ConsistencyMeasurements, "viewSwitches" | "viewSwitchSignatures">, path: string) {
  const variants = viewSwitchStyleExpectations[path.split("?")[0]];
  if (!variants) return;
  requireConsistencyMeasurements(measurements, ["viewSwitches", "viewSwitchSignatures"], path);
  const observed = new Set<string>();
  for (const control of measurements.viewSwitches) {
    if (control.role === "listitem" && control.group.includes(".local-device-bridge-wizard__steps")) continue;
    const matches = measurements.viewSwitchSignatures.filter((style) =>
      variants.some((variant) => variant === style.variant)
      && control.role === style.role && control.groupRole === style.groupRole
      && control.height === style.height && control.radius === style.radius
      && control.fontSize === style.fontSize && control.lineHeight === style.lineHeight && control.fontWeight === style.fontWeight
      && control.background === (control.selected ? style.selectedBackground : style.background)
    );
    if (matches.length !== 1) {
      throw new Error(`${path}: ${control.dom} must match exactly one view-switch style (matched ${matches.length})`);
    }
    observed.add(matches[0].variant);
  }
  const missing = variants.filter((variant) => !observed.has(variant));
  if (missing.length) throw new Error(`${path}: missing view-switch tiers: ${missing.join(", ")}`);
}
