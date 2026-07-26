/**
 * Presentation-only provenance for organization module governance.
 * Replace with a real registry field later without changing the UI contract.
 */

const UNIT_ADDRESS_PATTERN = /@[0-9a-fA-F]+/;
const STRUCTURAL_PROPERTY_PATTERN = /^#/;

export function isAutoDiscoveredModuleName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (UNIT_ADDRESS_PATTERN.test(trimmed)) return true;
  // Bare DTS node-ish tokens without spaces (e.g. batt, pmic@0 already caught).
  if (/^[a-z][a-z0-9_]*@[0-9a-fA-F]+$/i.test(trimmed)) return true;
  if (/^(i2c|spi|pmic|batt|scharger)([@_0-9a-z]*)$/.test(trimmed)) return true;
  return false;
}

export function isStructuralPropertyKey(propertyKey: string | null | undefined): boolean {
  if (!propertyKey) return false;
  return STRUCTURAL_PROPERTY_PATTERN.test(propertyKey.trim());
}

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): {
  pageItems: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
} {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    pageItems: items.slice(start, start + safePageSize),
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages
  };
}
