import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queryable } from "../../shared/database/client";
import { getRootPostgresPool } from "../../shared/database/client";
import { createCatalogSnapshotFixture } from "../../testing/parameterCatalog";
import { resolveDts } from "../dts";
import { loadPublishedCatalog } from "../parameter-bindings/catalogProjectValueSync";
import { loadOrganizationNavigationScope, navigationPathsWithAncestors } from "./structuralNavigationScope";
import { getParameterFileVersionStructure } from "./structuralReadService";
import { readDtsStructuralModel } from "./structuralReadRepository";

vi.mock("../../shared/database/client", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../shared/database/client")>(),
  getRootPostgresPool: vi.fn(),
}));
vi.mock("../parameter-bindings/catalogProjectValueSync", async (importOriginal) => ({
  ...await importOriginal<typeof import("../parameter-bindings/catalogProjectValueSync")>(),
  loadPublishedCatalog: vi.fn(),
}));
vi.mock("./structuralReadRepository", () => ({ readDtsStructuralModel: vi.fn() }));

const authScope = { organizationId: "org-a", principalId: "viewer-a" };
const release = { id: "crel_navigation", digest: `sha256:${"a".repeat(64)}` };
const subjects = [
  { id: "csub_power", kind: "driver", canonicalKey: "driver:acme,power", selector: { kind: "driver-compatible", values: ["acme,power"] } },
  { id: "csub_sensor", kind: "driver", canonicalKey: "driver:acme,sensor", selector: { kind: "driver-compatible", values: ["acme,sensor"] } },
  { id: "csub_battery", kind: "node-type", canonicalKey: "node-type:battery", selector: { kind: "node-type-name", value: "battery" } },
];
const snapshot = () => createCatalogSnapshotFixture({
  release,
  sequence: "1",
  publishedAt: "2026-10-19T00:00:00.000Z",
  materializedAt: "2026-10-19T00:00:00.000Z",
  compiledFingerprint: `sha256:${"b".repeat(64)}`,
  databaseFingerprint: `sha256:${"b".repeat(64)}`,
  subjects: subjects.map(({ selector, ...subject }) => ({
    ...subject,
    membership: { release, lifecycle: "active", selector, tombstone: { kind: "absent" } },
    aliases: subject.id !== "csub_power" ? [] : [{
      id: "cali_power", subjectId: subject.id,
      selector: { kind: "driver-compatible", value: "acme,power-v1" },
      membership: { release, lifecycle: "active", tombstone: { kind: "absent" } },
    }],
    definitionCounts: { active: 0, deprecated: 0, retired: 0 },
  })),
  definitions: [], revisions: [], facts: [],
} as unknown as Parameters<typeof createCatalogSnapshotFixture>[0]);

function makeDb(rows = [
  { subject_id: "csub_power", status: "active" },
  { subject_id: "csub_battery", status: "active" },
  { subject_id: "csub_sensor", status: "retired" },
]) {
  return { query: vi.fn().mockResolvedValue({ rows, rowCount: rows.length }) } satisfies Queryable;
}

