import { describe, expect, it } from "vitest";

import {
  selectEffectiveDefinition,
  type EffectiveDefinitionCandidate,
} from "./effectiveDefinition";

function candidate(
  overrides: Partial<EffectiveDefinitionCandidate> = {},
): EffectiveDefinitionCandidate {
  return {
    id: overrides.id ?? "spec-platform",
    organizationId: overrides.organizationId ?? null,
    attributionSubjectId: overrides.attributionSubjectId ?? "subject-hisi",
    driverIdentityKey: overrides.driverIdentityKey ?? "compatible:hisilicon,hisi_bci_battery",
    propertyKey: overrides.propertyKey ?? "voltage_max",
    lifecycle: overrides.lifecycle ?? "active",
    versionStatus: overrides.versionStatus ?? "active",
    versionLifecycle: overrides.versionLifecycle,
    versionId: overrides.versionId ?? "version-1",
    activeVersionCount: overrides.activeVersionCount,
    placementReady: overrides.placementReady ?? true,
    sourceKind: overrides.sourceKind ?? "dts",
  };
}

describe("selectEffectiveDefinition", () => {
  it("selects one organization active definition before a platform fallback", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "platform", organizationId: null }),
      candidate({ id: "organization", organizationId: "org-1" }),
    ]);

    expect(result).toMatchObject({ kind: "ready", winner: { id: "organization" } });
  });

  it("does not let an organization draft shadow a platform active definition", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "platform", organizationId: null }),
      candidate({ id: "draft", organizationId: "org-1", lifecycle: "draft", versionStatus: "draft" }),
    ]);

    expect(result).toMatchObject({ kind: "ready", winner: { id: "platform" } });
  });

  it("excludes deprecated definitions from the effective catalog", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "deprecated", lifecycle: "deprecated", versionStatus: "superseded" }),
    ]);

    expect(result).toEqual({ kind: "none", reason: "no-active-definition" });
  });

  it("returns governance when the only active candidate has no declared placement", () => {
    const result = selectEffectiveDefinition([candidate({ placementReady: false })]);

    expect(result).toMatchObject({ kind: "needs-governance", reason: "missing-placement" });
  });

  it("returns governance instead of choosing between same-tier active candidates", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "org-a", organizationId: "org-1" }),
      candidate({ id: "org-b", organizationId: "org-1" }),
    ]);

    expect(result).toMatchObject({ kind: "needs-governance", reason: "multiple-active-candidates" });
  });

  it("does not recognize a spec when more than one version is active", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "duplicate-version", activeVersionCount: 2 }),
    ]);

    expect(result).toMatchObject({ kind: "needs-governance", reason: "multiple-active-versions" });
  });

  it("does not recognize a status-active version whose lifecycle mirror is deprecated", () => {
    const result = selectEffectiveDefinition([
      candidate({ id: "inconsistent-version", versionLifecycle: "deprecated" }),
    ]);

    expect(result).toEqual({ kind: "none", reason: "no-active-definition" });
  });
});
