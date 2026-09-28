import { createHash } from "node:crypto";

import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { compileCatalogRelease } from "../catalog-kernel/compiler";
import { refreshAuthoritativeSource, validCatalogReleaseBundle } from "../catalog-kernel/compiler/__fixtures__/catalogReleaseBundle";
import { jsonCatalogReleaseSource } from "../catalog-kernel/interface";
import { installPublishedRelease } from "../catalog-kernel/install/installer";
import { CatalogSubjectId, type CatalogReleasePin } from "../parameter-catalog-contract";
import { createRegistrationService } from "../parameter-governance/registration";
import * as governanceQueries from "../parameter-governance/queries";
import * as pinCache from "../catalog-publication/runtime/pinCache";
import { provideModParameterCatalogComparisonContribution } from "./parameterCatalogComparisonContribution";

describe("MOD production comparison canonical Governance read", () => {
  let fixture: ParameterCatalogDatabase;
  afterAll(async () => fixture?.close());

  it("reads actual published Registrations and Placements for both organizations", async () => {
    fixture = await createDisposableParameterCatalogDatabase("modrealq");
    const database = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(database)!;
    try {
      const complete = validCatalogReleaseBundle();
      const first = structuredClone(complete.releases[0]!);
      const template = first.documents.find((document) => document.kind === "subject")!;
      for (let index = 0; index < 100; index += 1) {
        const clone = structuredClone(template);
        Object.assign(clone.content, {
          id: `csub_mod_page_${index}`,
          canonicalKey: `driver:mod-page-${index}`,
          selector: { ...clone.content.selector, value: `mod-page-${index}` },
        });
        first.documents.push(clone);
      }
      refreshAuthoritativeSource(first as Parameters<typeof refreshAuthoritativeSource>[0]);
      const bundle = { schemaVersion: complete.schemaVersion, targetReleaseId: first.manifest.release.id, releases: [first] };
      const compiled = compileCatalogRelease(bundle);
      if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
      const installed = await installPublishedRelease(pool, {
        mode: "bootstrap",
        source: jsonCatalogReleaseSource(bundle),
        expectedTargetDigest: compiled.value.aggregateDigest,
      });
      expect(installed.ok).toBe(true);
      const pin: CatalogReleasePin = { id: compiled.value.release.id, digest: compiled.value.release.digest };
      const writes = createRegistrationService(pool);
      const persisted: Array<{ organizationId: string; registrationId: string; placementId: string }> = [];
      for (const suffix of ["a", "b"]) {
        const organizationId = `mod-real-org-${suffix}`;
        const attributionId = `mod-real-attr-${suffix}`;
        const moduleId = `mod-real-driver-${suffix}`;
        await pool.query("insert into organizations (id, name) values ($1, $2)", [organizationId, organizationId]);
        await pool.query(
          "insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key) values ($1, $2, 'driver-registration', $3, $4)",
          [attributionId, organizationId, attributionId, "compatible:acme,power"],
        );
        await pool.query(
          "insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality) values ($1, 'physical-device', 'multiple')",
          [attributionId],
        );
        await pool.query(
          "insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id) values ($1, $2, $3, $3, 1, 'driver-group', 'curated', $4)",
          [moduleId, organizationId, moduleId, attributionId],
        );
        const registered = await writes.execute({
          kind: "register",
          organizationId,
          subjectId: CatalogSubjectId("csub_acme_power"),
          subjectKind: "driver",
          expectedRelease: pin,
          placement: { mode: "use-default" },
          destinationModuleId: moduleId,
          method: "explicit",
          proof: { reason: "mod-comparison-real-governance" },
          idempotencyKey: `mod-real-register-${suffix}`,
          context: { actorKind: "org-admin", principalId: `mod-real-owner-${suffix}` },
        });
        if (!registered.ok) throw new Error(JSON.stringify(registered.error));
        persisted.push({ organizationId, registrationId: registered.value.registrationId, placementId: registered.value.placementId });
      }
      const pagedRegistrationIds: string[] = [];
      for (let index = 0; index < 100; index += 1) {
        const organizationId = "mod-real-org-a";
        const attributionId = `mod-page-attr-${index}`;
        const moduleId = `mod-page-module-${index}`;
        await pool.query(
          "insert into attribution_subjects (id, organization_id, subject_kind, display_name, source_key) values ($1, $2, 'driver-registration', $3, $4)",
          [attributionId, organizationId, attributionId, `compatible:mod-page-${index}`],
        );
        await pool.query(
          "insert into driver_registrations (attribution_subject_id, driver_nature, instance_cardinality) values ($1, 'physical-device', 'multiple')",
          [attributionId],
        );
        await pool.query(
          "insert into parameter_modules (id, organization_id, name, path, depth, kind, origin, attribution_subject_id) values ($1, $2, $3, $3, 1, 'driver-group', 'curated', $4)",
          [moduleId, organizationId, moduleId, attributionId],
        );
        const registered = await writes.execute({
          kind: "register", organizationId, subjectId: CatalogSubjectId(`csub_mod_page_${index}`),
          subjectKind: "driver", expectedRelease: pin, placement: { mode: "use-default" },
          destinationModuleId: moduleId, method: "explicit",
          proof: { reason: "mod-comparison-pagination" }, idempotencyKey: `mod-page-register-${index}`,
          context: { actorKind: "org-admin", principalId: "mod-real-owner-a" },
        });
        if (!registered.ok) throw new Error(JSON.stringify(registered.error));
        pagedRegistrationIds.push(registered.value.registrationId);
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
      const state = async () => (await pool.query(`select
        (select count(*)::int from parameter_catalog.organization_subject_registrations) as registrations,
        (select count(*)::int from parameter_catalog.subject_placements) as placements,
        (select count(*)::int from parameter_module_dismissed_compatibles) as dismissals,
        (select count(*)::int from audit_events) as audits`)).rows[0];
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
            placement: { moduleId: row.organizationId.replace("org", "driver") },
          } },
        });
        const placement = contribution.cases.find((entry) => entry.protectedReference.id === row.placementId);
        expect(placement?.protectedReference.kind).toBe("subject-placement");
        const legacyModuleId = row.organizationId.replace("org", "driver");
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

      const createQueries = governanceQueries.createGovernanceCatalogQueries;
      const changedPlacement = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => {
        const real = createQueries(client);
        return { ...real, listRegistrations: async (query) => {
          const page = await real.listRegistrations(query);
          return page.ok && query.organizationId === "mod-real-org-a"
            ? { ...page, value: { ...page.value, items: page.value.items.map((item) =>
              item.id === persisted[0]!.registrationId
                ? { ...item, placement: { ...item.placement, displayName: "controlled-placement-change" } }
                : item) } }
            : page;
        } };
      });
      const changed = await provideModParameterCatalogComparisonContribution(input);
      expect(changed.sourceInventoryChecksum).toBe(contribution.sourceInventoryChecksum);
      expect(changed.checksum).not.toBe(contribution.checksum);
      changedPlacement.mockRestore();

      const failure = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => ({
        ...createQueries(client),
        listRegistrations: async (query) => query.organizationId === "mod-real-org-b"
          ? { ok: false, error: { kind: "query-unavailable", operation: "listRegistrations" } }
          : createQueries(client).listRegistrations(query),
      }));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("Registration query failed for mod-real-org-b");
      failure.mockRestore();

      const malformed = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => ({
        ...createQueries(client),
        listRegistrations: async (query) => query.organizationId === "mod-real-org-a"
          ? { ok: true, value: { semantics: "current-projection", items: null, nextCursor: null } } as never
          : createQueries(client).listRegistrations(query),
      }));
      await expect(provideModParameterCatalogComparisonContribution(input)).rejects.toThrow("Registration response malformed");
      malformed.mockRestore();

      const exception = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => ({
        ...createQueries(client),
        listRegistrations: async () => { throw new Error("injected-governance-query-exception"); },
      }));
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
