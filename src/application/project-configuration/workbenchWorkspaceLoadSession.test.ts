import { describe, expect, it, vi } from "vitest";
import type { DtsStructureResult } from "@/application/ports/DtsStructuredRepository";

import { createWorkbenchWorkspaceLoadSession } from "./workbenchWorkspaceLoadSession";

describe("WorkbenchWorkspaceLoadSession", () => {
  it("keeps complete structure beside scoped metadata and clears both while ignoring stale versions", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    let finishOld!: (result: DtsStructureResult) => void;
    const oldResult = new Promise<DtsStructureResult>((resolve) => { finishOld = resolve; });
    const node = { nodePath: "unregistered", name: "unregistered", labels: [], phandleRefs: [], properties: [] };
    const navigation = { status: "ready" as const, catalogReleaseId: "r2", managedNodePaths: [] };
    const getStructure = vi.fn().mockResolvedValueOnce({ nodes: [node], navigation })
      .mockReturnValueOnce(oldResult).mockResolvedValueOnce({ nodes: [node], navigation });
    await session.loadStructure("proj", "f1", "v0", { getStructure }, { navigationScope: "organization" });
    expect(session.structureNodes).toEqual([node]);
    expect(session.structureNavigation).toEqual(navigation);
    const oldLoad = session.loadStructure("proj", "f1", "v1", { getStructure }, { navigationScope: "organization" });
    expect(session.structureNodes).toEqual([]);
    expect(session.structureNavigation).toBeNull();
    const newLoad = session.loadStructure("proj", "f2", "v2", { getStructure }, { navigationScope: "organization" });
    finishOld({ nodes: [], navigation: { status: "unavailable", reason: "catalog-unavailable" } });
    await Promise.all([oldLoad, newLoad]);
    expect(getStructure).toHaveBeenLastCalledWith("proj", "f2", "v2", { navigationScope: "organization" });
    expect(session.structureNodes).toEqual([node]);
    expect(session.structureNavigation).toEqual(navigation);
    expect(session.structureNavigationError).toBe("");
    await session.loadStructure("proj", null, null, { getStructure }, { navigationScope: "organization" });
    expect(session.structureNavigation).toBeNull();
  });

  it.each([undefined, { status: "unavailable", reason: "registration-unavailable" }])(
    "marks missing or unavailable scoped metadata as retryable without discarding source structure (%j)", async (navigation) => {
      const session = createWorkbenchWorkspaceLoadSession();
      const nodes = [{ nodePath: "hidden", name: "hidden", labels: [], phandleRefs: [], properties: [] }];
      await session.loadStructure("proj", "f1", "v1", {
        getStructure: vi.fn().mockResolvedValue({ nodes, navigation })
      }, { navigationScope: "organization" });
      expect(session.structureNodes).toEqual(nodes);
      expect(session.structureError).toBe("");
      expect(session.structureNavigationError).toMatch(/组织配置导航.*重试/);
    }
  );

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
        enabled: true,
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
      .mockResolvedValueOnce({ bytes: new TextEncoder().encode("\ufeffsecond\r\n") });

    const pending = session.loadSource("proj", "f1", "v1", { downloadVersion });
    const second = session.loadSource("proj", "f1", "v2", { downloadVersion });
    resolveFirst({ bytes: new TextEncoder().encode("first") });
    await Promise.all([pending, second]);

    expect(session.source).toBe("\ufeffsecond\r\n");
    expect(session.sourceLoading).toBe(false);
    expect(session.sourceError).toBe("");
  });

  it("does not expose replacement characters as editable source for invalid UTF-8 bytes", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    await session.loadSource("project", "file", "version", { downloadVersion: vi.fn(async () => ({ contentType: "text/plain", bytes: new Uint8Array([0xff]) })) });
    expect(session.source).toBe("");
    expect(session.sourceIdentity).toBeNull();
    expect(session.sourceError).not.toBe("");
  });

  it("unbinds source identity while a different file loads and ignores a late old-file response", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    let finishOld!: (value: { bytes: Uint8Array }) => void;
    let finishNew!: (value: { bytes: Uint8Array }) => void;
    const downloadVersion = vi.fn().mockResolvedValueOnce({ bytes: new TextEncoder().encode("initial file") })
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    await session.loadSource("project", "file-a", "version-a", { downloadVersion });
    expect(session.sourceIdentity).toEqual({ projectId: "project", fileId: "file-a", versionId: "version-a" });
    const old = session.loadSource("project", "file-a", "version-a2", { downloadVersion });
    const next = session.loadSource("project", "file-b", "version-b", { downloadVersion });
    expect(session.sourceIdentity).toBeNull();
    expect(session.sourceLoading).toBe(true);
    finishNew({ bytes: new TextEncoder().encode("new file") });
    await next;
    expect(session.sourceIdentity).toEqual({ projectId: "project", fileId: "file-b", versionId: "version-b" });
    finishOld({ bytes: new TextEncoder().encode("late old file") });
    await old;
    expect(session.source).toBe("new file");
    expect(session.sourceIdentity).toEqual({ projectId: "project", fileId: "file-b", versionId: "version-b" });
    await session.loadSource("project", null, null, { downloadVersion });
    expect(session.sourceIdentity).toBeNull();
  });

  it("clears source and structure when file or version is missing", async () => {
    const session = createWorkbenchWorkspaceLoadSession();
    await session.loadSource("proj", "f1", "v1", {
      downloadVersion: vi.fn(async () => ({ contentType: "text/plain", bytes: new TextEncoder().encode("src") }))
    });
    await session.loadStructure("proj", "f1", "v1", {
      getStructure: vi.fn(async () => ({
        nodes: [
          {
            nodePath: "/soc",
            name: "soc",
            labels: [],
            phandleRefs: [],
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
    expect(session.configSetsError).toBe("配置加载失败。");
    expect(session.projectFiles).toEqual([]);
    expect(session.filesError).toBe("项目文件加载失败。");
    expect(session.members).toEqual([]);
    expect(session.membersError).toBe("配置文件加载失败。");
    expect(session.source).toBe("");
    expect(session.sourceError).toBe("源码加载失败。");
    expect(session.structureNodes).toEqual([]);
    expect(session.structureError).toBe("结构树加载失败。");
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
        enabled: true,
        currentVersionId: "v2",
        currentVersionNumber: 2,
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]);
    expect(session.configSets[0]?.id).toBe("cs-new");
    expect(session.members).toEqual([]);
    expect(session.projectFiles[0]?.id).toBe("f2");
  });
});
