import { afterAll, describe, expect, it, vi } from "vitest";

import { createPostgresDatabase, getRootPostgresPool } from "../../shared/database/client";
import { createDisposableParameterCatalogDatabase, type ParameterCatalogDatabase } from "../../testing/parameterCatalog";
import { seedOrganization } from "../../testing/fixtures";
import { installParameterModuleComparisonCatalogFixture } from "../../testing/parameterCatalog/registryProjection";
import * as governanceQueries from "../parameter-governance/queries";
import { readPinnedGovernanceRegistrationsForComparison } from "./productionWire";

describe("MOD comparison Governance query seam", () => {
  let fixture: ParameterCatalogDatabase;
  afterAll(async () => fixture?.close());

  it("distinguishes a true empty result from second-org failure, malformed page and query exception", async () => {
    fixture = await createDisposableParameterCatalogDatabase("modqseam");
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
});
