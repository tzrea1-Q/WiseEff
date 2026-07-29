import { isReleasableDriver } from "./schemaLoader";
import type { SchemaRegistry, SchemaSource } from "./types";

export type ParseCoverage =
  | { covered: false }
  | {
      covered: true;
      pattern: string;
      driverId: string;
      source: SchemaSource;
    };

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/**
 * Whether a compatible is claimed by a pinned releasable schema document.
 * Reports the matching pattern (exact or prefix) so "parseable but unregistered"
 * stays distinguishable from a defect (ADR-0007).
 */
export function lookupParseCoverage(
  compatible: string,
  registry: SchemaRegistry,
): ParseCoverage {
  for (const driver of registry.drivers) {
    if (!isReleasableDriver(driver)) continue;
    for (const pattern of driver.compatiblePatterns) {
      if (patternMatches(pattern, compatible)) {
        return {
          covered: true,
          pattern,
          driverId: driver.id,
          source: driver.source,
        };
      }
    }
  }
  return { covered: false };
}
