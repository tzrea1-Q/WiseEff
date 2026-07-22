/**
 * Server-side copy of src/domain/parameter-topology/parameterSurface.ts.
 * Keep in sync when surface rules change — server cannot import @/domain.
 */

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

const SCAFFOLDING_NAME_RE =
  /^(spmi\d*|amba|i2c@[0-9a-fA-F]+|pmic@[0-9a-fA-F]+|gic|gpio\d*)$/i;

export type ParameterSurfaceInput = {
  propertyKey: string;
  locator: string | null | undefined;
  compatible?: string | null;
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
  return parts.every((part) => SCAFFOLDING_NAME_RE.test(part));
}

export function isParameterSurfaceRow(input: ParameterSurfaceInput): boolean {
  if (isStructuralPropertyKey(input.propertyKey)) return false;
  const locator = input.locator ?? "";
  const parts = locator.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  const leaf = parts[parts.length - 1]!;
  if (SCAFFOLDING_NAME_RE.test(leaf)) return false;
  return true;
}
