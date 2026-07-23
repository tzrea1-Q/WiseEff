import {
  isProvisionalScaffoldingUnclassifiedModuleName,
  isScaffoldingDriverLabel,
  MODULE_SCAFFOLDING_SEGMENT_RE
} from "./modulePlacement";

const STRUCTURAL_PROPERTY_KEYS = new Set([
  "compatible",
  "reg",
  "status",
  "#address-cells",
  "#size-cells",
  "#interrupt-cells",
  "#gpio-cells",
  "ranges",
  "interrupt-controller",
  "gpio-controller"
]);

export type ParameterSurfaceInput = {
  propertyKey: string;
  locator: string | null | undefined;
  compatible?: string | null;
  /** Binding driverModule when known — used to hide scaffolding drivers. */
  driverModule?: string | null;
  /** Persisted / derived module display name (e.g.「未分类 · amba-bus」). */
  moduleName?: string | null;
};

export function isStructuralPropertyKey(propertyKey: string): boolean {
  return (
    STRUCTURAL_PROPERTY_KEYS.has(propertyKey.trim().toLowerCase()) ||
    propertyKey.trim().startsWith("#")
  );
}

export function isScaffoldingLocator(locator: string | null | undefined): boolean {
  if (!locator || locator === "/") return true;
  const parts = locator.split("/").filter(Boolean);
  if (parts.length === 0) return true;
  return parts.every((part) => MODULE_SCAFFOLDING_SEGMENT_RE.test(part));
}

/**
 * v1 surface rule: non-structural property on a non-scaffolding-only locator,
 * and not owned by an unmapped scaffolding driver / provisional bucket.
 * Locators under a managed leaf (e.g. .../hi6xxx_coul/batt) are included even if ancestors are buses.
 */
export function isParameterSurfaceRow(input: ParameterSurfaceInput): boolean {
  if (isStructuralPropertyKey(input.propertyKey)) return false;
  if (isProvisionalScaffoldingUnclassifiedModuleName(input.moduleName)) return false;
  if (isScaffoldingDriverLabel(input.compatible) || isScaffoldingDriverLabel(input.driverModule)) {
    return false;
  }
  const locator = input.locator ?? "";
  const parts = locator.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  const leaf = parts[parts.length - 1]!;
  if (MODULE_SCAFFOLDING_SEGMENT_RE.test(leaf)) return false;
  return true;
}
