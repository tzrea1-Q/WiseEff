import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostgresDatabase, getRootPostgresPool, type RootDatabase } from "../../../shared/database/client";

// Exercise the actual eleven provider entrypoints and existing aggregation.
// Only their database/domain read ports are synthetic. These are classification
// regressions, not PostgreSQL, approved reports, or populated cutover evidence.
const fixture = vi.hoisted(() => ({ mode: "different" as "different" | "query-failure" | "exact-prj" }));
vi.mock("../../catalog-kernel/interface", () => ({ createCatalogKernel: () => ({}) }));
vi.mock("../../parameter-catalog-api/read", () => ({
  unregisteredProjection: {}, zeroUsageProjection: {}, kernelOnlyTimelineComposer: {},
  handleCatalogRead: vi.fn(async () => ({ status: fixture.mode === "query-failure" ? 503 : 200, body: { items: [{ id: "canonical-subject" }] } })),
}));
vi.mock("../../parameter-catalog-api/governance", () => ({
  emptyGovernanceQueryPorts: {},
  handleCatalogGovernance: vi.fn(async () => ({ status: fixture.mode === "query-failure" ? 503 : 200, body: { items: [] } })),
}));
// Classification-only transport seam: the actual CGH provider dispatches its
// GETs through a real router. Formal production composition, pool admission and
// actual restricted LOGIN reads are covered by the dedicated CGH routing tests.
vi.mock("../../parameter-catalog-api/productionWire", () => ({
  registerParameterCatalogApi: (router: import("../../../shared/http/router").WiseEffRouter) => {
    router.get("/api/v2/catalog/definitions", async () =>
      (await import("../../parameter-catalog-api/read")).handleCatalogRead({} as never, {} as never));
    for (const path of ["/api/v2/organizations/:organizationId/subject-registrations", "/api/v2/organizations/:organizationId/parameter-review-items"]) {
      router.get(path, async () =>
        (await import("../../parameter-catalog-api/governance")).handleCatalogGovernance({} as never, {} as never));
    }
  },
}));
vi.mock("../../parameter-catalog-api/legacy", () => ({
  LEGACY_WRITE_GONE_MESSAGE: "synthetic-retired",
  catalogLegacyGoneResult: () => ({ status: 410 }),
  handleLegacyCatalogRequest: vi.fn(async () => ({ status: 410 })),
  lookupLegacyIdentifier: vi.fn(async () => {
    if (fixture.mode === "query-failure") throw new Error("synthetic-canonical-query-failed");
    return { kind: "archived" };
  }),
}));
vi.mock("../../parameter-bindings/adapters", () => ({
  readProtectedReference: vi.fn(async () => {
    if (fixture.mode === "query-failure") throw new Error("synthetic-canonical-query-failed");
    return { ok: false, error: { kind: "binding-unavailable" } };
  }),
  writebackProtectedReference: vi.fn(async () => {
    if (fixture.mode === "query-failure") throw new Error("synthetic-canonical-query-failed");
    return { ok: false, error: { kind: "binding-unavailable" } };
  }),
}));
vi.mock("../../parameter-specs/service", () => ({
  listParameterSpecs: vi.fn(async () => ({ items: [{ id: "spec-source", lifecycle: "active", propertyKey: "synthetic", currentVersion: 1 }] })),
  listSpecReviewTasks: vi.fn(async () => ({ items: [] })),
}));
vi.mock("../../parameter-topology/service", () => ({
  listProjectBindings: vi.fn(async () => ({ items: [] })),
  listIdentityMappingTasks: vi.fn(async () => ({ items: [{ id: "source-mapping", projectId: "project-source" }] })),
}));
vi.mock("../../parameter-modules/service", () => ({
  getParameterModuleRegistry: vi.fn(async () => ({ item: { modules: [{ id: "module-source", kind: "driver" }], mappings: [] } })),
  getModuleDiscoveryHints: vi.fn(async () => ({ item: { dismissedCompatibles: [] } })),
  listDriverRegistry: vi.fn(async () => ({ items: [] })),
}));
vi.mock("../../parameter-files/repository", () => ({
  listProjectParameterFiles: vi.fn(async () => []), listFileVersions: vi.fn(async () => []),
}));
vi.mock("../../parameters/semanticParameterReads", () => ({
  listSemanticParameters: vi.fn(async () => [{ id: "binding-source", project_id: "project-source", current_value: null }]),
}));
vi.mock("../../parameters/canonicalParameterPin", () => ({
  PRJ_UNQUERYABLE_FAILURE_CODE: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
  readCanonicalParameterPin: vi.fn(async () => fixture.mode === "query-failure"
    ? { status: "query-failure", code: "unexpected-read-status", detail: "synthetic-query-failure" }
    : { status: "value", value: fixture.mode === "exact-prj"
      ? { selection: "latest-revision-tip", currentValue: null, projectId: "project-source", id: "binding-source" }
      : { canonicalPin: "different-binding" } }),
}));
vi.mock("../core", () => ({ createReleaseVerificationService: () => ({
  readReport: async () => {
    if (fixture.mode === "query-failure") throw new Error("synthetic-canonical-query-failed");
    return { kind: "absent", reason: "missing" };
  },
}) }));
vi.mock("../../../../scripts/wayfinder/inspect-parameter-catalog-cutover", () => ({
  runInspectCutoverCli: vi.fn(async () => ({ ok: false, error: { code: "missing", detail: "synthetic-no-run" } })),
}));