describe("organization DTS navigation scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRootPostgresPool).mockImplementation((db) => db as never);
    vi.mocked(loadPublishedCatalog).mockResolvedValue(snapshot());
  });

  it("keeps registered instances and ancestors in a 5,009-node DTS without parameter values", async () => {
    const source = `/dts-v1/; / { soc { bus@1 {
      charger@0 { compatible = "acme,unknown", "acme,power"; };
      charger@1 { compatible = "acme,power-v1"; status = "disabled"; };
    }; power { battery {}; }; };
    noise { ${Array.from({ length: 5000 }, (_, index) => `unused@${index.toString(16)} {};`).join("\n")} };
    unrelated {}; };`;
    const nodes = resolveDts(source).nodes;
    expect(nodes).toHaveLength(5009);
    const db = makeDb();
    const catalog = snapshot();
    const resolve = vi.spyOn(catalog, "resolveSubject");
    vi.mocked(loadPublishedCatalog).mockResolvedValue(catalog);
    const scope = await loadOrganizationNavigationScope(db, authScope);
    expect(scope.status).toBe("ready");
    if (scope.status !== "ready") throw new Error("expected ready scope");
    const managed = scope.matchNodePaths(nodes);
    expect(managed).toEqual(["soc/bus@1/charger@0", "soc/bus@1/charger@1", "soc/power/battery"]);
    expect([...navigationPathsWithAncestors(nodes, managed)].filter(Boolean).sort()).toEqual([
      "soc", "soc/bus@1", "soc/bus@1/charger@0", "soc/bus@1/charger@1", "soc/power", "soc/power/battery",
    ]);
    expect(resolve.mock.calls.length).toBeLessThan(12);
    expect(db.query).toHaveBeenCalledOnce();
    expect(db.query.mock.calls[0]?.[1]).toEqual(["org-a"]);
    expect(loadPublishedCatalog).toHaveBeenCalledOnce();
  });

  it("excludes retired registrations, ambiguous selectors, and compatible-bearing NodeType lookalikes", async () => {
    const scope = await loadOrganizationNavigationScope(makeDb(), authScope);
    if (scope.status !== "ready") throw new Error("expected ready scope");
    const nodes = resolveDts(`/ { battery {}; sensor { compatible = "acme,sensor"; };
      battery@1 { compatible = "acme,unknown"; };
      ambiguous { compatible = "acme,power", "acme,sensor"; }; };`).nodes;
    expect(scope.matchNodePaths(nodes)).toEqual(["battery"]);
    expect([...navigationPathsWithAncestors(nodes, [])]).toEqual([]);
    expect(navigationPathsWithAncestors([{ nodePath: "bus@1" }, { nodePath: "bus@10" }, { nodePath: "bus@10/chip" }], ["bus@10/chip"]))
      .toEqual(new Set(["bus@10/chip", "bus@10"]));
  });

  it("distinguishes an empty organization selection from unavailable Catalog and registrations", async () => {
    const empty = await loadOrganizationNavigationScope(makeDb([]), authScope);
    expect(empty.status === "ready" && empty.matchNodePaths([{ nodePath: "battery", name: "battery" }])).toEqual([]);
    vi.mocked(loadPublishedCatalog).mockResolvedValueOnce(null);
    const db = makeDb();
    await expect(loadOrganizationNavigationScope(db, authScope)).resolves.toEqual({ status: "unavailable", reason: "catalog-unavailable" });
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockRejectedValueOnce(Object.assign(new Error("connection unavailable"), { code: "ECONNREFUSED" }));
    await expect(loadOrganizationNavigationScope(db, authScope)).resolves.toEqual({ status: "unavailable", reason: "registration-unavailable" });
  });

  it("maps expected Catalog dependency failures and propagates programming errors", async () => {
    const db = makeDb();
    vi.mocked(loadPublishedCatalog).mockRejectedValueOnce(Object.assign(new Error("connection unavailable"), { code: "ECONNREFUSED" }));
    await expect(loadOrganizationNavigationScope(db, authScope)).resolves.toEqual({ status: "unavailable", reason: "catalog-unavailable" });
    const unexpected = new TypeError("invalid runtime snapshot");
    vi.mocked(loadPublishedCatalog).mockRejectedValueOnce(unexpected);
    await expect(loadOrganizationNavigationScope(db, authScope)).rejects.toBe(unexpected);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("preserves complete structure and adds metadata only when requested", async () => {
    const nodes = [{ nodePath: "battery", name: "battery", labels: [], properties: [], phandleRefs: [] },
      { nodePath: "noise", name: "noise", labels: [], properties: [], phandleRefs: [] }];
    vi.mocked(readDtsStructuralModel).mockResolvedValue({ nodes });
    const db = makeDb();
    await expect(getParameterFileVersionStructure(db, "version-a")).resolves.toEqual({ nodes });
    expect(loadPublishedCatalog).not.toHaveBeenCalled();
    await expect(getParameterFileVersionStructure(db, "version-a", authScope)).resolves.toEqual({
      nodes, navigation: { status: "ready", catalogReleaseId: release.id, managedNodePaths: ["battery"] },
    });
    vi.mocked(loadPublishedCatalog).mockResolvedValue(null);
    await expect(getParameterFileVersionStructure(db, "version-a", authScope)).resolves.toEqual({
      nodes, navigation: { status: "unavailable", reason: "catalog-unavailable" },
    });
  });
});
