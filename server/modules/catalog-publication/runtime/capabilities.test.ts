import { describe, expect, it } from "vitest";

import {
  CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS,
  admitCatalogCapabilityRevision,
  catalogConsumerSupportsRevision,
} from "./capabilities";
import { CATALOG_CAPABILITY_CONTRACT_REVISION } from "../builder/types";

describe("catalog consumer capability admission", () => {
  it("admits historical v1/v2/v3 and current v4 by exact membership", () => {
    expect(catalogConsumerSupportsRevision("catalog-capability/v1")).toBe(true);
    expect(catalogConsumerSupportsRevision("catalog-capability/v2")).toBe(true);
    expect(catalogConsumerSupportsRevision("catalog-capability/v3")).toBe(true);
    expect(catalogConsumerSupportsRevision(CATALOG_CAPABILITY_CONTRACT_REVISION)).toBe(true);
  });

  it("fail-closes prefix and unknown revisions", () => {
    expect(catalogConsumerSupportsRevision("catalog-capability/v4-beta")).toBe(false);
    expect(catalogConsumerSupportsRevision("catalog-capability/v")).toBe(false);
    expect(catalogConsumerSupportsRevision("catalog-capability/v10")).toBe(false);
    expect(catalogConsumerSupportsRevision("")).toBe(false);
    expect(catalogConsumerSupportsRevision("catalog-capability/v5")).toBe(false);
  });

  it("lets a frozen v3 consumer refuse v4 before install", () => {
    expect(admitCatalogCapabilityRevision("catalog-capability/v4", CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS)).toBe(
      false,
    );
    expect(admitCatalogCapabilityRevision("catalog-capability/v3", CATALOG_CAPABILITY_V3_CONSUMER_REVISIONS)).toBe(
      true,
    );
  });
});
