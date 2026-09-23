import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_DEFINITION_ID,
  CATALOG_MODULE_ID,
  CATALOG_RELEASE_ID,
  activeDefinition
} from "@/application/parameter-catalog/fixtures";
import type { CatalogListQuery } from "@/infrastructure/http/parameterCatalogDtos";
import { listAllCanonicalPages } from "./CanonicalSubjectPlacementPanel";
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
    expect(rows[0]?.declaredPlacement).toEqual({
      moduleId: CATALOG_MODULE_ID,
      moduleName: "Root",
      categoryId: null,
      categoryName: null
    });
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

  it("reads every active registered definition page for the overlay picker", async () => {
    const secondDefinition = {
      ...activeDefinition,
      id: "pdef_extra_119",
      propertyKey: "extra_119"
    };
    const queries: CatalogListQuery[] = [];
    const listDefinitions = vi.fn(async (query?: CatalogListQuery) => {
      queries.push(query ?? {});
      if (query?.cursor === "page-2") {
        return {
          items: [secondDefinition],
          totalCount: 2,
          hasMore: false,
          nextCursor: null,
          catalogReleaseId: CATALOG_RELEASE_ID
        };
      }
      return {
        items: [activeDefinition],
        totalCount: 2,
        hasMore: true,
        nextCursor: "page-2",
        catalogReleaseId: CATALOG_RELEASE_ID
      };
    });

    const rows = await listModuleOverlayLibrarySpecs({
      catalog: { listDefinitions },
      listSpecs: vi.fn()
    });

    expect(queries).toEqual([
      { lifecycle: "active", registration: "active", limit: 50 },
      { lifecycle: "active", registration: "active", limit: 50, cursor: "page-2" }
    ]);
    expect(rows.map((row) => row.propertyKey)).toEqual(["gpio-int", "extra_119"]);
  });

  it("stops instead of looping when a canonical cursor repeats", async () => {
    const fetchPage = vi.fn(async (query: CatalogListQuery) => ({
      items: [],
      totalCount: 0,
      hasMore: true,
      nextCursor: query.cursor ?? "page-1",
      catalogReleaseId: CATALOG_RELEASE_ID
    }));

    await expect(listAllCanonicalPages(fetchPage, { limit: 50 })).rejects.toThrow(
      "无效分页游标"
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
