import { describe, expect, it } from "vitest";

import { createRouter } from "../../shared/http/router";
import { parameterCatalogCanonicalRoutes } from "../contracts/dtoSchemas/parameterCatalog";
import { registerParameterCatalogApi } from "./productionWire";

describe("#897 C2 driver-compatible discovery route", () => {
  it("registers the canonical GET in the production Catalog composition", () => {
    const route = parameterCatalogCanonicalRoutes.find((entry) =>
      entry.id === "catalog.listDriverCompatibleDiscovery");
    expect(route).toMatchObject({
      method: "GET",
      path: "/api/v2/organizations/:organizationId/driver-compatible-discovery",
    });
    const router = createRouter();
    registerParameterCatalogApi(router, { resolveAuth: () => { throw new Error("not called"); } });
    expect(router.listRoutes()).toContainEqual({ method: "GET", pattern: route?.path });
  });
});
