import { afterEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { createPostgresDatabase, getRootPostgresPool, type Database } from "../../shared/database/client";
import { provideCghParameterCatalogComparisonContribution, type CghComparisonContributionInput } from "./parameterCatalogComparisonContribution";
import * as productionWire from "../parameter-catalog-api/productionWire";

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
    const query = vi.spyOn(request.pool, "query").mockRejectedValue(new Error("query must not run"));
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
    vi.spyOn(request.pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    await expect(provideCghParameterCatalogComparisonContribution(request)).rejects.toMatchObject({
      code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
      observation: { status: "query-failure", code: "503", detail: "catalog-read-list-definitions" },
    });
  });

  it("uses the formal router and current pointer with no governance command pool", async () => {
    const request = { ...input(), inventoryMode: "fresh" as const };
    const query = vi.spyOn(request.pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const register = vi.spyOn(productionWire, "registerParameterCatalogApi");
    await expect(provideCghParameterCatalogComparisonContribution(request)).rejects.toMatchObject({
      code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    });
    expect(register).toHaveBeenCalledTimes(1);
    const [router, options] = register.mock.calls[0];
    expect(options.db).toBe(request.database);
    expect(options.requireSeparateGovernancePool).toBe(true);
    expect(options.governanceDb).toBeUndefined();
    expect(router.listRoutes().some((route) => route.method === "GET" && route.pattern === "/api/v2/catalog/definitions")).toBe(true);
    expect(query.mock.calls.some(([sql]) => typeof sql === "string" && sql.includes("state.current_catalog_release_id"))).toBe(true);
  });

  it("keeps the verified root when the caller changes its input after the first query", async () => {
    const request = input();
    const verified = request.database;
    const other = input();
    const otherQuery = vi.spyOn(other.pool, "query").mockRejectedValue(new Error("wrong target must not run"));
    vi.spyOn(request.pool, "query").mockImplementation(async () => {
      Object.assign(request, { database: other.database, pool: other.pool });
      return { rows: [], rowCount: 0 } as never;
    });
    const register = vi.spyOn(productionWire, "registerParameterCatalogApi");
    await expect(provideCghParameterCatalogComparisonContribution(request)).rejects.toMatchObject({
      code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    });
    expect(register.mock.calls[0][1].db).toBe(verified);
    expect(otherQuery).not.toHaveBeenCalled();
  });

  it("does not activate the Review GET reader's lazy write through the query pool", async () => {
    const request = input();
    const query = vi.spyOn(request.pool, "query").mockResolvedValue({ rows: [], rowCount: 0 } as never);
    const register = vi.spyOn(productionWire, "registerParameterCatalogApi");
    await expect(provideCghParameterCatalogComparisonContribution(request)).rejects.toMatchObject({
      code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
    });
    // Supply only the actual pointer query's rows at the database I/O seam.
    // No private Kernel or Governance implementation is imported or mocked.
    query.mockImplementation(async (statement) => {
      if (typeof statement !== "string" || !/^\s*select\b/i.test(statement)) {
        throw new Error("comparison-query-must-not-write");
      }
      return { rows: [{ current_catalog_release_id: "crel_synthetic", release_version: "1.0.0", release_digest: `sha256:${"d".repeat(64)}`, predecessor_release_id: null }], rowCount: 1 } as never;
    });
    query.mockClear();
    const [router] = register.mock.calls[0];
    const response = await router.handle({
      method: "GET", path: "/api/v2/organizations/platform/parameter-review-items",
      params: {}, query: {}, headers: {}, requestId: "synthetic-review", body: undefined,
    });
    expect(response.status).toBe(403);
    expect(query.mock.calls.length).toBeGreaterThan(0);
    expect(query.mock.calls.every(([sql]) => typeof sql === "string" && /^\s*select\b/i.test(sql))).toBe(true);
  });
});
