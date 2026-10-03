import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedOrganization } from "../../testing/fixtures";
import {
  installParameterModuleComparisonCatalogFixture,
  registerParameterModuleComparisonDriver,
} from "../../testing/parameterCatalog/registryProjection";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import { createParameterModule } from "../parameters/parameterModuleRepository";
import * as productionWire from "../parameter-catalog-api/productionWire";
import { provideModParameterCatalogComparisonContribution } from "./parameterCatalogComparisonContribution";

describe("MOD D02 production Subject comparison", () => {
  it("reads the exact Subject for a registered module on a published release", async () => {
    const fixture = await createDisposableParameterCatalogDatabase("modd02red");
    const database = createPostgresDatabase(fixture.url);
    try {
      const pool = getRootPostgresPool(database)!;
      const { pin, additionalSubjectIds } = await installParameterModuleComparisonCatalogFixture(pool, 1);
      await seedOrganization(pool, { id: "mod-d02-org" });
      const business = await createParameterModule(pool, { organizationId: "mod-d02-org", name: "Business" });
      const driver = await createParameterModule(pool, {
        organizationId: "mod-d02-org", parentId: business.id, name: "Driver",
        kind: "driver-group", sourceKey: "compatible:acme,power",
      });
      await registerParameterModuleComparisonDriver(pool, {
        organizationId: "mod-d02-org", destinationModuleId: driver.id,
        subjectId: CatalogSubjectId("csub_acme_power"), release: pin,
        idempotencyKey: "mod-d02-register", principalId: "mod-d02-owner",
      });
      await seedOrganization(pool, { id: "mod-d02-other" });
      const otherBusiness = await createParameterModule(pool, { organizationId: "mod-d02-other", name: "Other business" });
      const otherDriver = await createParameterModule(pool, {
        organizationId: "mod-d02-other", parentId: otherBusiness.id, name: "Other driver",
        kind: "driver-group", sourceKey: "compatible:mod-page-0",
      });
      await registerParameterModuleComparisonDriver(pool, {
        organizationId: "mod-d02-other", destinationModuleId: otherDriver.id,
        subjectId: additionalSubjectIds[0]!, release: pin,
        idempotencyKey: "mod-d02-other-register", principalId: "mod-d02-other-owner",
      });
      const state = async () => [...(await productionWire.readPinnedGovernanceRegistrationsForComparison(
        pool, ["mod-d02-org", "mod-d02-other"], pin,
      )).entries()];
      const before = await state();
      const input = {
        database, pool, phase: "pre-activation" as const, inventoryMode: "populated" as const,
        candidateSha: "a".repeat(40), planPin: "mod-d02-plan",
        mappingHeadId: "mod-d02-head", mappingHeadVersion: 1,
        mappingHeadChecksum: createHash("sha256").update("mod-d02-head").digest("hex"),
        catalogSnapshotChecksum: createHash("sha256").update("mod-d02-snapshot").digest("hex"),
        expectedCatalogReleasePin: pin,
      };
      const contribution = await provideModParameterCatalogComparisonContribution(input);
      expect(await state()).toEqual(before);
      const subjectCase = contribution.cases.find((item) =>
        item.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" && item.protectedReference.id === driver.id);
      expect(subjectCase?.canonicalObservation).toMatchObject({
        status: "value",
        value: { organizationId: "mod-d02-org", catalogReleaseId: pin.id,
          catalogReleaseDigest: pin.digest, subject: { id: "csub_acme_power", type: "driver" } },
      });
      expect(subjectCase?.expectedDifference?.typedTarget).toEqual({ kind: "catalog-subject", id: "csub_acme_power" });
      const otherCase = contribution.cases.find((item) =>
        item.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" && item.protectedReference.id === otherDriver.id);
      expect(otherCase?.canonicalObservation).toMatchObject({ status: "value", value: {
        organizationId: "mod-d02-other", subject: { id: additionalSubjectIds[0], type: "driver" },
      } });
      expect(otherCase?.expectedDifference?.typedTarget?.id).toBe(additionalSubjectIds[0]);
      const businessCase = contribution.cases.find((item) =>
        item.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" && item.protectedReference.id === business.id);
      expect(businessCase?.canonicalObservation).toMatchObject({ status: "query-failure", detail: "no-exact-subject-association" });
      expect(businessCase?.expectedDifference).toBeNull();

      const realRead = productionWire.readPinnedCatalogSubjectsForComparison;
      const wrongIdentity = vi.spyOn(productionWire, "readPinnedCatalogSubjectsForComparison")
        .mockImplementation(async (...args) => {
          const byOrganization = await realRead(...args);
          const first = byOrganization.get("mod-d02-org")?.get("csub_acme_power");
          if (!first) throw new Error("first Subject missing");
          const other = new Map(byOrganization.get("mod-d02-other"));
          other.set(additionalSubjectIds[0]!, first);
          byOrganization.set("mod-d02-other", other);
          return byOrganization;
        });
      const wrong = await provideModParameterCatalogComparisonContribution(input);
      wrongIdentity.mockRestore();
      const wrongCase = wrong.cases.find((item) =>
        item.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" && item.protectedReference.id === otherDriver.id);
      expect(wrongCase?.canonicalObservation).toMatchObject({ status: "query-failure", detail: "canonical-subject-identity-mismatch" });
      expect(wrongCase?.expectedDifference).toBeNull();

      const absent = vi.spyOn(productionWire, "readPinnedCatalogSubjectsForComparison")
        .mockImplementation(async (...args) => {
          const byOrganization = await realRead(...args);
          const other = new Map(byOrganization.get("mod-d02-other"));
          other.set(additionalSubjectIds[0]!, null);
          byOrganization.set("mod-d02-other", other);
          return byOrganization;
        });
      const missing = await provideModParameterCatalogComparisonContribution(input);
      absent.mockRestore();
      const missingCase = missing.cases.find((item) =>
        item.comparisonId === "PCAT-CMP-D02-SUBJECT-IDENTITY" && item.protectedReference.id === otherDriver.id);
      expect(missingCase?.canonicalObservation).toMatchObject({ status: "query-failure", detail: "canonical-subject-not-published" });
      expect(missingCase?.expectedDifference).toBeNull();

      const unavailable = vi.spyOn(productionWire, "readPinnedCatalogSubjectsForComparison")
        .mockRejectedValueOnce(new Error("controlled Subject query unavailable"));
      await expect(provideModParameterCatalogComparisonContribution(input))
        .rejects.toThrow("canonical Subject read failed: controlled Subject query unavailable");
      unavailable.mockRestore();
      expect(await state()).toEqual(before);
    } finally {
      await database.close();
      await fixture.close();
    }
  }, 60_000);
});
