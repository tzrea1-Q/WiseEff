import { describe, expect, it } from "vitest";

import { parameterCatalogKernelReadByRouteId } from "../../contracts/dtoSchemas/parameterCatalog";
import { catalogReadRouteIds } from "./handlers";
import { THREAT_MATRIX } from "./threatMatrix";

describe("S8-READ threat matrix", () => {
  it("covers kernel closure, isolation, scope hiding, and PCAT-API-01..03", () => {
    expect(THREAT_MATRIX.map((row) => row.name)).toEqual([
      "nine-route-kernel-closure",
      "catalog-isolation",
      "no-post-filter",
      "scope-hiding",
      "catalog-not-ready",
      "release-header-and-cursor",
      "no-revision-fallback",
      "unregistered-and-usage-projection",
      "pcat-api-01-ready-document",
      "pcat-api-02-subject-definition-reads",
      "pcat-api-03-revision-timeline",
    ]);
    expect(catalogReadRouteIds).toHaveLength(9);
    expect(catalogReadRouteIds.sort()).toEqual(Object.keys(parameterCatalogKernelReadByRouteId).sort());
  });
});
