import { describe, expect, it } from "vitest";

import { matchDriver, matchProperty } from "./matcher";
import {
  displayDriverLabelFromOverlayCompatible,
  materializeOrganizationDriverSchema,
  mergePinnedRegistryWithOverlay,
} from "./driverSchemaOverlayMaterialize";
import type { OrganizationDriverSchemaRecord } from "./driverSchemaOverlayRepository";
import { buildSubjectScopedManualSpecIds } from "./specIdentity";
import type { SchemaRegistry } from "./types";

const OVERLAY_SUBJECT = "asub:driver-registration:overlay-chip";

function pinnedVendorRegistry(): SchemaRegistry {
  const driver = {
    id: "driver:vendor/sc8562.yaml:v1",
    compatible: "sc8562",
    compatiblePatterns: ["sc8562"],
    nodenamePatterns: [] as string[],
    source: "vendor" as const,
    schemaNamespace: "vendor/sc8562",
    version: 1,
    lifecycle: "active" as const,
    propertyIds: ["propspec:vendor/sc8562:reg:v1"],
    commonRefs: [] as string[],
  };
  const property = {
    id: "propspec:vendor/sc8562:reg:v1",
    parameterSpecId: "pspec:vendor/sc8562:reg",
    driverSchemaId: driver.id,
    propertyKey: "reg",
    schemaNamespace: "vendor/sc8562",
    source: "vendor" as const,
    lifecycle: "active" as const,
    valueShape: { kind: "u32-array" as const },
    constraints: {},
  };
  return {
    catalog: {
      linuxDtSchemaRevision: "test",
      dtschemaVersion: "2026.6",
      vendorContentHash: "hash",
      importedAt: "2026-07-29T00:00:00.000Z",
      schemaPaths: [],
    },
    drivers: [driver],
    properties: [property],
    driversById: new Map([[driver.id, driver]]),
    propertiesById: new Map([[property.id, property]]),
  };
}

function overlayRecord(
  overrides: Partial<OrganizationDriverSchemaRecord> = {},
): OrganizationDriverSchemaRecord {
  return {
    id: "ods-1",
    organizationId: "org-1",
    compatible: "vendor,overlay-chip",
    displayName: "Overlay Chip",
    notes: "",
    lifecycle: "active",
    version: 1,
    supersededBySchemaId: null,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    activatedAt: "2026-07-29T00:00:00.000Z",
    properties: [
      {
        id: "odsp-1",
        parameterSpecId: "",
        parameterSpecVersionId: null,
        propertyKey: "vout_ovp_mv",
        valueShape: { kind: "u32-array" },
        units: "mV",
        constraints: {},
        exampleValue: null,
        documentation: "ovp",
        specLifecycle: "active",
        sortOrder: 0,
      },
    ],
    ...overrides,
  };
}

describe("organizationDriverSchemaMaterialize", () => {
  it("uses subject-scoped ids so overlay matches share provisional identity", () => {
    const schema = overlayRecord();
    const { properties } = materializeOrganizationDriverSchema(schema, {
      attributionSubjectId: OVERLAY_SUBJECT,
    });
    const expected = buildSubjectScopedManualSpecIds({
      organizationId: "org-1",
      attributionSubjectId: OVERLAY_SUBJECT,
      propertyKey: "vout_ovp_mv",
    });
    expect(properties[0]?.parameterSpecId).toBe(expected.parameterSpecId);
    expect(properties[0]?.id).toBe(expected.parameterSpecVersionId);
    expect(displayDriverLabelFromOverlayCompatible("vendor,overlay-chip")).toBe("overlay-chip");
  });

  it("never lets an active overlay shadow a vendor driver for the same compatible", () => {
    const pinned = pinnedVendorRegistry();
    const overlay = overlayRecord({
      compatible: "sc8562",
      properties: [
        {
          id: "odsp-reg",
          parameterSpecId: "",
          parameterSpecVersionId: null,
          propertyKey: "reg",
          valueShape: { kind: "u32-array" },
          units: null,
          constraints: {},
          exampleValue: null,
          documentation: "should lose",
          specLifecycle: "active",
          sortOrder: 0,
        },
      ],
    });
    const merged = mergePinnedRegistryWithOverlay(pinned, [overlay], {
      attributionSubjectIdByOverlayId: new Map([[overlay.id, OVERLAY_SUBJECT]]),
    });
    const decision = matchDriver(
      {
        nodeLocator: "/soc/sc8562@6e",
        name: "sc8562",
        compatible: ["sc8562"],
        properties: { reg: { rawText: "<0x6e>" } },
      },
      merged,
    );
    expect(decision.kind).toBe("matched");
    if (decision.kind === "matched") {
      expect(decision.value.source).toBe("vendor");
    }
    const property = matchProperty(
      {
        nodeLocator: "/soc/sc8562@6e",
        name: "sc8562",
        compatible: ["sc8562"],
        properties: { reg: { rawText: "<0x6e>" } },
      },
      "reg",
      merged,
    );
    expect(property.kind).toBe("matched");
    if (property.kind === "matched") {
      expect(property.value.source).toBe("vendor");
    }
  });

  it("draft overlays never match; active overlays fill uncovered compatibles", () => {
    const pinned = pinnedVendorRegistry();
    const draft = overlayRecord({ lifecycle: "draft", compatible: "vendor,only-overlay" });
    const active = overlayRecord({
      id: "ods-active",
      lifecycle: "active",
      compatible: "vendor,only-overlay",
    });

    const subjectByOverlay = new Map([
      [draft.id, OVERLAY_SUBJECT],
      [active.id, OVERLAY_SUBJECT],
    ]);

    const draftMerged = mergePinnedRegistryWithOverlay(pinned, [draft], {
      attributionSubjectIdByOverlayId: subjectByOverlay,
    });
    expect(
      matchDriver(
        {
          nodeLocator: "/soc/chip@0",
          name: "chip",
          compatible: ["vendor,only-overlay"],
          properties: {},
        },
        draftMerged,
      ).kind,
    ).toBe("unmatched");

    const activeMerged = mergePinnedRegistryWithOverlay(pinned, [active], {
      attributionSubjectIdByOverlayId: subjectByOverlay,
    });
    const decision = matchDriver(
      {
        nodeLocator: "/soc/chip@0",
        name: "chip",
        compatible: ["vendor,only-overlay"],
        properties: { vout_ovp_mv: { rawText: "<5000>" } },
      },
      activeMerged,
    );
    expect(decision.kind).toBe("matched");
    if (decision.kind === "matched") {
      expect(decision.value.source).toBe("manual");
      expect(decision.value.id).toContain("org/org-1/");
    }
  });
});
