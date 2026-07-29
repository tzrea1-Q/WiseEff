import { describe, expect, it } from "vitest";

import type { OrganizationDriverSchemaRecord } from "./driverSchemaOverlayRepository";
import {
  areContributorsEquivalent,
  projectPromotionCandidates,
} from "./driverSchemaPromotion";

function overlay(input: {
  id: string;
  organizationId: string;
  compatible: string;
  properties: Array<{
    propertyKey: string;
    valueShapeKind: string;
    units?: string | null;
    documentation?: string;
  }>;
}): OrganizationDriverSchemaRecord {
  return {
    id: input.id,
    organizationId: input.organizationId,
    compatible: input.compatible,
    displayName: input.compatible,
    notes: "",
    lifecycle: "active",
    version: 1,
    supersededBySchemaId: null,
    createdByUserId: null,
    updatedByUserId: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    activatedAt: "2026-07-29T00:00:00.000Z",
    properties: input.properties.map((property, index) => ({
      id: `${input.id}-p${index}`,
      parameterSpecId: `ps-${input.organizationId}-${property.propertyKey}`,
      parameterSpecVersionId: null,
      propertyKey: property.propertyKey,
      valueShape: { kind: property.valueShapeKind as "u32-array" },
      units: property.units ?? null,
      constraints: {},
      exampleValue: null,
      documentation: property.documentation ?? "",
      specLifecycle: "active",
      sortOrder: index,
    })),
  };
}

describe("driverSchemaPromotion equivalence", () => {
  it("treats identical keys and value shapes as equivalent even when documentation differs", () => {
    const left = overlay({
      id: "s1",
      organizationId: "org-a",
      compatible: "vendor,ic",
      properties: [
        { propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "uV", documentation: "A" },
      ],
    });
    const right = overlay({
      id: "s2",
      organizationId: "org-b",
      compatible: "vendor,ic",
      properties: [
        { propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "uV", documentation: "B" },
      ],
    });

    expect(areContributorsEquivalent([left, right])).toBe(true);
  });

  it("rejects divergent units or value shapes", () => {
    const left = overlay({
      id: "s1",
      organizationId: "org-a",
      compatible: "vendor,ic",
      properties: [{ propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "uV" }],
    });
    const right = overlay({
      id: "s2",
      organizationId: "org-b",
      compatible: "vendor,ic",
      properties: [{ propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "mV" }],
    });

    expect(areContributorsEquivalent([left, right])).toBe(false);
  });

  it("projects candidates without leaking full overlay records", () => {
    const items = projectPromotionCandidates([
      overlay({
        id: "s1",
        organizationId: "org-a",
        compatible: "vendor,ic",
        properties: [{ propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "uV" }],
      }),
      overlay({
        id: "s2",
        organizationId: "org-b",
        compatible: "vendor,ic",
        properties: [{ propertyKey: "max-voltage", valueShapeKind: "u32-array", units: "uV" }],
      }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      compatible: "vendor,ic",
      contributorCount: 2,
      equivalent: true,
      contributorOrganizationIds: expect.arrayContaining(["org-a", "org-b"]),
    });
    const serialized = JSON.stringify(items[0]);
    expect(serialized).not.toContain('"notes"');
    expect(serialized).not.toContain('"displayName"');
  });
});
