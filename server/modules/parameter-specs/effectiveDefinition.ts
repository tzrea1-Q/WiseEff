import type { SpecLifecycle } from "./types";

export type EffectiveDefinitionCandidate = {
  id: string;
  organizationId: string | null;
  attributionSubjectId: string | null;
  /** Stable canonical driver identity, normally `attribution_subjects.source_key`. */
  driverIdentityKey: string;
  propertyKey: string;
  lifecycle: SpecLifecycle;
  versionStatus: "draft" | "active" | "superseded" | null;
  /** Legacy lifecycle mirror; when present it must agree with versionStatus. */
  versionLifecycle?: "draft" | "active" | "deprecated" | null;
  versionId: string | null;
  /** Number of active versions on the spec at read time. */
  activeVersionCount?: number;
  placementReady: boolean;
  sourceKind: "dts" | "json" | "manual";
};

export type EffectiveDefinitionResolution =
  | { kind: "ready"; winner: EffectiveDefinitionCandidate; shadowed: EffectiveDefinitionCandidate[] }
  | {
      kind: "needs-governance";
      reason: "missing-placement" | "multiple-active-candidates" | "multiple-active-versions";
      candidates: EffectiveDefinitionCandidate[];
    }
  | { kind: "none"; reason: "no-active-definition" };

function isActive(candidate: EffectiveDefinitionCandidate): boolean {
  return (
    candidate.lifecycle === "active" &&
    candidate.versionStatus === "active" &&
    (candidate.versionLifecycle === undefined || candidate.versionLifecycle === "active") &&
    candidate.versionId !== null
  );
}

/**
 * Resolve a single product-visible definition from owner-scoped storage rows.
 * Draft/deprecated rows are governance/history only. Organization active wins over
 * platform active; a candidate without a complete placement is never recognized.
 */
export function selectEffectiveDefinition(
  candidates: readonly EffectiveDefinitionCandidate[],
): EffectiveDefinitionResolution {
  const active = candidates.filter(isActive);
  if (active.length === 0) return { kind: "none", reason: "no-active-definition" };

  const organization = active.filter((candidate) => candidate.organizationId !== null);
  const tier = organization.length > 0 ? organization : active.filter((candidate) => candidate.organizationId === null);
  if (tier.some((candidate) => (candidate.activeVersionCount ?? 1) > 1)) {
    return { kind: "needs-governance", reason: "multiple-active-versions", candidates: tier };
  }
  if (tier.length > 1) {
    return { kind: "needs-governance", reason: "multiple-active-candidates", candidates: tier };
  }
  const winner = tier[0];
  if (!winner.placementReady) {
    return { kind: "needs-governance", reason: "missing-placement", candidates: tier };
  }
  return {
    kind: "ready",
    winner,
    shadowed: candidates.filter((candidate) => candidate.id !== winner.id),
  };
}

export function effectiveDefinitionIdentityKey(input: {
  driverIdentityKey: string;
  propertyKey: string;
}): string {
  return `${input.driverIdentityKey}\u0000${input.propertyKey}`;
}
