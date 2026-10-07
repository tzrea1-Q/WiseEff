import { createHash } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedOrganization } from "../../testing/fixtures";
import {
  installParameterModuleComparisonCatalogFixture,
  registerParameterModuleComparisonDriver,
} from "../../testing/parameterCatalog/registryProjection";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import * as productionWire from "../parameter-catalog-api/productionWire";
import * as pinCache from "../catalog-publication/runtime/pinCache";
import { listDismissedCompatibleIdentitiesForComparison } from "./comparisonInventoryRepository";
import { provideModParameterCatalogComparisonContribution } from "./parameterCatalogComparisonContribution";

describe("MOD production comparison canonical Governance read", () => {
  let fixture: ParameterCatalogDatabase;
  afterAll(async () => fixture?.close());

  it("reads actual published Registrations and Placements for both organizations", async () => {
    fixture = await createDisposableParameterCatalogDatabase("modrealq");
    const database = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(database)!;
    try {
      const { pin, additionalSubjectIds } = await installParameterModuleComparisonCatalogFixture(pool, 100);
      const persisted: Array<{ organizationId: string; registrationId: string; placementId: string; moduleId: string }> = [];
      let primaryBusinessModuleId = "";
      for (const suffix of ["a", "b"]) {
        const organizationId = `mod-real-org-${suffix}`;
        await seedOrganization(pool, { id: organizationId });
        const business = await createParameterModule(pool, { organizationId, name: `Business ${suffix}` });
        if (suffix === "a") primaryBusinessModuleId = business.id;
        const module = await createParameterModule(pool, {
          organizationId, parentId: business.id, name: `Driver ${suffix}`,
          kind: "driver-group", sourceKey: "compatible:acme,power",
        });
        const registered = await registerParameterModuleComparisonDriver(pool, {
          organizationId, destinationModuleId: module.id, release: pin,
          subjectId: CatalogSubjectId("csub_acme_power"),
          idempotencyKey: `mod-real-register-${suffix}`,
          principalId: `mod-real-owner-${suffix}`,
        });
        persisted.push({ organizationId, registrationId: registered.registrationId,
          placementId: registered.placementId, moduleId: module.id });
      }
      const pagedRegistrationIds: string[] = [];
      for (let index = 0; index < 100; index += 1) {
        const organizationId = "mod-real-org-a";
        const module = await createParameterModule(pool, {
          organizationId, parentId: primaryBusinessModuleId, name: `Driver page ${index}`, kind: "driver-group",
          sourceKey: `compatible:mod-page-${index}`,
        });
        const registered = await registerParameterModuleComparisonDriver(pool, {
          organizationId, subjectId: additionalSubjectIds[index]!, destinationModuleId: module.id,
          release: pin, idempotencyKey: `mod-page-register-${index}`, principalId: "mod-real-owner-a",
        });
        pagedRegistrationIds.push(registered.registrationId);
      }
      const input = {
        database,
        pool,
        phase: "pre-activation" as const,
        inventoryMode: "populated" as const,
        candidateSha: "a".repeat(40),
        planPin: "mod-real-plan",
        mappingHeadId: "mod-real-head",
        mappingHeadVersion: 1,
        mappingHeadChecksum: createHash("sha256").update("mod-real-head").digest("hex"),
        catalogSnapshotChecksum: createHash("sha256").update("mod-real-snapshot").digest("hex"),
        expectedCatalogReleasePin: pin,
      };
      const state = async () => ({
        registrations: [...(await productionWire.readPinnedGovernanceRegistrationsForComparison(
          pool, ["mod-real-org-a", "mod-real-org-b"], pin,
        )).entries()],
        dismissals: await Promise.all(["mod-real-org-a", "mod-real-org-b"].map((organizationId) =>
          listDismissedCompatibleIdentitiesForComparison(database, organizationId))),
        audits: (await pool.query<{ count: number }>("select count(*)::int as count from audit_events")).rows[0]?.count,
      });
      const beforeRead = await state();
      const contribution = await provideModParameterCatalogComparisonContribution(input);
      expect(await state()).toEqual(beforeRead);
      const registrationCases = contribution.cases.filter((item) =>
        persisted.some((row) => row.registrationId === item.protectedReference.id));
      expect(registrationCases.map((item) => item.protectedReference.id).sort())
        .toEqual(persisted.map((item) => item.registrationId).sort());
      for (const row of persisted) {
        const item = registrationCases.find((entry) => entry.protectedReference.id === row.registrationId);
        expect(item?.canonicalObservation).toMatchObject({
          status: "value",
          value: { organizationId: row.organizationId, registration: {
            id: row.registrationId, subjectId: "csub_acme_power", status: "active",
            method: "explicit", placementId: row.placementId,
            placement: { moduleId: row.moduleId },
          } },
        });
        const placement = contribution.cases.find((entry) => entry.protectedReference.id === row.placementId);
        expect(placement?.protectedReference.kind).toBe("subject-placement");
        const legacyModuleId = row.moduleId;
        const legacyCase = contribution.cases.find((entry) => entry.protectedReference.id === legacyModuleId
          && entry.protectedReference.kind === "subject-registration");
        expect(legacyCase?.canonicalObservation).toMatchObject({ status: "value", value: {
          organizationId: row.organizationId,
          registration: { id: row.registrationId, placement: { moduleId: legacyModuleId } },
        } });
      }
      expect(contribution.cases.filter((item) => pagedRegistrationIds.includes(item.protectedReference.id))).toHaveLength(100);
      expect(contribution.cases.filter((item) => item.canonicalObservation.status === "value"
        && item.canonicalObservation.value.organizationId === "mod-real-org-a"
        && item.canonicalObservation.value.itemCount === 101).length).toBeGreaterThan(100);

      await expect(provideModParameterCatalogComparisonContribution({ ...input, expectedCatalogReleasePin: undefined }))
        .rejects.toThrow("expected Catalog release pin missing");
      await expect(provideModParameterCatalogComparisonContribution({
        ...input, expectedCatalogReleasePin: { ...pin, digest: `sha256:${"0".repeat(64)}` as typeof pin.digest },
      })).rejects.toThrow("Catalog release differs from comparison input");

      const realRead = productionWire.readPinnedGovernanceRegistrationsForComparison;
      const changedPlacement = vi.spyOn(productionWire, "readPinnedGovernanceRegistrationsForComparison")
        .mockImplementation(async (...args) => {
          const byOrganization = await realRead(...args);
          const rows = byOrganization.get("mod-real-org-a")!;
          byOrganization.set("mod-real-org-a", rows.map((item) => item.id === persisted[0]!.registrationId
            ? { ...item, placement: { ...item.placement, displayName: "controlled-placement-change" } }
            : item));
          return byOrganization;
      });
      const changed = await provideModParameterCatalogComparisonContribution(input);
      expect(changed.sourceInventoryChecksum).toBe(contribution.sourceInventoryChecksum);
      expect(changed.checksum).not.toBe(contribution.checksum);
      changedPlacement.mockRestore();

      const failure = vi.spyOn(productionWire, "readPinnedGovernanceRegistrationsForComparison")
        .mockRejectedValue(new Error("Registration query failed for mod-real-org-b"));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("Registration query failed for mod-real-org-b");
      failure.mockRestore();

      const malformed = vi.spyOn(productionWire, "readPinnedGovernanceRegistrationsForComparison")
        .mockRejectedValue(new Error("Registration response malformed for mod-real-org-a"));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("Registration response malformed");
      malformed.mockRestore();

      const exception = vi.spyOn(productionWire, "readPinnedGovernanceRegistrationsForComparison")
        .mockRejectedValue(new Error("injected-governance-query-exception"));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("canonical Registration read failed");
      exception.mockRestore();

      const capture = pinCache.captureCurrentCatalogPin;
      const drift = vi.spyOn(pinCache, "captureCurrentCatalogPin")
        .mockImplementationOnce(capture)
        .mockResolvedValueOnce({ ...pin, digest: `sha256:${"0".repeat(64)}` as typeof pin.digest });
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("Catalog release changed during comparison read");
      drift.mockRestore();
      expect(await state()).toEqual(beforeRead);
    } finally {
      await database.close();
    }
  }, 120_000);
});
