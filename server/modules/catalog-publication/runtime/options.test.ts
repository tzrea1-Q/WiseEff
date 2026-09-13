import { describe, expect, it } from "vitest";

import {
  CATALOG_PUBLICATION_DATA_MODE_ENV,
  resolveCatalogPublicationRuntimeOptions,
} from "./readiness";

describe("catalog publication runtime option composition", () => {
  it("lets an explicit populated option win over env and does not bury new-empty", () => {
    expect(
      resolveCatalogPublicationRuntimeOptions({
        dataMode: "populated",
        env: { [CATALOG_PUBLICATION_DATA_MODE_ENV]: "new-empty" },
      }).dataMode,
    ).toBe("populated");
  });

  it("reads populated from the named env when no option is supplied", () => {
    expect(
      resolveCatalogPublicationRuntimeOptions({
        env: { [CATALOG_PUBLICATION_DATA_MODE_ENV]: "populated" },
      }).dataMode,
    ).toBe("populated");
  });

  it("defaults to new-empty only at the composition edge", () => {
    expect(resolveCatalogPublicationRuntimeOptions({}).dataMode).toBe("new-empty");
    expect(
      resolveCatalogPublicationRuntimeOptions({
        env: { [CATALOG_PUBLICATION_DATA_MODE_ENV]: "unknown" },
      }).dataMode,
    ).toBe("new-empty");
  });
});
