import { describe, expect, it } from "vitest";
import { createPostgresDatabase } from "../../shared/database/client";
import { seedCoreGraph } from "../../testing/fixtures";
import { isTestDatabaseAvailable } from "../../testing/testDatabase";
import { withTempDatabase } from "../../testing/tempDatabase";
import { getOrganisationDefaultRow, upsertOrganisationDefault } from "./configurationRepository";
import { SEEDED_RELOAD_CONFIGURATION } from "./configurationTypes";

const databaseAvailable = await isTestDatabaseAvailable();

describe.skipIf(!databaseAvailable)("reload configuration PostgreSQL compare-and-swap", () => {
  it("accepts exactly one concurrent creation and one concurrent edit, preserving the winner and timestamp precision", async () => {
    await withTempDatabase({ prefix: "reload_configuration_cas" }, async ({ db, connectionString }) => {
      await seedCoreGraph(db, {
        organization: { id: "org-1", name: "Configuration CAS test" },
        users: [{ id: "user-1", name: "Configuration admin", email: "configuration@example.com" }]
      });
      const root = createPostgresDatabase(connectionString);
      const input = { organizationId: "org-1", updatedByUserId: "user-1", contract: SEEDED_RELOAD_CONFIGURATION };
      try {
        const creates = await Promise.allSettled([
          upsertOrganisationDefault(root, { ...input, expectedUpdatedAt: null }),
          upsertOrganisationDefault(root, { ...input, expectedUpdatedAt: null })
        ]);
        expect(creates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(creates.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
        const first = await getOrganisationDefaultRow(root, "org-1");
        expect(first?.updated_at).toMatch(/\.\d{6}Z$/);

        const edits = await Promise.allSettled([
          upsertOrganisationDefault(root, { ...input, contract: { ...input.contract, destinationDirectory: "/winner-a/" }, expectedUpdatedAt: first!.updated_at }),
          upsertOrganisationDefault(root, { ...input, contract: { ...input.contract, kernelLogCommand: "hilog" }, expectedUpdatedAt: first!.updated_at })
        ]);
        expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        expect(edits.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
        const winner = edits.find((result) => result.status === "fulfilled");
        const stored = await getOrganisationDefaultRow(root, "org-1");
        expect(stored).toEqual(winner?.status === "fulfilled" ? winner.value : null);
        expect(stored?.updated_at).not.toBe(first?.updated_at);
        await expect(upsertOrganisationDefault(root, { ...input, expectedUpdatedAt: null })).rejects.toMatchObject({ code: "CONFLICT" });

        // Multiple updates in one transaction still get distinct versions; now() would not.
        await root.transaction(async (tx) => {
          const second = await upsertOrganisationDefault(tx, { ...input, expectedUpdatedAt: stored!.updated_at });
          const third = await upsertOrganisationDefault(tx, { ...input, expectedUpdatedAt: second.updated_at });
          expect(third.updated_at).not.toBe(second.updated_at);
        });
      } finally {
        await root.close();
      }
    });
  });
});
