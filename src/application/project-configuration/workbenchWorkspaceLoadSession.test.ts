import { describe, expect, it, vi } from "vitest";

import { createWorkbenchWorkspaceLoadSession } from "./workbenchWorkspaceLoadSession";

describe("WorkbenchWorkspaceLoadSession", () => {
  it("loads config sets and project files via narrow port Picks", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    const listConfigSets = vi.fn(async () => [
      {
        id: "cs-a",
        projectId: "proj",
        organizationId: "org",
        name: "default",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    const listFiles = vi.fn(async () => [
      {
        id: "f1",
        projectId: "proj",
        fileName: "board.dts",
        format: "dts" as const,
        currentVersionId: "v1",
        currentVersionNumber: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);

    await Promise.all([
      session.loadConfigSets("proj", { listConfigSets }),
      session.loadProjectFiles("proj", { listFiles })
    ]);

    expect(listConfigSets).toHaveBeenCalledWith("proj");
    expect(listFiles).toHaveBeenCalledWith("proj");
    expect(session.configSets).toHaveLength(1);
    expect(session.projectFiles[0]?.id).toBe("f1");
    expect(session.configSetsLoading).toBe(false);
    expect(session.filesLoading).toBe(false);
  });

  it("clears members when config set is null and loads when present", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    session.setMembers([
      {
        configSetId: "cs-a",
        fileId: "f1",
        fileName: "board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: "v1",
        currentVersionNumber: 1
      }
    ]);
    await session.loadMembers("proj", null, {
      listConfigSetFiles: vi.fn()
    });
    expect(session.members).toEqual([]);
    expect(session.membersLoading).toBe(false);

    const listConfigSetFiles = vi.fn(async () => [
      {
        configSetId: "cs-a",
        fileId: "f1",
        fileName: "board.dts",
        format: "dts" as const,
        role: "base" as const,
        sortOrder: 0,
        currentVersionId: "v1",
        currentVersionNumber: 1
      }
    ]);
    await session.loadMembers("proj", "cs-a", { listConfigSetFiles });
    expect(listConfigSetFiles).toHaveBeenCalledWith("proj", "cs-a");
    expect(session.members).toHaveLength(1);
    expect(session.membersBoundConfigSetId).toBe("cs-a");
  });

  it("unbinds membersBoundConfigSetId while a load is in flight", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    let resolveList: (value: never[]) => void = () => undefined;
    const listConfigSetFiles = vi.fn(
      () =>
        new Promise<never[]>((resolve) => {
          resolveList = resolve;
        })
    );
    const pending = session.loadMembers("proj", "cs-a", { listConfigSetFiles });
    expect(session.membersLoading).toBe(true);
    expect(session.membersBoundConfigSetId).toBeNull();
    resolveList([]);
    await pending;
    expect(session.membersBoundConfigSetId).toBe("cs-a");
    expect(session.membersLoading).toBe(false);
  });

  it("decodes active source bytes and ignores stale downloads", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    let resolveFirst: (value: { bytes: Uint8Array }) => void = () => undefined;
    const first = new Promise<{ bytes: Uint8Array }>((resolve) => {
      resolveFirst = resolve;
    });
    const downloadVersion = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockResolvedValueOnce({ bytes: new TextEncoder().encode("second") });

    const pending = session.loadSource("proj", "f1", "v1", { downloadVersion });
    const second = session.loadSource("proj", "f1", "v2", { downloadVersion });
    resolveFirst({ bytes: new TextEncoder().encode("first") });
    await Promise.all([pending, second]);

    expect(session.source).toBe("second");
    expect(session.sourceLoading).toBe(false);
    expect(session.sourceError).toBe("");
  });

  it("clears source and structure when file or version is missing", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    await session.loadSource("proj", "f1", "v1", {
      downloadVersion: vi.fn(async () => ({ bytes: new TextEncoder().encode("src") }))
    });
    await session.loadStructure("proj", "f1", "v1", {
      getStructure: vi.fn(async () => ({
        nodes: [
          {
            nodePath: "/soc",
            label: "soc",
            kind: "node",
            startLine: 1,
            endLine: 2,
            properties: []
          }
        ]
      }))
    });
    expect(session.source).toBe("src");
    expect(session.structureNodes).toHaveLength(1);

    await session.loadSource("proj", null, null, { downloadVersion: vi.fn() });
    await session.loadStructure("proj", "f1", null, { getStructure: vi.fn() });
    expect(session.source).toBe("");
    expect(session.structureNodes).toEqual([]);
    expect(session.sourceLoading).toBe(false);
    expect(session.structureLoading).toBe(false);
  });

  it("fail-closes each load independently with Chinese error messages", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    await session.loadConfigSets("proj", {
      listConfigSets: vi.fn(async () => {
        throw new Error("cs boom");
      })
    });
    await session.loadProjectFiles("proj", {
      listFiles: vi.fn(async () => {
        throw new Error("files boom");
      })
    });
    await session.loadMembers("proj", "cs-a", {
      listConfigSetFiles: vi.fn(async () => {
        throw new Error("members boom");
      })
    });
    await session.loadSource("proj", "f1", "v1", {
      downloadVersion: vi.fn(async () => {
        throw new Error("source boom");
      })
    });
    await session.loadStructure("proj", "f1", "v1", {
      getStructure: vi.fn(async () => {
        throw new Error("structure boom");
      })
    });

    expect(session.configSets).toEqual([]);
    expect(session.configSetsError).toMatch(/cs boom/);
    expect(session.projectFiles).toEqual([]);
    expect(session.filesError).toMatch(/files boom/);
    expect(session.members).toEqual([]);
    expect(session.membersError).toMatch(/members boom/);
    expect(session.source).toBe("");
    expect(session.sourceError).toMatch(/source boom/);
    expect(session.structureNodes).toEqual([]);
    expect(session.structureError).toMatch(/structure boom/);
  });

  it("bumps independent retry tokens without product state changes", () => {
    const session = createWorkbenchWorkspaceLoadSession();
    expect(session.configRetry).toBe(0);
    expect(session.filesRetry).toBe(0);
    expect(session.membersRetry).toBe(0);
    expect(session.sourceRetry).toBe(0);
    expect(session.structureRetry).toBe(0);

    session.retryConfigSets();
    session.retryFiles();
    session.retryMembers();
    session.retrySource();
    session.retryStructure();

    expect(session.configRetry).toBe(1);
    expect(session.filesRetry).toBe(1);
    expect(session.membersRetry).toBe(1);
    expect(session.sourceRetry).toBe(1);
    expect(session.structureRetry).toBe(1);
  });

  it("allows shell optimistic replaces after mutations", () => {
    const session = createWorkbenchWorkspaceLoadSession();
    session.setConfigSets([
      {
        id: "cs-new",
        projectId: "proj",
        organizationId: "org",
        name: "new",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    session.setMembers([]);
    session.setProjectFiles([
      {
        id: "f2",
        projectId: "proj",
        fileName: "extra.dts",
        format: "dts",
        currentVersionId: "v2",
        currentVersionNumber: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    expect(session.configSets[0]?.id).toBe("cs-new");
    expect(session.members).toEqual([]);
    expect(session.projectFiles[0]?.id).toBe("f2");
  });
});
