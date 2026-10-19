import { beforeEach, describe, expect, it, vi } from "vitest";
import { searchProjectDts } from "./dtsSearchService";
import { loadOrganizationNavigationScope } from "./structuralNavigationScope";

vi.mock("./structuralNavigationScope", async (importOriginal) => ({
  ...await importOriginal<typeof import("./structuralNavigationScope")>(),
  loadOrganizationNavigationScope: vi.fn(),
}));

const navigationRows = [
  { version_id: "v1", node_path: "", name: "/" },
  { version_id: "v1", node_path: "bus@1", name: "bus" },
  { version_id: "v1", node_path: "bus@1/charger", name: "charger" },
  { version_id: "v1", node_path: "bus@10", name: "bus" },
  { version_id: "v1", node_path: "bus@10/noise", name: "noise" },
  // Identical paths in a second file must not inherit v1's scope.
  { version_id: "v2", node_path: "bus@1/charger", name: "noise" },
].map((row) => ({ ...row, compatible: null, raw_compatible: null }));

const hitRows = navigationRows.map((row) => ({
  file_id: row.version_id === "v1" ? "file-a" : "file-b",
  file_name: row.version_id === "v1" ? "sample-a.dts" : "sample-b.dts",
  version_id: row.version_id,
  node_path: row.node_path,
  property_name: null,
  snippet: row.node_path,
  start_offset: null, end_offset: null, start_line: null, start_column: null, end_line: null, end_column: null,
}));
const input = { organizationId: "org-a", principalId: "viewer-a", projectId: "project-a", q: "bus", navigationScope: "organization" as const };

function makeDb() {
  return {
    query: vi.fn().mockImplementation(async (sql: string) => {
      const rows = sql.includes("as raw_compatible") ? navigationRows
        : sql.includes("p.name as property_name") ? hitRows.map((row) => ({ ...row, property_name: "reg", snippet: "reg=<1>" }))
        : sql.includes("f.file_name as snippet") ? [hitRows[0], { ...hitRows[5], node_path: "" }]
        : hitRows;
      return { rows, rowCount: rows.length };
    }),
  };
}

describe("organization-scoped DTS search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOrganizationNavigationScope).mockResolvedValue({
      status: "ready", catalogReleaseId: "crel_search",
      matchNodePaths: (nodes) => nodes.filter((node) => node.name === "charger").map((node) => node.nodePath),
    });
  });

  it("retains actual ancestors, hides siblings and isolates the same path across versions", async () => {
    const db = makeDb();
    const result = await searchProjectDts(db, { ...input, by: "path" });
    expect(result.hits.map((hit) => [hit.versionId, hit.nodePath])).toEqual([
      ["v1", ""], ["v1", "bus@1"], ["v1", "bus@1/charger"],
    ]);
    expect(loadOrganizationNavigationScope).toHaveBeenCalledOnce();
    expect(loadOrganizationNavigationScope).toHaveBeenCalledWith(db, { organizationId: "org-a", principalId: "viewer-a" });
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(db.query.mock.calls[0]?.[1]).toEqual(["org-a", "project-a"]);
    expect(db.query.mock.calls[1]?.[1]).toEqual(["org-a", "project-a", "bus"]);
  });

  it("hides ancestor properties and retains file-name results even with no matches", async () => {
    const result = await searchProjectDts(makeDb(), { ...input, by: "value" });
    expect(result.hits.map((hit) => [hit.versionId, hit.nodePath, hit.propertyName])).toEqual([
      ["v1", "bus@1/charger", "reg"],
    ]);
    const compatible = await searchProjectDts(makeDb(), { ...input, by: "compatible" });
    expect(compatible.hits.map((hit) => hit.nodePath)).toEqual(["bus@1/charger"]);
    vi.mocked(loadOrganizationNavigationScope).mockResolvedValue({ status: "ready", catalogReleaseId: "crel_search", matchNodePaths: () => [] });
    const fileResult = await searchProjectDts(makeDb(), { ...input, by: "file" });
    expect(fileResult.hits.map((hit) => hit.fileId)).toEqual(["file-a", "file-b"]);
    const mixed = await searchProjectDts(makeDb(), input);
    expect(mixed.hits.map((hit) => hit.fileId)).toEqual(["file-a", "file-b"]);
  });

  it("fails explicitly when scope is unavailable and keeps ordinary searches unchanged", async () => {
    vi.mocked(loadOrganizationNavigationScope).mockResolvedValue({ status: "unavailable", reason: "registration-unavailable" });
    const db = makeDb();
    await expect(searchProjectDts(db, input)).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 500, details: { reason: "registration-unavailable" } });
    expect(db.query).not.toHaveBeenCalled();
    await expect(searchProjectDts(db, { ...input, principalId: undefined })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    vi.mocked(loadOrganizationNavigationScope).mockClear();
    const result = await searchProjectDts(db, { organizationId: "org-a", projectId: "project-a", q: "bus", by: "path" });
    expect(result.hits).toHaveLength(hitRows.length);
    expect(loadOrganizationNavigationScope).not.toHaveBeenCalled();
  });
});
