import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedOrganization } from "../../testing/fixtures";
import { installParameterModuleComparisonCatalogFixture } from "../../testing/parameterCatalog/registryProjection";
import { CatalogSubjectId } from "../parameter-catalog-contract";
import type { AuthContext } from "../auth/types";
import * as governanceQueries from "../parameter-governance/queries";
import * as pinCache from "../catalog-publication/runtime/pinCache";
import { readPinnedCatalogSubjectsForComparison, readPinnedGovernanceRegistrationsForComparison } from "./productionWire";

describe("MOD comparison Governance query seam", () => {
  const fixtures: ParameterCatalogDatabase[] = [];
  afterAll(async () => { await Promise.all(fixtures.map((fixture) => fixture.close())); });

  it("distinguishes a true empty result from second-org failure, malformed page and query exception", async () => {
    const fixture = await createDisposableParameterCatalogDatabase("modqseam");
    fixtures.push(fixture);
    const database = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(database)!;
    try {
      const { pin } = await installParameterModuleComparisonCatalogFixture(pool);
      await seedOrganization(pool, { id: "mod-seam-org-a" });
      await seedOrganization(pool, { id: "mod-seam-org-b" });
      const organizations = ["mod-seam-org-a", "mod-seam-org-b"];
      const empty = await readPinnedGovernanceRegistrationsForComparison(pool, organizations, pin);
      expect([...empty]).toEqual(organizations.map((organizationId) => [organizationId, []]));

      const realFactory = governanceQueries.createGovernanceCatalogQueries;
      const unavailable = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => {
        const real = realFactory(client);
        return { ...real, listRegistrations: async (query) => query.organizationId === "mod-seam-org-b"
          ? { ok: false, error: { kind: "query-unavailable", operation: "listRegistrations" } }
          : real.listRegistrations(query) };
      });
      await expect(readPinnedGovernanceRegistrationsForComparison(pool, organizations, pin))
        .rejects.toThrow("Registration query failed for mod-seam-org-b");
      unavailable.mockRestore();

      const malformed = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => {
        const real = realFactory(client);
        return { ...real, listRegistrations: async (query) => query.organizationId === "mod-seam-org-a"
          ? { ok: true, value: { semantics: "current-projection", items: null, nextCursor: null } } as never
          : real.listRegistrations(query) };
      });
      await expect(readPinnedGovernanceRegistrationsForComparison(pool, organizations, pin))
        .rejects.toThrow("Registration response malformed for mod-seam-org-a");
      malformed.mockRestore();

      const exception = vi.spyOn(governanceQueries, "createGovernanceCatalogQueries").mockImplementation((client) => ({
        ...realFactory(client), listRegistrations: async () => { throw new Error("controlled-query-exception"); },
      }));
      await expect(readPinnedGovernanceRegistrationsForComparison(pool, organizations, pin))
        .rejects.toThrow("controlled-query-exception");
      exception.mockRestore();
      expect([...await readPinnedGovernanceRegistrationsForComparison(pool, organizations, pin)]).toEqual([...empty]);
    } finally {
      await database.close();
    }
  });

  it("uses production readiness and exact pinned Subject lookup per authorized organization", async () => {
    const fixture = await createDisposableParameterCatalogDatabase("modsubapi");
    fixtures.push(fixture);
    const database = createPostgresDatabase(fixture.url);
    const pool = getRootPostgresPool(database)!;
    const auth = (organizationId: string): AuthContext => ({
      user: { id: `mod-reader-${organizationId}`, organizationId, name: "MOD reader",
        email: `${organizationId}@example.test`, title: "Reader", isActive: true },
      organization: { id: organizationId, name: organizationId },
      roles: [{ projectId: null, roleId: "admin" }], permissions: ["parameter:view"],
    });
    try {
      const { pin, additionalSubjectIds } = await installParameterModuleComparisonCatalogFixture(pool, 1);
      await seedOrganization(pool, { id: "mod-sub-api-a" });
      await seedOrganization(pool, { id: "mod-sub-api-b" });
      const scopes = [
        { organizationId: "mod-sub-api-a", auth: auth("mod-sub-api-a"),
          subjectIds: [CatalogSubjectId("csub_acme_power"), CatalogSubjectId("csub_absent")] },
        { organizationId: "mod-sub-api-b", auth: auth("mod-sub-api-b"), subjectIds: additionalSubjectIds },
      ];
      const result = await readPinnedCatalogSubjectsForComparison(pool, database, scopes, pin);
      expect(result.get("mod-sub-api-a")?.get("csub_acme_power")).toMatchObject({
        id: "csub_acme_power", kind: "driver",
        membership: { selector: { kind: "driver-compatible", values: ["acme,power"] } },
      });
      expect(result.get("mod-sub-api-a")?.get("csub_absent")).toBeNull();
      expect(result.get("mod-sub-api-b")?.get(additionalSubjectIds[0]!)).toMatchObject({
        id: additionalSubjectIds[0], kind: "driver",
      });
      await expect(readPinnedCatalogSubjectsForComparison(pool, database,
        [{ ...scopes[1]!, auth: auth("mod-sub-api-a") }], pin))
        .rejects.toThrow("Catalog Subject read unauthorized for mod-sub-api-b");
      await expect(readPinnedCatalogSubjectsForComparison(pool, database, scopes, {
        ...pin, digest: `sha256:${"0".repeat(64)}` as typeof pin.digest,
      })).rejects.toThrow("Catalog release differs from comparison input");

      const capture = pinCache.captureCurrentCatalogPin;
      let reads = 0;
      const drift = vi.spyOn(pinCache, "captureCurrentCatalogPin").mockImplementation(async (...args) => {
        reads += 1;
        return reads === 4
          ? { ...pin, digest: `sha256:${"0".repeat(64)}` as typeof pin.digest }
          : capture(...args);
      });
      await expect(readPinnedCatalogSubjectsForComparison(pool, database, scopes, pin))
        .rejects.toThrow("Catalog release changed during Subject comparison read");
      drift.mockRestore();
      expect(reads).toBe(4);
    } finally {
      await database.close();
    }
  }, 60_000);
});
