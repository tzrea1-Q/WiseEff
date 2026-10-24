import { describe, expect, it } from "vitest";
import { CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID, CATALOG_RELEASE_ID } from "./fixtures";
import { createMockParameterCatalogGovernanceRepository } from "./mockAdapter";

describe("single-registration mock placement ownership", () => {
  it("refuses a replacement it cannot validate instead of pretending to displace another subject", async () => {
    const repository = createMockParameterCatalogGovernanceRepository();
    const before = await repository.getPlacement(CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID);
    await expect(repository.updatePlacement(CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID, {
      placement: { mode: "use-default" }, destinationModuleId: "other-module",
      replacement: { registrationId: "another-registration", placementEtag: '"another-placement:1"',
        registrationEtag: '"another-registration:active:1"', reason: "repair" }
    }, { catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: "etag-reg", idempotencyKey: "mock-replacement" }))
      .rejects.toMatchObject({ details: { reason: "placement-conflict" } });
    expect(await repository.getPlacement(CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID)).toEqual(before);
  });
});
