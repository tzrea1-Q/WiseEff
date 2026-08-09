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
            createdAt: "2026-01-01T00:00:00.000Z",
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
            createdAt: "2026-01-01T00:00:00.000Z",
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
          source: { startLine: 12, endLine: 12, startColumn: 1, endColumn: 2 }
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
