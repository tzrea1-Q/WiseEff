import { describe, expect, it } from "vitest";

import {
  buildPlatformOverlayDriverId,
  buildPlatformOverlaySchemaNamespace,
  materializePlatformDriverSchemaOverlay,
} from "./driverSchemaOverlayMaterialize";
import type { DriverSchemaOverlayRecord } from "./driverSchemaOverlayRepository";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";

function samplePlatformOverlay(): DriverSchemaOverlayRecord {
  return {
    id: "platform-overlay-1",
    organizationId: null,
    compatible: "vendor,chip",
    displayName: "Chip",
    notes: "",
    lifecycle: "active",
    version: 2,
    supersededBySchemaId: null,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    activatedAt: "2026-07-29T00:00:00.000Z",
    properties: [
      {
        id: "prop-link-1",
        parameterSpecId: "ps-chip-reg",
        parameterSpecVersionId: "psv-chip-reg",
        propertyKey: "reg",
        valueShape: { kind: "u32-array" },
        units: null,
        constraints: {},
        exampleValue: null,
        documentation: "register block",
        specLifecycle: "active",
        sortOrder: 0,
      },
    ],
  };
}

describe("platform overlay materialization", () => {
  it("uses driver:platform id shape without organization segment", () => {
    expect(
      buildPlatformOverlayDriverId({ compatible: "vendor,chip", version: 2 }),
    ).toBe("driver:platform/vendor,chip:v2");
    expect(buildPlatformOverlaySchemaNamespace("vendor,chip")).toBe("platform/vendor,chip");
  });

  it("emits scope platform and does not bake organizationId into fallback spec ids", () => {
    const subjectId = "asub:driver-registration:platform-chip";
    const { driver, properties } = materializePlatformDriverSchemaOverlay(samplePlatformOverlay(), {
      attributionSubjectId: subjectId,
    });
    expect(driver.scope).toBe("platform");
    expect(driver.id).toBe("driver:platform/vendor,chip:v2");
    expect(properties[0].scope).toBe("platform");

    const fallback = buildSubjectScopedManualSpecIds({
      organizationId: null,
      attributionSubjectId: subjectId,
      propertyKey: "other",
    });
    expect(fallback.parameterSpecId).not.toContain("org-");
  });
});