import { createProductionComparisonProviders, type ComparisonProviderInput } from "./productionProviders";
import { aggregateLiveComparisonCorpus } from "./aggregateComparisonCorpus";
import { provideCghParameterCatalogComparisonContribution, serializeCghComparisonContribution, checksumCghComparisonBytes, CGH_COMPARISON_IDS } from "../../parameter-specs/parameterCatalogComparisonContribution";
import { generateComparisonReport } from "./generateComparisonReport";
import { handleCatalogRead } from "../../parameter-catalog-api/read";

const sourceRows: Record<string, readonly Record<string, unknown>[]> = {
  organizations: [{ id: "organization-source" }],
  projects: [{ id: "project-source", organization_id: "organization-source" }],
  dts_logical_nodes: [{ id: "node-source", organization_id: "organization-source", project_id: "project-source", config_set_id: "config-source" }],
  agent_sessions: [{ id: "session-source", organization_id: "organization-source", project_id: "project-source", status: "complete" }],
  log_records: [{ id: "log-source", organization_id: "organization-source", related_parameter_id: "binding-source", file_name: "synthetic.log", status: "complete" }],
  debugging_parameters: [{ id: "debug-source", organization_id: "organization-source", key: "synthetic", node_path: "/synthetic" }],
  dts_reload_runs: [{ id: "reload-source", organization_id: "organization-source", project_id: "project-source", config_revision_id: "revision-source", status: "complete", purpose: "synthetic" }],
  knowledge_parameter_references: [{ id: "reference-source", organization_id: "organization-source", entry_id: "entry-source", source_id: "spec-source", created_by_user_id: null, created_at: "2026-09-01T00:00:00Z" }],
};
const emptyTables = new Set(["dts_logical_node_revisions", "dts_config_revisions", "agent_tool_calls", "agent_approvals",
  "debug_nodes", "debug_node_bindings", "debugging_parameter_node_bindings", "node_operations", "debugging_sessions",
  "debugging_snapshots", "dts_reload_run_targets"]);
const roots: RootDatabase[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((db) => db.close())); });
function input(): ComparisonProviderInput {
  const query = vi.fn(async (sql: string) => {
    const table = /\bfrom\s+(\w+)/i.exec(sql)?.[1];
    if (!table || (!sourceRows[table] && !emptyTables.has(table))) throw new Error("synthetic-inventory-query-not-registered");
    return { rows: structuredClone(sourceRows[table] ?? []) };
  });
  const database = createPostgresDatabase("postgres://synthetic@127.0.0.1:1/synthetic");
  roots.push(database);
  const pool = getRootPostgresPool(database)!;
  vi.spyOn(pool, "query").mockImplementation(query as never);
  return {
    database, pool,
    phase: "pre-activation", inventoryMode: "populated", candidateSha: "a".repeat(40), planPin: "synthetic-plan",
    mappingHeadId: "shared-head-is-not-a-target", mappingHeadVersion: 1,
    mappingHeadChecksum: "b".repeat(64), catalogSnapshotChecksum: "c".repeat(64),
  };
}
const providers = createProductionComparisonProviders();
beforeEach(() => { fixture.mode = "different"; vi.clearAllMocks(); });

