import {
  isModuleScaffoldingNode,
  isProvisionalScaffoldingUnclassifiedModuleName,
  isScaffoldingDriverLabel,
  MODULE_SCAFFOLDING_SEGMENT_RE
} from "./modulePlacement";

/**
 * Single source of truth for DTS structural property keys.
 * Structural keys are never parameter-surface rows, never produce spec review
 * tasks, and never participate in schema matching (see ADR-0003).
 * Keys starting with `#` are also structural via {@link isStructuralPropertyKey}.
 */
export const STRUCTURAL_PROPERTY_KEYS = [
  "compatible",
  "device_type",
  "gpio-controller",
  "interrupt-controller",
  "linux,phandle",
  "phandle",
  "ranges",
  "reg",
  "status",
  "#address-cells",
  "#gpio-cells",
  "#interrupt-cells",
  "#size-cells"
] as const;

const STRUCTURAL_PROPERTY_KEY_SET = new Set<string>(
  STRUCTURAL_PROPERTY_KEYS.map((key) => key.toLowerCase())
);

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
  const trimmed = propertyKey.trim();
  return STRUCTURAL_PROPERTY_KEY_SET.has(trimmed.toLowerCase()) || trimmed.startsWith("#");
}

/** Stable list for SQL `<> all($1::text[])` gate exclusions. */
export function listStructuralPropertyKeys(): string[] {
  return [...STRUCTURAL_PROPERTY_KEYS];
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
 * Root-node business properties (board_id) are included when parked on a non-scaffolding module.
 * Missing locators fail closed (excluded) so incomplete topology never leaks into the ledger.
 */
export function isParameterSurfaceRow(input: ParameterSurfaceInput): boolean {
  if (isStructuralPropertyKey(input.propertyKey)) return false;
  if (isProvisionalScaffoldingUnclassifiedModuleName(input.moduleName)) return false;
  if (
    input.moduleName != null &&
    input.moduleName !== "" &&
    isModuleScaffoldingNode({ name: input.moduleName })
  ) {
    return false;
  }
  if (isScaffoldingDriverLabel(input.compatible) || isScaffoldingDriverLabel(input.driverModule)) {
    return false;
  }
  if (input.locator == null || input.locator === "") return false;
  const parts = input.locator.split("/").filter(Boolean);
  if (parts.length === 0) {
    // DTS root (`/`): allow non-structural business props such as board_id.
    return true;
  }
  const leaf = parts[parts.length - 1]!;
  if (MODULE_SCAFFOLDING_SEGMENT_RE.test(leaf)) return false;
  return true;
}
