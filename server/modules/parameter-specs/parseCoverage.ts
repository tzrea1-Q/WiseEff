import { isReleasableDriver } from "./schemaLoader";
import type { DriverSchema, SchemaRegistry, SchemaSource } from "./types";

export type ParseCoverageScope = "platform" | "organization";

export type ParseCoverageMatch = {
  pattern: string;
  driverId: string;
  source: SchemaSource;
  scope: ParseCoverageScope;
};

export type ParseCoverage =
  | { covered: false }
  | ({
      covered: true;
      shadowedBy?: ParseCoverageMatch[];
    } & ParseCoverageMatch);

function patternMatches(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return false;
}

/**
 * Scope for coverage chips. Pinned linux/vendor are platform; organization
 * overlays carry `:org/` in the driver id until DriverSchema.scope lands (ADR-0009).
 */
export function coverageScopeForDriver(driver: DriverSchema): ParseCoverageScope {
  if (driver.scope === "organization" || driver.scope === "platform") {
    return driver.scope;
  }
  if (driver.source === "manual" && String(driver.id).includes(":org/")) {
    return "organization";
  }
  return "platform";
}

type Candidate = ParseCoverageMatch & { driver: DriverSchema };

function collectCandidates(compatible: string, registry: SchemaRegistry): Candidate[] {
  const candidates: Candidate[] = [];
  for (const driver of registry.drivers) {
    if (!isReleasableDriver(driver)) continue;
    for (const pattern of driver.compatiblePatterns) {
      if (!patternMatches(pattern, compatible)) continue;
      candidates.push({
        pattern,
        driverId: driver.id,
        source: driver.source,
        scope: coverageScopeForDriver(driver),
        driver,
      });
      break;
    }
  }
  return candidates;
}

/**
 * Pick the same effective driver matchDriver would: unique vendor, else unique
 * linux, else unique manual. Same-tier multiplicity prefers exact patterns then
 * first candidate so coverage stays deterministic for the chip.
 */
function pickEffective(candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const bySource = {
    linux: candidates.filter((entry) => entry.source === "linux"),
    vendor: candidates.filter((entry) => entry.source === "vendor"),
    manual: candidates.filter((entry) => entry.source === "manual"),
  };

  const preferExact = (tier: Candidate[]): Candidate => {
    const exact = tier.find((entry) => !entry.pattern.endsWith("*"));
    return exact ?? tier[0];
  };

  if (bySource.vendor.length >= 1) return preferExact(bySource.vendor);
  if (bySource.linux.length >= 1) return preferExact(bySource.linux);
  if (bySource.manual.length >= 1) {
    const platformManual = bySource.manual.filter((entry) => entry.scope === "platform");
    if (platformManual.length >= 1) return preferExact(platformManual);
    return preferExact(bySource.manual);
  }
  return candidates[0];
}

/**
 * Whether a compatible is claimed by a releasable schema.
 * Chooses by tier (vendor → linux → platform-manual → org-manual), not array
 * order, and reports lower-tier matches as shadowedBy (ADR-0007 / ADR-0009).
 */
export function lookupParseCoverage(
  compatible: string,
  registry: SchemaRegistry,
): ParseCoverage {
  const candidates = collectCandidates(compatible, registry);
  const chosen = pickEffective(candidates);
  if (!chosen) return { covered: false };

  const shadowedBy = candidates
    .filter((entry) => entry.driverId !== chosen.driverId)
    .map(({ pattern, driverId, source, scope }) => ({ pattern, driverId, source, scope }));

  return {
    covered: true,
    pattern: chosen.pattern,
    driverId: chosen.driverId,
    source: chosen.source,
    scope: chosen.scope,
    ...(shadowedBy.length > 0 ? { shadowedBy } : {}),
  };
}
