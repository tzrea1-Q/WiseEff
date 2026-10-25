import { describe, expect, it } from "vitest";
import { CATALOG_ORGANIZATION_ID, CATALOG_REGISTRATION_ID, CATALOG_RELEASE_ID, CATALOG_SUBJECT_ID } from "./fixtures";
import { createMockCatalogPorts, createMockParameterCatalogGovernanceRepository } from "./mockAdapter";

describe("single-registration mock placement ownership", () => {
  it("retains a reversible organization retirement for a previously unregistered subject", async () => {
    const { catalog, governance } = createMockCatalogPorts({ scenario: "unregistered" });
    const context = { catalogReleaseId: CATALOG_RELEASE_ID, idempotencyKey: "remove-unregistered" };
    const body = { subjectId: CATALOG_SUBJECT_ID, status: "retired" as const, placement: { mode: "use-default" as const }, reason: "not used" };
    const removed = await governance.createRegistration(CATALOG_ORGANIZATION_ID, body, context);
    expect(removed.item.status).toBe("retired");
    expect(removed.item.placement.moduleId ?? null).toBeNull();
    expect((await catalog.getSubject(CATALOG_SUBJECT_ID)).item.registration.status).toBe("retired");
    await governance.restoreRegistration(CATALOG_ORGANIZATION_ID, removed.item.id, { reason: "use again" },
      { catalogReleaseId: CATALOG_RELEASE_ID, ifMatch: "etag-reg", idempotencyKey: "restore-unregistered" });
    await governance.createRegistration(CATALOG_ORGANIZATION_ID, body, context);
    expect((await governance.getRegistration(CATALOG_ORGANIZATION_ID, removed.item.id)).item.status).toBe("active");
  });

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
