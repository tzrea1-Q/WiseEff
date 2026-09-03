import { describe, expect, it } from "vitest";

import { createRouter } from "../../../shared/http/router";
import {
  parameterCatalogCanonicalRoutes,
  parameterCatalogKernelReadByRouteId,
} from "../../contracts/dtoSchemas/parameterCatalog";
import { registerCatalogReadRoutes } from "./routes";
import type { CatalogReadPorts } from "./types";

const frozenReadKeys = parameterCatalogCanonicalRoutes
  .filter((route) => route.method === "GET" && route.id in parameterCatalogKernelReadByRouteId)
  .map((route) => `GET ${route.path}`);

describe("S8-READ WiseEff router registration", () => {
  it("registers the nine frozen S8-CON catalog GET routes on createRouter().listRoutes()", () => {
    const router = createRouter();
    registerCatalogReadRoutes(router, {} as CatalogReadPorts);
    expect(frozenReadKeys).toHaveLength(9);
    expect(router.listRoutes().map((route) => `${route.method} ${route.pattern}`).sort()).toEqual(
      [...frozenReadKeys].sort(),
    );
  });
});
