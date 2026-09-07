import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createPostgresDatabase, getRootPostgresPool, type Database } from "../../shared/database/client";
import { provideCghParameterCatalogComparisonContribution, type CghComparisonContributionInput } from "./parameterCatalogComparisonContribution";

vi.mock("./service", () => ({
  listParameterSpecs: vi.fn(async () => ({ items: [] })),
  listSpecReviewTasks: vi.fn(async () => ({ items: [], nextCursor: null })),
}));

const opened: Array<{ close(): Promise<void> }> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map((item) => item.close())); });

function input(): CghComparisonContributionInput {
  // Pools are lazy; no local/default/ambient database is used by this pure test.
  const database = createPostgresDatabase("postgres://synthetic@127.0.0.1:1/synthetic");
  opened.push(database);
  return {
    database, pool: getRootPostgresPool(database)!, phase: "pre-activation", inventoryMode: "populated",
    candidateSha: "a".repeat(40), planPin: "synthetic-plan", mappingHeadId: "synthetic-head",
    mappingHeadVersion: 1, mappingHeadChecksum: "b".repeat(64), catalogSnapshotChecksum: "c".repeat(64),
  };
}

describe("CGH production router binding", () => {
  it("rejects a different root pool before inventory or canonical queries", async () => {
    const request = input();
    const query = vi.spyOn(request.database, "query").mockRejectedValue(new Error("query must not run"));
    const other = new pg.Pool({ connectionString: "postgres://synthetic@127.0.0.1:1/other" });
    opened.push({ close: () => other.end() });
    await expect(provideCghParameterCatalogComparisonContribution({ ...request, pool: other }))
      .rejects.toThrow("PCAT-CGH-ROOT-POOL-MISMATCH");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a database facade with no issued root pool before inventory queries", async () => {
    const request = input();
    const query = vi.fn(async () => { throw new Error("query must not run"); });
    const facade = { query, close: async () => {} } as unknown as Database;
    await expect(provideCghParameterCatalogComparisonContribution({ ...request, database: facade }))
      .rejects.toThrow("PCAT-CGH-ROOT-POOL-MISMATCH");
    expect(query).not.toHaveBeenCalled();
  });

  it("does not turn unavailable canonical inventory into a verified fresh zero", async () => {
    const request = { ...input(), inventoryMode: "fresh" as const };
    vi.spyOn(request.database, "query").mockResolvedValue({ rows: [], rowCount: 0 });
    vi.spyOn(request.pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await expect(provideCghParameterCatalogComparisonContribution(request)).rejects.toMatchObject({
      code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      observation: { status: "query-failure", code: "503", detail: "catalog-read-list-definitions" },
    });
  });
});
