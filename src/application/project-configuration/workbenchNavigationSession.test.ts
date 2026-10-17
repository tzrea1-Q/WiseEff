import { describe, expect, it, vi } from "vitest";

import { createWorkbenchNavigationSession } from "./workbenchNavigationSession";

const configSets = [
  {
    id: "cs-b",
    projectId: "proj",
    organizationId: "org",
    name: "other",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  },
  {
    id: "cs-a",
    projectId: "proj",
    organizationId: "org",
    name: "default",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  }
] as const;

describe("WorkbenchNavigationSession", () => {
  it("distinguishes a completed empty search from the initial state and clears it with the input", async () => {
    const session = createWorkbenchNavigationSession();
    expect(session.searchQuery).toBeNull();
    session.setSearchDraft("missing");
    await session.runSearch("proj", { search: vi.fn().mockResolvedValue({ hits: [] }) });
    expect(session.searchQuery).toBe("missing");
    expect(session.searchHits).toEqual([]);
    expect(session.searchLoading).toBe(false);
    session.setSearchDraft("");
    expect(session.searchQuery).toBeNull();
    expect(session.findQuery).toBe("");
    expect(session.searchError).toBe("");
  });

  it("ignores an older search after a newer search completes or input is cleared", async () => {
    const session = createWorkbenchNavigationSession();
    let finishOld!: (result: { hits: [] }) => void;
    const oldResult = new Promise<{ hits: [] }>((resolve) => { finishOld = resolve; });
    session.setSearchDraft("old");
    const oldSearch = session.runSearch("proj", { search: vi.fn().mockReturnValue(oldResult) });
    session.setSearchDraft("new");
    await session.runSearch("proj", { search: vi.fn().mockResolvedValue({ hits: [] }) });
    finishOld({ hits: [] });
    await oldSearch;
    expect(session.searchQuery).toBe("new");
    expect(session.findQuery).toBe("new");
    session.setSearchDraft("pending");
    let failPending!: (error: Error) => void;
    const pending = new Promise((_, reject) => { failPending = reject; });
    const pendingSearch = session.runSearch("proj", { search: vi.fn().mockReturnValue(pending) });
    session.setSearchDraft("");
    failPending(new Error("late failure"));
    await pendingSearch;
    expect(session.searchQuery).toBeNull();
    expect(session.searchError).toBe("");
    expect(session.searchLoading).toBe(false);
  });

  it("resolves named default config set and write-backs missing configSet query", () => {
    const session = createWorkbenchNavigationSession();
    const selected = session.resolveSelectedConfigSet({
      search: "",
      configSets: [...configSets]
    });
    expect(selected?.id).toBe("cs-a");
    const path = session.applyConfigSetUrl({
      projectId: "proj",
      search: "",
      configSetsLoading: false,
      selectedConfigSet: selected
    });
    expect(path).toContain("configSet=cs-a");
  });

  it("preserves non-member project file targets once members finished loading", () => {
    const session = createWorkbenchNavigationSession();
    const selected = session.resolveSelectedMember(
      {
        search: "?configSet=cs-a&file=orphan",
        projectId: "proj",
        configSets: [...configSets],
        selectedMembers: [],
        projectFiles: [
          {
            id: "orphan",
            projectId: "proj",
            fileName: "orphan.dts",
            format: "dts",
            currentVersionId: "v1",
            currentVersionNumber: 1,
            enabled: true,
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ],
        membersLoading: false,
        membersError: ""
      },
      configSets[1]
    );
    expect(selected?.fileId).toBe("orphan");
    expect(
      session.applyFileUrl({
        projectId: "proj",
        search: "?configSet=cs-a&file=orphan",
        membersLoading: false,
        filesLoading: false,
        selectedConfigSet: configSets[1],
        selectedMemberFileId: "orphan",
        selectedMembers: [],
        projectFiles: [
          {
            id: "orphan",
            projectId: "proj",
            fileName: "orphan.dts",
            format: "dts",
            currentVersionId: "v1",
            currentVersionNumber: 1,
            enabled: true,
            updatedAt: "2026-01-01T00:00:00.000Z"
          }
        ]
      })
    ).toBeNull();
  });

  it("keeps URL node while structure is still loading", () => {
    const session = createWorkbenchNavigationSession();
    session.applyNodePropertyFromUrl({
      search: "?node=/soc&property=status",
      structureNodes: [],
      structureLoading: true,
      structureError: ""
    });
    expect(session.selectedNodePath).toBe("/soc");
    expect(session.selectedPropertyName).toBe("status");
  });

  it("runs search and builds selectSearchHit path with pending focus line", async () => {
    const session = createWorkbenchNavigationSession();
    session.setSearchDraft("status");
    const search = vi.fn(async () => ({
      hits: [
        {
          fileId: "f1",
          fileName: "board.dts",
          versionId: "v1",
          nodePath: "/soc",
          propertyName: "status",
          source: { startOffset: 10, endOffset: 11, startLine: 12, endLine: 12, startColumn: 1, endColumn: 2 }
        }
      ]
    }));
    await session.runSearch("proj", { search });
    expect(session.searchHits).toHaveLength(1);
    expect(session.findQuery).toBe("status");
    const path = session.selectSearchHit("proj", "?configSet=cs-a", {
      configSetId: "cs-a",
      hit: session.searchHits[0]!,
      sourceMode: null,
      versionId: null
    });
    expect(path).toContain("file=f1");
    expect(path).toContain("node=%2Fsoc");
    expect(session.consumePendingFocusLine()).toBe(12);
  });

  it("selectConfigSet clears file/node/mode and selectMember clears mode when switching files", () => {
    const session = createWorkbenchNavigationSession();
    expect(session.selectConfigSet("proj", "?configSet=cs-a&file=f1&sourceMode=history", "cs-b")).toBe(
      "/parameter-admin/projects/proj/configuration?configSet=cs-b"
    );
    const switched = new URL(session.selectConfigSet("proj", "?configSet=cs-a&file=f1&node=board&property=model&sourceMode=candidate&candidate=candidate-a&baseline=baseline-a&version=v9&inspector=release", "cs-b"), "https://wiseeff.test");
    expect(switched.searchParams.get("configSet")).toBe("cs-b");
    expect(switched.searchParams.get("inspector")).toBe("release");
    for (const key of ["file", "node", "property", "sourceMode", "candidate", "baseline", "version"]) {
      expect(switched.searchParams.has(key)).toBe(false);
    }
    expect(
      session.selectMember("proj", "?configSet=cs-a&file=f1&sourceMode=history&version=v9", {
        configSetId: "cs-a",
        fileId: "f2",
        currentFileId: "f1",
        sourceMode: "history",
        versionId: "v9",
        workingMode: false
      })
    ).toBe("/parameter-admin/projects/proj/configuration?configSet=cs-a&file=f2");
  });
});
