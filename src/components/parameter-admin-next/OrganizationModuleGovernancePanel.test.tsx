import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_DEFINITION_ID,
  CATALOG_RELEASE_ID,
  activeDefinition
} from "@/application/parameter-catalog/fixtures";
import { listModuleOverlayLibrarySpecs } from "./OrganizationModuleGovernancePanel";

describe("listModuleOverlayLibrarySpecs", () => {
  it("uses catalog listDefinitions when the catalog port is present", async () => {
    const listDefinitions = vi.fn().mockResolvedValue({
      items: [activeDefinition],
      totalCount: 1,
      hasMore: false,
      nextCursor: null,
      catalogReleaseId: CATALOG_RELEASE_ID
    });
    const listSpecs = vi.fn();
    const rows = await listModuleOverlayLibrarySpecs({
      catalog: { listDefinitions },
      listSpecs
    });
    expect(listDefinitions).toHaveBeenCalledTimes(1);
    expect(listSpecs).not.toHaveBeenCalled();
    expect(rows[0]?.id).toBe(CATALOG_DEFINITION_ID);
    expect(rows[0]?.propertyKey).toBe("gpio-int");
  });

  it("falls back to default listSpecs without view=governance when catalog is absent", async () => {
    const listSpecs = vi.fn().mockResolvedValue([
      {
        id: "spec-1",
        organizationId: "org-1",
        propertyKey: "gpio_int",
        specificationKey: "dts/sc8562/gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersion: 1,
        compatiblePatterns: ["vendor,sc8562"],
        valueShape: { kind: "u32" },
        attributionModules: [],
        declaredPlacement: null
      }
    ]);
    const rows = await listModuleOverlayLibrarySpecs({
      catalog: null,
      listSpecs
    });
    expect(listSpecs).toHaveBeenCalledTimes(1);
    expect(listSpecs.mock.calls[0]?.[0]).toBeUndefined();
    expect(JSON.stringify(listSpecs.mock.calls[0])).not.toContain("governance");
    expect(rows[0]?.id).toBe("spec-1");
    expect(rows[0]?.propertyKey).toBe("gpio_int");
  });
});