describe("P11 provider classification without declared rule evidence", () => {
  it.each(providers)("$family cannot invent an expected difference from unequal queryable observations", async provider => {
    const contribution = await provider.provide(input());
    expect(contribution.sourceInventoryCount).toBeGreaterThan(0);
    const unequal = contribution.cases.filter(item => item.legacyObservation.status === "value" &&
      item.canonicalObservation.status === "value" &&
      JSON.stringify(item.legacyObservation.value) !== JSON.stringify(item.canonicalObservation.value));
    expect(unequal.length).toBeGreaterThan(0);
    for (const item of unequal) {
      expect(item.result).toBe("unexplained-difference");
      expect(item.expectedDifference).toBeNull();
    }
  });

  it.each(providers)("$family keeps actual query-failure observations blocking", async provider => {
    fixture.mode = "query-failure";
    // LOG records route HTTP outcomes as values; a thrown read error exercises
    // its actual query-failure adapter, whereas CGH/TOP/MOD preserve HTTP 503.
    if (provider.family === "LOG") vi.mocked(handleCatalogRead).mockRejectedValueOnce(new Error("synthetic-canonical-query-failed"));
    if (provider.family === "CGH") {
      await expect(provider.provide(input())).rejects.toMatchObject({
        code: "PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE",
        observation: { status: "query-failure", code: "503", detail: "catalog-read-list-definitions" },
      });
      return;
    }
    const contribution = await provider.provide(input());
    const failed = contribution.cases.filter(item => item.legacyObservation.status === "query-failure" || item.canonicalObservation.status === "query-failure");
    expect(failed.length).toBeGreaterThan(0);
    for (const item of failed) {
      expect(item.result).toBe("unqueryable/protected-reference-missing");
      expect(item.expectedDifference).toBeNull();
    }
  });

  it("retains exact equivalent values, including explicit null and stable revision selection", async () => {
    fixture.mode = "exact-prj";
    const contribution = await providers.find(provider => provider.family === "PRJ")!.provide(input());
    expect(contribution.cases).toHaveLength(2);
    expect(contribution.cases.map(item => ({ result: item.result, evidence: item.expectedDifference })))
      .toEqual([{ result: "exact-equivalent", evidence: null }, { result: "exact-equivalent", evidence: null }]);
  });

  it("retains the real CGH legacy-route equality while blocking its unexplained definition comparison", async () => {
    const contribution = await provideCghParameterCatalogComparisonContribution(input());
    const post = await provideCghParameterCatalogComparisonContribution({ ...input(), phase: "post-p13", candidateSha: "d".repeat(40) });
    expect(post.sourceInventoryCount).toBe(contribution.sourceInventoryCount);
    expect(post.sourceInventoryChecksum).toBe(contribution.sourceInventoryChecksum);
    expect(post.cases.map(item => item.caseId)).toEqual(contribution.cases.map(item => item.caseId));
    expect(post.checksum).not.toBe(contribution.checksum);
    for (const capture of [contribution, post]) {
      const bytes = serializeCghComparisonContribution(capture);
      expect(bytes.toString().endsWith("\n")).toBe(true);
      expect(bytes.toString()).not.toContain("\r");
      expect(capture.checksum).toBe(checksumCghComparisonBytes(bytes));
      expect(new Set(capture.cases.map(item => item.caseId)).size).toBe(capture.cases.length);
      expect(capture.cases.every(item => CGH_COMPARISON_IDS.includes(item.comparisonId))).toBe(true);
      expect(capture.cases.every(item => item.expectedDifference === null)).toBe(true);
    }
    const route = contribution.cases.find(item => item.comparisonId === "PCAT-CMP-D09-LEGACY-OPERATOR-OUTCOME")!;
    expect(route.result).toBe("exact-equivalent");
    expect(route.expectedDifference).toBeNull();
    expect(contribution.cases.some(item => item.result === "unexplained-difference")).toBe(true);
  });

  it("the existing aggregate preserves unexplained cases and the actual report generator refuses them", async () => {
    const corpus = await aggregateLiveComparisonCorpus(input());
    expect(corpus.resultCounts["unexplained-difference"]).toBeGreaterThan(0);
    expect(corpus.resultCounts["declared-expected-difference"]).toBe(0);
    expect(() => generateComparisonReport(corpus)).toThrow(/unexplained-difference/);
  });

  it.each(providers)("$family does not turn an inventory exception into an empty success", async provider => {
    const value = input();
    vi.mocked(value.pool.query).mockRejectedValue(new Error("synthetic-inventory-unavailable"));
    await expect(provider.provide(value)).rejects.toThrow("synthetic-inventory-unavailable");
  });
});
