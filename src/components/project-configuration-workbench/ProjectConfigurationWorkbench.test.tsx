import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import {
  ProjectConfigurationWorkbench,
  type ProjectConfigurationWorkbenchProps
} from "./ProjectConfigurationWorkbench";
import {
  readSessionDraftStore,
  SESSION_DRAFT_STORAGE_KEY,
  upsertSessionDraftBucket
} from "./sessionDraftStorage";

afterEach(() => {
  cleanup();
  localStorage.removeItem(SESSION_DRAFT_STORAGE_KEY);
});

function createMemoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    }
  };
}

const PROJECT = {
  id: "project-1",
  name: "Aurora Production",
  code: "AURORA",
  statusLabel: "进行中"
};

function createDtsRepository(
  overrides: Partial<DtsStructuredRepository> = {}
): DtsStructuredRepository {
  return {
    getStructure: vi.fn(async () => ({ nodes: [] })),
    search: vi.fn(async () => ({ hits: [] })),
    listConfigSets: vi.fn(async () => [
      {
        id: "cs-alpha",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "alpha",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "cs-default",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "default",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]),
    listConfigSetFiles: vi.fn(async (_projectId, configSetId) =>
      configSetId === "cs-alpha"
        ? [
            {
              configSetId,
              fileId: "file-alpha",
              fileName: "alpha.dts",
              format: "dts",
              role: "base",
              sortOrder: 0,
              currentVersionId: "version-alpha-2",
              currentVersionNumber: 2
            }
          ]
        : [
            {
              configSetId,
              fileId: "file-board",
              fileName: "aurora-board.dts",
              format: "dts",
              role: "base",
              sortOrder: 0,
              currentVersionId: "version-board-12",
              currentVersionNumber: 12
            },
            {
              configSetId,
              fileId: "file-overlay",
              fileName: "charging-overlay.dtsi",
              format: "dts",
              role: "overlay",
              sortOrder: 1,
              currentVersionId: "version-overlay-4",
              currentVersionNumber: 4
            }
          ]
    ),
    createConfigSet: vi.fn(),
    addConfigSetFile: vi.fn(),
    removeConfigSetFile: vi.fn(),
    listBaselines: vi.fn(async (_projectId, configSetId) =>
      configSetId === "cs-default"
        ? [
            {
              id: "baseline-seed-v1",
              organizationId: "org-1",
              configSetId,
              name: "seed-v1",
              status: "released",
              createdAt: "2026-08-06T08:00:00.000Z"
            }
          ]
        : []
    ),
    createBaseline: vi.fn(),
    getReleaseReadiness: vi.fn(async () => ({
      available: true,
      level: "ready" as const,
      blockers: [],
      warnings: [],
      gateToken: "gate-token-test",
      evaluatedAt: "2026-08-07T00:00:00.000Z",
      configSetId: "cs-default",
      projectId: PROJECT.id,
      canCreateBaseline: true,
      canRelease: true
    })),
    compareBaseline: vi.fn(),
    rollbackBaseline: vi.fn(),
    releaseBaseline: vi.fn(),
    exportConfigSet: vi.fn(),
    submitStructuredEdits: vi.fn(),
    ...overrides
  } as DtsStructuredRepository;
}

function createFileRepository(
  overrides: Partial<ParameterFileRepository> = {}
): ParameterFileRepository {
  return {
    listFiles: vi.fn(async () => [
      {
        id: "file-board",
        projectId: PROJECT.id,
        fileName: "aurora-board.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-overlay",
        projectId: PROJECT.id,
        fileName: "charging-overlay.dtsi",
        format: "dts",
        enabled: true,
        currentVersionId: "version-overlay-4",
        currentVersionNumber: 4,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-loose",
        projectId: PROJECT.id,
        fileName: "notes.json",
        format: "json",
        enabled: true,
        currentVersionId: "version-loose-1",
        currentVersionNumber: 1,
        updatedAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "file-alpha",
        projectId: PROJECT.id,
        fileName: "alpha.dts",
        format: "dts",
        enabled: true,
        currentVersionId: "version-alpha-2",
        currentVersionNumber: 2,
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]),
    downloadVersion: vi.fn(async (_projectId, fileId, versionId) => ({
      contentType: "text/plain",
      fileName: fileId === "file-alpha" ? "alpha.dts" : "aurora-board.dts",
      bytes: new TextEncoder().encode(
        fileId === "file-alpha"
          ? "/dts-v1/;\n/ { model = \"Alpha\"; };\n"
          : `/dts-v1/;\n/ { model = \"Aurora\"; /* ${versionId} */ };\n`
      )
    })),
    uploadFile: vi.fn(),
    uploadVersion: vi.fn(),
    listVersions: vi.fn(async () => []),
    syncFile: vi.fn(),
    listConflicts: vi.fn(async () => []),
    resolveConflict: vi.fn(),
    previewBulkConflictResolution: vi.fn(),
    resolveConflictsBulk: vi.fn(),
    listCandidates: vi.fn(async () => []),
    createCandidate: vi.fn(),
    getCandidate: vi.fn(),
    getCandidateImpact: vi.fn(),
    downloadCandidate: vi.fn(),
    abandonCandidate: vi.fn(),
    recomputeCandidate: vi.fn(),
    activateCandidate: vi.fn(),
    ...overrides
  } as ParameterFileRepository;
}

async function openWorkbenchMoreMenu() {
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  return screen.findByRole("menu", { name: "更多操作" });
}

async function openWorkbenchVersionDetails() {
  fireEvent.click(screen.getByRole("button", { name: /版本/ }));
  return screen.findByText(/发布基线：/);
}

async function openCreateConfigSetDialog() {
  fireEvent.change(screen.getByRole("combobox", { name: "配置集" }), {
    target: { value: "__create_config_set__" }
  });
  return screen.findByRole("heading", { name: "新建配置集" });
}

function ensureInspectorOpen() {
  const toggle = screen.getByRole("button", { name: "检查器" });
  if (toggle.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(toggle);
  }
}

function renderWorkbench(options: {
  search?: string;
  onNavigate?: ReturnType<typeof vi.fn>;
  dtsRepository?: DtsStructuredRepository;
  fileRepository?: ParameterFileRepository;
  listAuditEvents?: ProjectConfigurationWorkbenchProps["listAuditEvents"];
  syncSearch?: boolean;
  canEdit?: boolean;
  canEditCritical?: boolean;
  canAdmin?: boolean;
  currentUserId?: string;
  organizationId?: string;
  draftStorage?: ProjectConfigurationWorkbenchProps["draftStorage"];
} = {}) {
  const onNavigate = options.onNavigate ?? vi.fn();
  const sharedProps = {
    project: PROJECT,
    dtsRepository: options.dtsRepository ?? createDtsRepository(),
    fileRepository: options.fileRepository ?? createFileRepository(),
    ...(options.canEdit === undefined ? {} : { canEdit: options.canEdit }),
    ...(options.canEditCritical === undefined ? {} : { canEditCritical: options.canEditCritical }),
    ...(options.canAdmin === undefined ? {} : { canAdmin: options.canAdmin }),
    ...(options.listAuditEvents ? { listAuditEvents: options.listAuditEvents } : {}),
    ...(options.currentUserId === undefined ? {} : { currentUserId: options.currentUserId }),
    ...(options.organizationId === undefined ? {} : { organizationId: options.organizationId }),
    ...(options.draftStorage ? { draftStorage: options.draftStorage } : {})
  };
  if (options.syncSearch) {
    function Harness() {
      const [search, setSearch] = useState(options.search ?? "");
      return (
        <ProjectConfigurationWorkbench
          {...sharedProps}
          search={search}
          onNavigate={(path) => {
            onNavigate(path);
            const queryIndex = path.indexOf("?");
            setSearch(queryIndex >= 0 ? path.slice(queryIndex) : "");
          }}
        />
      );
    }
    render(<Harness />);
    return { onNavigate };
  }
  render(
    <ProjectConfigurationWorkbench
      {...sharedProps}
      search={options.search ?? ""}
      onNavigate={onNavigate}
    />
  );
  return { onNavigate };
}

const BOARD_STRUCTURE = {
  nodes: [
    {
      nodePath: "board",
      name: "board",
      labels: ["board_label"],
      compatible: "wiseeff,aurora",
      status: "okay",
      properties: [
        {
          name: "model",
          valueType: "string-list" as const,
          rawText: '"Aurora"',
          normalizedValue: "Aurora",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        },
        {
          name: "compatible",
          valueType: "string-list" as const,
          rawText: '"wiseeff,aurora"',
          normalizedValue: "wiseeff,aurora",
          source: {
            startOffset: 40,
            endOffset: 58,
            startLine: 3,
            startColumn: 3,
            endLine: 3,
            endColumn: 21
          }
        }
      ],
      phandleRefs: [],
      source: {
        startOffset: 10,
        endOffset: 70,
        startLine: 1,
        startColumn: 1,
        endLine: 4,
        endColumn: 2
      }
    },
    {
      nodePath: "regulator",
      name: "regulator",
      labels: [],
      properties: [
        {
          name: "regulator-min-microvolt",
          valueType: "u32-array" as const,
          rawText: "<0x1000>",
          normalizedValue: "4096",
          source: {
            startOffset: 80,
            endOffset: 90,
            startLine: 5,
            startColumn: 3,
            endLine: 5,
            endColumn: 13
          }
        }
      ],
      phandleRefs: [],
      source: {
        startOffset: 70,
        endOffset: 100,
        startLine: 4,
        startColumn: 1,
        endLine: 6,
        endColumn: 2
      }
    }
  ]
};

describe("ProjectConfigurationWorkbench", () => {
  it("selects the deterministic default Config set and renders working source identities", async () => {
    const { onNavigate } = renderWorkbench();

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "配置集" })).toHaveValue("cs-default");
    expect(screen.getByText("工作配置")).toBeInTheDocument();
    await openWorkbenchVersionDetails();
    expect(screen.getByText(/发布基线：seed-v1/)).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /aurora-board\.dts.*基础.*v12/ })).toBeInTheDocument();
    expect(screen.getAllByText("version-board-12").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("group", { name: "未编组项目文件" })).toHaveTextContent("notes.json");
    expect(await screen.findByText(/model = "Aurora"/)).toBeInTheDocument();
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        "/parameter-admin/projects/project-1/configuration?configSet=cs-default&file=file-board"
      )
    );
    expect(screen.getByRole("button", { name: "上传候选" })).toBeEnabled();
    await openWorkbenchMoreMenu();
    expect(screen.getByRole("menuitem", { name: "创建基线" })).toBeEnabled();
    expect(await screen.findByLabelText("发布就绪")).toHaveAttribute("data-level", "ready");
  });

  it("lets a valid URL-selected Config set win and keeps source selection shareable", async () => {
    const { onNavigate } = renderWorkbench({ search: "?configSet=cs-alpha" });

    expect(await screen.findByRole("heading", { name: "alpha.dts" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "配置集" })).toHaveValue("cs-alpha");
    expect(await screen.findByText(/model = "Alpha"/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "配置集" }), {
      target: { value: "cs-default" }
    });
    expect(onNavigate).toHaveBeenCalledWith(
      "/parameter-admin/projects/project-1/configuration?configSet=cs-default"
    );
  });

  it("falls back deterministically and chooses a source-bearing DTS member", async () => {
    const listConfigSets = vi.fn(async () => [
      {
        id: "cs-later",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "later",
        createdAt: "2026-08-06T09:00:00.000Z",
        updatedAt: "2026-08-06T09:00:00.000Z"
      },
      {
        id: "cs-first",
        organizationId: "org-1",
        projectId: PROJECT.id,
        name: "first",
        createdAt: "2026-08-06T08:00:00.000Z",
        updatedAt: "2026-08-06T08:00:00.000Z"
      }
    ]);
    const listConfigSetFiles = vi.fn(async (projectId: string, configSetId: string) => [
      {
        configSetId,
        fileId: "file-metadata",
        fileName: "metadata.json",
        format: "json" as const,
        role: "misc" as const,
        sortOrder: 0,
        currentVersionId: "version-metadata-1",
        currentVersionNumber: 1
      },
      {
        configSetId,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        role: "base" as const,
        sortOrder: 1,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12
      }
    ]);
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode("/dts-v1/;\n/ { primary-source; };\n")
    }));

    renderWorkbench({
      search: "?configSet=unknown&file=unknown",
      dtsRepository: createDtsRepository({ listConfigSets, listConfigSetFiles }),
      fileRepository: createFileRepository({ downloadVersion })
    });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "配置集" })).toHaveValue("cs-first");
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12")
    );
    expect(await screen.findByText(/primary-source/)).toBeInTheDocument();
  });

  it("preserves the tree and retries only a failed source request", async () => {
    const downloadVersion = vi
      .fn()
      .mockRejectedValueOnce(new Error("source unavailable"))
      .mockResolvedValueOnce({
        contentType: "text/plain",
        fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode("/dts-v1/;\n/ { recovered; };\n")
      });
    renderWorkbench({ fileRepository: createFileRepository({ downloadVersion }) });

    expect(await screen.findByText("source unavailable")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: /aurora-board\.dts/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试源码" }));

    await waitFor(() => expect(screen.getByText(/recovered/)).toBeInTheDocument());
    expect(downloadVersion).toHaveBeenCalledTimes(2);
  });

  it("joins membership ids with file metadata so mock-added members load active source", async () => {
    const listConfigSetFiles = vi.fn(async () => [
      {
        configSetId: "cs-default",
        fileId: "file-uploaded",
        fileName: "file-uploaded",
        format: "dts" as const,
        role: "overlay" as const,
        sortOrder: 0
      }
    ]);
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "uploaded.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Uploaded"; };\n')
    }));

    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles }),
      fileRepository: createFileRepository({
        listFiles: vi.fn(async () => [
          {
            id: "file-uploaded",
            projectId: PROJECT.id,
            fileName: "uploaded.dts",
            format: "dts",
            enabled: true,
            currentVersionId: "version-uploaded-1",
            currentVersionNumber: 1,
            updatedAt: "2026-08-06T08:00:00.000Z"
          }
        ]),
        downloadVersion
      })
    });

    expect(await screen.findByRole("heading", { name: "uploaded.dts" })).toBeInTheDocument();
    expect(await screen.findByText(/model = "Uploaded"/)).toBeInTheDocument();
    expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-uploaded", "version-uploaded-1");
    expect(screen.getByRole("treeitem", { name: /uploaded\.dts.*覆盖层.*v1/ })).toBeInTheDocument();
  });

  it("shows a recoverable empty-source state after a successful zero-byte download", async () => {
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new Uint8Array()
    }));

    renderWorkbench({ fileRepository: createFileRepository({ downloadVersion }) });

    expect(await screen.findByText("源码内容为空")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试源码" })).toBeInTheDocument();
  });

  it("keeps the working source visible while a release baseline failure is retried", async () => {
    const listBaselines = vi
      .fn()
      .mockRejectedValueOnce(new Error("baseline unavailable"))
      .mockResolvedValueOnce([]);
    renderWorkbench({ dtsRepository: createDtsRepository({ listBaselines }) });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    await openWorkbenchVersionDetails();
    expect(screen.getByText(/发布基线：不可用/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试发布基线" }));

    await waitFor(() => expect(screen.getByText(/发布基线：尚未发布/)).toBeInTheDocument());
    expect(listBaselines).toHaveBeenCalledTimes(2);
  });

  it("exposes tree, inspector, and task dock as explicitly controlled shells", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });

    expect(screen.getByRole("complementary", { name: "源结构" })).toBeInTheDocument();
    const inspectorToggle = screen.getByRole("button", { name: "检查器" });
    const taskToggle = screen.getByRole("button", { name: "任务" });
    expect(inspectorToggle).toHaveAttribute("aria-expanded", "false");
    expect(taskToggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "折叠源结构" }));
    expect(screen.queryByRole("complementary", { name: "源结构" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开源结构" }));
    expect(screen.getByRole("complementary", { name: "源结构" })).toBeInTheDocument();

    fireEvent.click(inspectorToggle);
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toBeInTheDocument();
    fireEvent.click(taskToggle);
    const tasksRegion = screen.getByRole("region", { name: "配置任务" });
    expect(tasksRegion).toHaveTextContent("会话变更");
    expect(tasksRegion).toHaveTextContent("任务证据");
  });

  it("does not auto-open the inspector when navigating the DTS tree or search hits", async () => {
    const search = vi.fn(async () => ({
      hits: [
        {
          fileId: "file-board",
          fileName: "aurora-board.dts",
          versionId: "version-board-12",
          nodePath: "board",
          propertyName: "model",
          snippet: "model",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        }
      ]
    }));
    renderWorkbench({
      dtsRepository: createDtsRepository({
        getStructure: vi.fn(async () => BOARD_STRUCTURE),
        search
      })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("统一搜索查询"), { target: { value: "model" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    await screen.findByLabelText("搜索结果");
    fireEvent.click(screen.getByRole("button", { name: /board/ }));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
  });

  it("opens a typed StructuredValueEditor for an editable property with context metadata", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();

    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("字符串列表");
    expect(inspector).toHaveTextContent('"Aurora"');
    expect(inspector).toHaveTextContent("Aurora");
    expect(inspector).toHaveTextContent(/L2:3/);
    expect(inspector).toHaveTextContent("常规");
    expect(inspector).toHaveTextContent(/变更原因/);
    expect(inspector).toHaveTextContent("可编辑");
    expect(within(inspector).getByRole("group", { name: "字符串列表" })).toBeInTheDocument();
    expect(within(inspector).getByLabelText("字符串 1")).toBeEnabled();
    expect(screen.getByLabelText("只读 DTS 源码").querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("locks writes with product language when parameter edit capability is missing", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      canEdit: false,
      canEditCritical: false
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();

    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent(/你的角色没有修改参数的权限/);
    expect(inspector).not.toHaveTextContent(/parameter:edit/);
    expect(within(inspector).getByLabelText("字符串 1")).toBeDisabled();
    expect(inspector).toHaveTextContent('"Aurora"');
  });

  it("locks critical node edits with product language while keeping read context", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      canEdit: true,
      canEditCritical: false
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 regulator" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 regulator/regulator-min-microvolt" }));
    ensureInspectorOpen();

    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent(/安全关键节点，你的角色没有修改它的权限/);
    expect(inspector).not.toHaveTextContent(/parameter:edit-critical/);
    expect(within(inspector).getByLabelText("数值 1")).toBeDisabled();
  });

  it("records typed edits in the session-changes dock with shared tree and gutter identity", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.change(within(inspector).getByLabelText("字符串 1"), {
      target: { value: "Aurora-X" }
    });

    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(tasks).toHaveTextContent("会话变更");
    expect(screen.getByRole("button", { name: "任务" })).toHaveTextContent("1");
    const draftRow = within(tasks).getByRole("checkbox", { name: /board\/model/ });
    expect(draftRow).toBeChecked();
    expect(draftRow).toHaveAttribute("data-property-identity", "board::model");

    const treeProperty = screen.getByRole("treeitem", { name: "属性 board/model" });
    expect(treeProperty).toHaveAttribute("data-property-identity", "board::model");
    expect(treeProperty).toHaveAttribute("data-session-change", "true");

    const gutter = document.querySelector('[data-session-gutter="board::model"]');
    expect(gutter).not.toBeNull();
    expect(gutter).toHaveAttribute("data-line", "2");
  });

  it("validates and submits a selected subset via submitStructuredEdits with rawText fidelity", async () => {
    const submitStructuredEdits = vi.fn().mockResolvedValue({
      id: "round-1",
      projectId: PROJECT.id,
      status: "submitted",
      items: [{ parameterId: "ppv-model", targetValue: '"Aurora-X"', reason: "workbench" }]
    });
    // Persist across Strict Mode remounts and post-submit structure refresh.
    let structureResult = BOARD_STRUCTURE;
    const getStructure = vi.fn(async () => structureResult);

    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure, submitStructuredEdits }),
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const boardNode = await screen.findByRole("treeitem", { name: "节点 board" });
    fireEvent.click(boardNode);
    const modelProperty = await screen.findByRole("treeitem", { name: "属性 board/model" });
    fireEvent.click(modelProperty);
    ensureInspectorOpen();
    let inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.change(within(inspector).getByLabelText("字符串 1"), {
      target: { value: "Aurora-X" }
    });

    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/compatible" }));
    inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.change(within(inspector).getByLabelText("字符串 1"), {
      target: { value: "wiseeff,aurora-v2" }
    });

    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(within(tasks).getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(within(tasks).getByRole("checkbox", { name: /board\/compatible/ }));
    fireEvent.change(within(tasks).getByLabelText("变更原因"), {
      target: { value: "board model bump" }
    });
    fireEvent.click(within(tasks).getByRole("button", { name: "校验所选" }));
    expect(within(tasks).getByRole("status")).toHaveTextContent(/校验通过/);

    structureResult = {
      nodes: [
        {
          ...BOARD_STRUCTURE.nodes[0],
          properties: [
            {
              ...BOARD_STRUCTURE.nodes[0].properties[0],
              rawText: '"Aurora-X"',
              normalizedValue: "Aurora-X"
            },
            BOARD_STRUCTURE.nodes[0].properties[1]
          ]
        },
        BOARD_STRUCTURE.nodes[1]
      ]
    };
    fireEvent.click(within(tasks).getByRole("button", { name: /提交所选/ }));

    await waitFor(() =>
      expect(submitStructuredEdits).toHaveBeenCalledWith(
        PROJECT.id,
        expect.objectContaining({
          edits: [
            expect.objectContaining({
              fileId: "file-board",
              nodePath: "board",
              propertyName: "model",
              rawText: expect.stringMatching(/Aurora-X/),
              reason: "board model bump"
            })
          ],
          reason: "board model bump"
        })
      )
    );
    expect(submitStructuredEdits.mock.calls[0][1].edits).toHaveLength(1);
    await waitFor(() => expect(within(tasks).getAllByRole("checkbox")).toHaveLength(1));
    expect(within(tasks).getByRole("checkbox", { name: /board\/compatible/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(tasks).getByRole("status")).toHaveTextContent(/已提交变更请求/)
    );
  });

  it("preserves session drafts when submitStructuredEdits fails", async () => {
    const submitStructuredEdits = vi.fn().mockRejectedValue(new Error("submit failed"));
    renderWorkbench({
      dtsRepository: createDtsRepository({
        getStructure: vi.fn(async () => BOARD_STRUCTURE),
        submitStructuredEdits
      }),
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.change(within(inspector).getByLabelText("字符串 1"), {
      target: { value: "Aurora-X" }
    });
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    fireEvent.change(within(tasks).getByLabelText("变更原因"), {
      target: { value: "attempt" }
    });
    fireEvent.click(within(tasks).getByRole("button", { name: /提交所选/ }));
    expect(await within(tasks).findByRole("alert")).toHaveTextContent("submit failed");
    expect(within(tasks).getByRole("checkbox", { name: /board\/model/ })).toBeInTheDocument();
    expect(within(inspector).getByLabelText("字符串 1")).toHaveValue("Aurora-X");
  });

  it("persists and restores compatible session drafts after remount with the same storage scope", async () => {
    const draftStorage = createMemoryStorage();
    const dtsRepository = createDtsRepository({
      getStructure: vi.fn(async () => BOARD_STRUCTURE)
    });
    renderWorkbench({
      dtsRepository,
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.change(within(inspector).getByLabelText("字符串 1"), {
      target: { value: "Aurora-Recovered" }
    });
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    fireEvent.change(within(tasks).getByLabelText("变更原因"), {
      target: { value: "recover me" }
    });
    await waitFor(() => {
      expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1);
    });
    cleanup();

    renderWorkbench({
      dtsRepository,
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    const restoredTasks = await screen.findByRole("region", { name: "配置任务" });
    expect(within(restoredTasks).getByRole("checkbox", { name: /board\/model/ })).toBeChecked();
    expect(within(restoredTasks).getByLabelText("变更原因")).toHaveValue("recover me");
    expect(restoredTasks).toHaveTextContent("Aurora-Recovered");
  });

  it("ignores late draft recovery from a previous scope generation", async () => {
    const draftStorage = createMemoryStorage();
    upsertSessionDraftBucket(
      {
        scope: {
          userId: "user-a",
          organizationId: "org-1",
          projectId: PROJECT.id,
          configSetId: "cs-default",
          fileId: "file-board",
          baseVersionId: "version-board-12"
        },
        drafts: {
          "file-board::board::model": {
            rawText: '"Late-Async"',
            normalizedValue: "Late-Async",
            valid: true
          }
        },
        selectedKeys: ["file-board::board::model"],
        reason: "should not apply after scope switch",
        updatedAt: "2026-08-07T10:00:00.000Z"
      },
      draftStorage
    );

    renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure: vi.fn(async () => BOARD_STRUCTURE) }),
      draftStorage,
      currentUserId: "user-a",
      syncSearch: true,
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(await screen.findByRole("region", { name: "配置任务" })).toHaveTextContent("Late-Async");

    fireEvent.change(screen.getByRole("combobox", { name: "配置集" }), {
      target: { value: "cs-alpha" }
    });
    await screen.findByRole("heading", { name: "alpha.dts" });
    await waitFor(() => {
      expect(screen.queryByText("Late-Async")).not.toBeInTheDocument();
      expect(screen.queryByDisplayValue("should not apply after scope switch")).not.toBeInTheDocument();
    });
  });

  it("locks the typed editor while recovered drafts are stale-base until reconfirm", async () => {
    const draftStorage = createMemoryStorage();
    let boardVersionId = "version-board-12";
    const listConfigSetFiles = vi.fn(async (_projectId: string, configSetId: string) => [
      {
        configSetId,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: boardVersionId,
        currentVersionNumber: boardVersionId === "version-board-13" ? 13 : 12
      },
      {
        configSetId,
        fileId: "file-overlay",
        fileName: "charging-overlay.dtsi",
        format: "dts",
        role: "overlay",
        sortOrder: 1,
        currentVersionId: "version-overlay-4",
        currentVersionNumber: 4
      }
    ]);
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles,
        getStructure: vi.fn(async () => BOARD_STRUCTURE)
      }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    fireEvent.change(
      within(await screen.findByRole("complementary", { name: "配置检查器" })).getByLabelText("字符串 1"),
      { target: { value: "Aurora-Stale-Lock" } }
    );
    await waitFor(() => expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1));
    cleanup();

    boardVersionId = "version-board-13";
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles,
        getStructure: vi.fn(async () => BOARD_STRUCTURE)
      }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent(/基线版本已变更：会话草稿仅可检查或复制/);
    expect(within(inspector).getByLabelText("字符串 1")).toBeDisabled();
  });

  it("marks recovered drafts stale when baseVersionId changes and blocks validate/submit", async () => {
    const draftStorage = createMemoryStorage();
    let boardVersionId = "version-board-12";
    const listConfigSetFiles = vi.fn(async (_projectId: string, configSetId: string) => [
      {
        configSetId,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: boardVersionId,
        currentVersionNumber: boardVersionId === "version-board-13" ? 13 : 12
      },
      {
        configSetId,
        fileId: "file-overlay",
        fileName: "charging-overlay.dtsi",
        format: "dts",
        role: "overlay",
        sortOrder: 1,
        currentVersionId: "version-overlay-4",
        currentVersionNumber: 4
      }
    ]);
    const getStructure = vi.fn(async () => BOARD_STRUCTURE);
    const submitStructuredEdits = vi.fn();

    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles, getStructure, submitStructuredEdits }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    fireEvent.change(
      within(await screen.findByRole("complementary", { name: "配置检查器" })).getByLabelText("字符串 1"),
      { target: { value: "Aurora-Stale" } }
    );
    await waitFor(() => expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1));
    cleanup();

    boardVersionId = "version-board-13";
    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles, getStructure, submitStructuredEdits }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(tasks).toHaveTextContent(/基线版本已变更/);
    expect(within(tasks).getByRole("checkbox", { name: /board\/model/ })).toBeInTheDocument();
    expect(within(tasks).getByRole("button", { name: "校验所选" })).toBeDisabled();
    expect(within(tasks).getByRole("button", { name: /提交所选/ })).toBeDisabled();
    expect(submitStructuredEdits).not.toHaveBeenCalled();
  });

  it("reconfirm against current base re-enables the dirty validate/submit path", async () => {
    const draftStorage = createMemoryStorage();
    let boardVersionId = "version-board-12";
    const listConfigSetFiles = vi.fn(async (_projectId: string, configSetId: string) => [
      {
        configSetId,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts",
        role: "base",
        sortOrder: 0,
        currentVersionId: boardVersionId,
        currentVersionNumber: boardVersionId === "version-board-13" ? 13 : 12
      }
    ]);
    const getStructure = vi.fn(async () => BOARD_STRUCTURE);

    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles, getStructure }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    fireEvent.change(
      within(await screen.findByRole("complementary", { name: "配置检查器" })).getByLabelText("字符串 1"),
      { target: { value: "Aurora-Reconfirm" } }
    );
    await waitFor(() => expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1));
    cleanup();

    boardVersionId = "version-board-13";
    renderWorkbench({
      dtsRepository: createDtsRepository({ listConfigSetFiles, getStructure }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    fireEvent.click(within(tasks).getByRole("button", { name: "基于当前基线继续编辑" }));
    await waitFor(() => {
      expect(within(tasks).getByRole("button", { name: "校验所选" })).not.toBeDisabled();
      expect(within(tasks).getByRole("button", { name: /提交所选/ })).not.toBeDisabled();
    });
    expect(readSessionDraftStore(draftStorage).buckets[0]?.scope.baseVersionId).toBe("version-board-13");
    fireEvent.click(within(tasks).getByRole("button", { name: "校验所选" }));
    expect(within(tasks).getByText(/校验通过：1 项/)).toBeInTheDocument();
  });

  it("asks before leaving with dirty drafts and discard clears storage then navigates", async () => {
    const draftStorage = createMemoryStorage();
    const { onNavigate } = renderWorkbench({
      dtsRepository: createDtsRepository({
        getStructure: vi.fn(async () => BOARD_STRUCTURE)
      }),
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    fireEvent.change(
      within(await screen.findByRole("complementary", { name: "配置检查器" })).getByLabelText("字符串 1"),
      { target: { value: "Aurora-Leave" } }
    );
    await waitFor(() => expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: /项目清单/ }));
    const leaveDialog = await screen.findByRole("dialog", { name: "离开配置工作台" });
    fireEvent.click(within(leaveDialog).getByRole("button", { name: "留在本页" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "离开配置工作台" })).not.toBeInTheDocument()
    );
    expect(onNavigate).not.toHaveBeenCalledWith("/parameter-admin/projects");
    expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /项目清单/ }));
    fireEvent.click(
      within(await screen.findByRole("dialog", { name: "离开配置工作台" })).getByRole("button", {
        name: "丢弃并离开"
      })
    );
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/projects");
    expect(draftStorage.getItem(SESSION_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("does not restore session drafts for a different currentUserId", async () => {
    const draftStorage = createMemoryStorage();
    const dtsRepository = createDtsRepository({
      getStructure: vi.fn(async () => BOARD_STRUCTURE)
    });
    renderWorkbench({
      dtsRepository,
      draftStorage,
      currentUserId: "user-a",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    ensureInspectorOpen();
    fireEvent.change(
      within(await screen.findByRole("complementary", { name: "配置检查器" })).getByLabelText("字符串 1"),
      { target: { value: "Aurora-UserA" } }
    );
    await waitFor(() => expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1));
    cleanup();

    renderWorkbench({
      dtsRepository,
      draftStorage,
      currentUserId: "user-b",
      canEdit: true,
      canEditCritical: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: /board\/model/ })).not.toBeInTheDocument();
    });
    expect(readSessionDraftStore(draftStorage).buckets).toHaveLength(1);
  });

  it("loads nested structure under the selected member and focuses source spans from tree selection", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: ["board"],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const onNavigate = vi.fn();
    renderWorkbench({
      onNavigate,
      dtsRepository: createDtsRepository({ getStructure })
    });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    await waitFor(() => expect(getStructure).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12"));
    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("node=board"))).toBe(true)
    );
    fireEvent.click(await screen.findByRole("treeitem", { name: "属性 board/model" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("property=model"))).toBe(true)
    );
    await waitFor(() =>
      expect(document.querySelector('[data-focused="true"]')).not.toBeNull()
    );
  });

  it("groups unified search hits by file and navigates across members while preserving config set", async () => {
    const search = vi.fn(async () => ({
      hits: [
        {
          fileId: "file-overlay",
          fileName: "charging-overlay.dtsi",
          versionId: "version-overlay-4",
          nodePath: "charger",
          snippet: "charger",
          source: {
            startOffset: 1,
            endOffset: 8,
            startLine: 1,
            startColumn: 1,
            endLine: 1,
            endColumn: 8
          }
        },
        {
          fileId: "file-board",
          fileName: "aurora-board.dts",
          versionId: "version-board-12",
          nodePath: "board",
          propertyName: "model",
          snippet: "model=Aurora",
          source: {
            startOffset: 20,
            endOffset: 28,
            startLine: 2,
            startColumn: 3,
            endLine: 2,
            endColumn: 11
          }
        }
      ]
    }));
    const onNavigate = vi.fn();
    renderWorkbench({
      onNavigate,
      dtsRepository: createDtsRepository({ search })
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });

    fireEvent.change(screen.getByRole("searchbox", { name: "统一搜索查询" }), {
      target: { value: "board" }
    });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const results = await screen.findByLabelText("搜索结果");
    expect(results).toHaveTextContent("charging-overlay.dtsi");
    expect(results).toHaveTextContent("aurora-board.dts");
    await waitFor(() => expect(search).toHaveBeenCalledWith(PROJECT.id, { q: "board" }));

    fireEvent.click(screen.getByRole("button", { name: /charger/ }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("configSet=cs-default") && url.includes("file=file-overlay") && url.includes("node=charger"))).toBe(true);
    });
  });

  it("restores node and property deep links from the URL", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: [],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&node=board&property=model&sourceMode=structured",
      dtsRepository: createDtsRepository({ getStructure })
    });
    const propertyItem = await screen.findByRole("treeitem", { name: "属性 board/model" });
    await waitFor(() => expect(propertyItem).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    ensureInspectorOpen();
    expect(await screen.findByText("属性名")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("model");
    expect(inspector).toHaveTextContent("字符串列表");
  });

  it("retries only the structure tree when structure loading fails", async () => {
    const getStructure = vi
      .fn()
      .mockRejectedValueOnce(new Error("structure unavailable"))
      .mockResolvedValueOnce({
        nodes: [
          {
            nodePath: "board",
            name: "board",
            labels: [],
            properties: [],
            phandleRefs: [],
            source: {
              startOffset: 1,
              endOffset: 5,
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 5
            }
          }
        ]
      });
    renderWorkbench({ dtsRepository: createDtsRepository({ getStructure }) });
    expect(await screen.findByText("structure unavailable")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试结构树" }));
    expect(await screen.findByRole("treeitem", { name: "节点 board" })).toBeInTheDocument();
    expect(getStructure).toHaveBeenCalledTimes(2);
  });

  it("uses Alt keyboard helpers for search focus and next match without requiring meta/ctrl", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const search = screen.getByRole("searchbox", { name: "统一搜索查询" });
    fireEvent.keyDown(window, { key: "f", altKey: true });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Aurora" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.keyDown(window, { key: "n", altKey: true });
    // Next-match token is accepted without throwing; browser shortcuts remain untouched for ctrl/meta.
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(search).toHaveFocus();
  });

  it("opens inspector content for config set, file, node, and property without changing source identity unexpectedly", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: ["board_label"],
          compatible: "wiseeff,aurora",
          status: "okay",
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByUserId: "user-admin"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByUserId: "user-ops"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      dtsRepository: createDtsRepository({ getStructure }),
      fileRepository: createFileRepository({ listVersions }),
      syncSearch: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });

    fireEvent.click(screen.getByRole("button", { name: "检查器" }));
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("检查层级");
    expect(inspector).toHaveTextContent("文件");
    expect(inspector).toHaveTextContent("候选文件版本");
    expect(inspector).toHaveTextContent("尚未上传");
    expect(within(inspector).getByRole("button", { name: "关闭检查器" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: /aurora-board\.dts/ }));
    expect(await screen.findByText("文件格式")).toBeInTheDocument();
    expect(screen.getByText("dts")).toBeInTheDocument();
    expect(await screen.findByLabelText("不可变版本历史")).toBeInTheDocument();
    expect(screen.getByText(/版本 11/)).toBeInTheDocument();
    expect(listVersions).toHaveBeenCalledWith(PROJECT.id, "file-board");

    fireEvent.click(await screen.findByRole("treeitem", { name: "节点 board" }));
    expect(await screen.findByText("节点路径")).toBeInTheDocument();
    expect(screen.getByText("board_label")).toBeInTheDocument();
    expect(screen.getByText("wiseeff,aurora")).toBeInTheDocument();
    expect(screen.getByText("常规")).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "属性 board/model" }));
    expect(await screen.findByText("属性名")).toBeInTheDocument();
    expect(within(inspector).getByText("字符串列表")).toBeInTheDocument();
    expect(within(inspector).getAllByText('"Aurora"').length).toBeGreaterThanOrEqual(1);
    expect(within(inspector).getByLabelText("字符串 1")).toHaveValue("Aurora");
    expect(within(inspector).getByText(/L2:3/)).toBeInTheDocument();

    const sourceHeading = screen.getByRole("heading", { name: "aurora-board.dts" });
    expect(sourceHeading).toBeInTheDocument();
    expect(onNavigate.mock.calls.at(-1)?.[0]).toContain("file=file-board");
  });

  it("updates inspector level from tree selection while preserving source selection", async () => {
    const getStructure = vi.fn(async () => ({
      nodes: [
        {
          nodePath: "board",
          name: "board",
          labels: [],
          properties: [
            {
              name: "model",
              valueType: "string-list" as const,
              rawText: '"Aurora"',
              normalizedValue: "Aurora",
              source: {
                startOffset: 20,
                endOffset: 28,
                startLine: 2,
                startColumn: 3,
                endLine: 2,
                endColumn: 11
              }
            }
          ],
          phandleRefs: [],
          source: {
            startOffset: 10,
            endOffset: 40,
            startLine: 1,
            startColumn: 1,
            endLine: 3,
            endColumn: 2
          }
        }
      ]
    }));
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&node=board&property=model",
      dtsRepository: createDtsRepository({ getStructure }),
      syncSearch: true
    });
    await screen.findByRole("treeitem", { name: "属性 board/model" });
    expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument();
    ensureInspectorOpen();
    expect(await screen.findByText("属性名")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭检查器" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: "节点 board" }));
    await waitFor(() => expect(screen.getByText("节点路径")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("treeitem", { name: /aurora-board\.dts/ }));
    await waitFor(() => expect(screen.getByText("文件格式")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    const urls = onNavigate.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("file=file-board") && !url.includes("node="))).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "关闭检查器" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "配置检查器" })).not.toBeInTheDocument()
    );
  });

  it("enters historical source mode, downloads a version, and restores working target on exit", async () => {
    const downloadVersion = vi.fn(async (_projectId: string, _fileId: string, versionId: string) => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode(
        versionId === "version-board-11"
          ? `/dts-v1/;\n/ { model = "Legacy"; /* ${versionId} */ };\n`
          : `/dts-v1/;\n/ { model = "Aurora"; /* ${versionId} */ };\n`
      )
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z",
        createdByUserId: "user-admin"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z",
        createdByUserId: "user-ops"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      fileRepository: createFileRepository({ downloadVersion, listVersions }),
      syncSearch: true
    });
    await screen.findByText(/model = "Aurora"/);
    fireEvent.click(screen.getByRole("button", { name: "检查器" }));
    expect(await screen.findByLabelText("不可变版本历史")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看版本 11 历史源码" }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("sourceMode=history") && url.includes("version=version-board-11"))).toBe(
        true
      );
    });
    expect(await screen.findByLabelText("历史只读源码模式")).toBeInTheDocument();
    expect(await screen.findByText(/model = "Legacy"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下载版本 11" }));
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-11")
    );

    fireEvent.click(screen.getByRole("button", { name: "退出历史源码" }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("file=file-board") && !url.includes("sourceMode=history"))).toBe(true);
    });
    expect(await screen.findByText(/model = "Aurora"/)).toBeInTheDocument();
  });

  it("supports unified and side-by-side diff modes and restores working source afterward", async () => {
    const downloadVersion = vi.fn(async (_projectId: string, _fileId: string, versionId: string) => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode(
        versionId === "version-board-11"
          ? `/dts-v1/;\n/ { model = "Legacy"; };\n`
          : `/dts-v1/;\n/ { model = "Aurora"; };\n`
      )
    }));
    const listVersions = vi.fn(async () => [
      {
        id: "version-board-12",
        fileId: "file-board",
        versionNumber: 12,
        checksum: "abc",
        sizeBytes: 32,
        parsedIndex: {},
        origin: "upload" as const,
        createdAt: "2026-08-06T08:00:00.000Z"
      },
      {
        id: "version-board-11",
        fileId: "file-board",
        versionNumber: 11,
        checksum: "def",
        sizeBytes: 30,
        parsedIndex: {},
        origin: "writeback" as const,
        createdAt: "2026-08-05T08:00:00.000Z"
      }
    ]);
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&sourceMode=unified-diff&version=version-board-11",
      fileRepository: createFileRepository({ downloadVersion, listVersions }),
      syncSearch: true
    });
    expect(await screen.findByLabelText("统一差异对比")).toBeInTheDocument();
    expect(screen.getByLabelText("只读 DTS 源码")).toHaveTextContent("只读对比");
    expect(screen.getByLabelText("统一差异对比")).toHaveTextContent("Legacy");

    fireEvent.click(screen.getByRole("button", { name: "并排对比" }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("sourceMode=side-by-side"))).toBe(true)
    );
    expect(await screen.findByLabelText("并排差异对比")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "退出对比" }));
    await waitFor(() =>
      expect(
        onNavigate.mock.calls.some(
          (call) => String(call[0]).includes("file=file-board") && !String(call[0]).includes("sourceMode=")
        )
      ).toBe(true)
    );
  });

  it("keeps inspector overlay by default and becomes persistent only when source stays ≥640px", async () => {
    renderWorkbench();
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "检查器" }));
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveAttribute("data-layout", "overlay");

    const body = screen.getByLabelText("工作台主体");
    Object.defineProperty(body, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 1400, height: 800, top: 0, left: 0, bottom: 800, right: 1400, x: 0, y: 0, toJSON: () => ({}) })
    });
    const tree = screen.getByLabelText("源结构");
    Object.defineProperty(tree, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ width: 260, height: 800, top: 0, left: 0, bottom: 800, right: 260, x: 0, y: 0, toJSON: () => ({}) })
    });
    fireEvent(window, new Event("resize"));
    await waitFor(() => expect(inspector).toHaveAttribute("data-layout", "persistent"));
  });

  it("clears history version identity when switching member files", async () => {
    const { onNavigate } = renderWorkbench({
      search: "?configSet=cs-default&file=file-board&sourceMode=history&version=version-board-11",
      syncSearch: true
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("treeitem", { name: /charging-overlay\.dtsi/ }));
    await waitFor(() => {
      const urls = onNavigate.mock.calls.map((call) => String(call[0]));
      expect(
        urls.some(
          (url) =>
            url.includes("file=file-overlay") &&
            !url.includes("sourceMode=history") &&
            !url.includes("version=version-board-11")
        )
      ).toBe(true);
    });
  });

  it("uploads a candidate, shows impact evidence, and abandons without activating", async () => {
    const candidate = {
      id: "cand-1",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      baseVersionId: "version-board-12",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- active\n+++ candidate\n+model = \"Cand\";",
        structuralDiff: [{ kind: "prop_changed" as const, nodePath: "/board", prop: "model", before: "Aurora", after: "Cand" }],
        diagnostics: [],
        blockers: [],
        conflicts: [],
        coverage: {
          matchedRegistered: ["wiseeff,cand"],
          newUnregistered: [],
          matchedRegisteredCount: 1,
          newUnregisteredCount: 0
        }
      },
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z"
    };
    const createCandidate = vi.fn(async () => candidate);
    const getCandidate = vi.fn(async () => candidate);
    const downloadCandidate = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Cand"; };\n')
    }));
    const abandonCandidate = vi.fn(async () => ({ ...candidate, status: "abandoned" as const }));

    const { onNavigate } = renderWorkbench({
      syncSearch: true,
      fileRepository: createFileRepository({
        createCandidate,
        getCandidate,
        downloadCandidate,
        abandonCandidate
      })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(uploadInput).toBeTruthy();
    const file = new File(['/dts-v1/;\n/ { model = "Cand"; };\n'], "aurora-board.dts", {
      type: "text/plain"
    });
    Object.defineProperty(uploadInput, "files", {
      configurable: true,
      value: [file]
    });
    fireEvent.change(uploadInput);

    await waitFor(() => expect(createCandidate).toHaveBeenCalled());
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("sourceMode=candidate"))).toBe(true)
    );
    expect(await screen.findByLabelText("候选只读源码模式")).toBeInTheDocument();
    await openWorkbenchVersionDetails();
    expect(screen.getByLabelText("配置身份")).toHaveTextContent("ready");
    const inspectorToggle = screen.getByRole("button", { name: "检查器" });
    if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(inspectorToggle);
    }
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("结构差异");
    expect(inspector).toHaveTextContent("覆盖/映射");
    expect(inspector).toHaveTextContent("文本差异");
    fireEvent.click(screen.getByRole("button", { name: "放弃候选" }));
    await waitFor(() => expect(abandonCandidate).toHaveBeenCalledWith(PROJECT.id, "cand-1"));
  });

  it("activates a ready candidate after impact confirmation and refreshes without full reset", async () => {
    const candidate = {
      id: "cand-ready",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      baseVersionId: "version-board-12",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- active\n+++ candidate\n+model = \"Act\";",
        structuralDiff: [{ kind: "prop_changed" as const, nodePath: "/board", prop: "model", before: "Aurora", after: "Act" }],
        diagnostics: [],
        blockers: [],
        conflicts: [],
        coverage: {
          matchedRegistered: ["wiseeff,cand"],
          newUnregistered: [],
          matchedRegisteredCount: 1,
          newUnregisteredCount: 0
        }
      },
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z"
    };
    const activateCandidate = vi.fn(async () => ({
      item: { ...candidate, status: "active" as const, activatedVersionId: "version-board-13" },
      file: {
        id: "file-board",
        projectId: PROJECT.id,
        fileName: "aurora-board.dts",
        format: "dts" as const,
        enabled: true,
        currentVersionId: "version-board-13",
        currentVersionNumber: 13,
        updatedAt: "2026-08-07T01:00:00.000Z"
      },
      version: {
        id: "version-board-13",
        fileId: "file-board",
        versionNumber: 13,
        checksum: "act",
        sizeBytes: 32,
        origin: "upload" as const,
        createdAt: "2026-08-07T01:00:00.000Z"
      }
    }));
    const getCandidate = vi.fn(async () => candidate);
    const downloadCandidate = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Act"; };\n')
    }));

    const { onNavigate } = renderWorkbench({
      syncSearch: true,
      search: "?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-ready",
      fileRepository: createFileRepository({
        getCandidate,
        downloadCandidate,
        activateCandidate
      })
    });

    expect(await screen.findByLabelText("候选只读源码模式")).toBeInTheDocument();
    const inspectorToggle = screen.getByRole("button", { name: "检查器" });
    if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(inspectorToggle);
    }
    const activateButton = await screen.findByTestId("activate-candidate");
    expect(activateButton).toBeEnabled();
    fireEvent.click(activateButton);
    expect(await screen.findByRole("heading", { name: "确认激活候选" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "确认激活" }));
    await waitFor(() =>
      expect(activateCandidate).toHaveBeenCalledWith(PROJECT.id, "cand-ready", {
        expectedCurrentVersionId: "version-board-12",
        configSetId: undefined,
        role: undefined
      })
    );
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("file=file-board"))).toBe(true)
    );
    expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
  });

  it("does not offer activate for blocked, failed, abandoned, or stale candidates", async () => {
    for (const status of ["blocked", "failed", "abandoned", "stale"] as const) {
      cleanup();
      const candidate = {
        id: `cand-${status}`,
        projectId: PROJECT.id,
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        status,
        baseVersionId: "version-board-12",
        diagnostics: [],
        blockers: status === "blocked" ? [{ code: "open-conflict", message: "conflict" }] : [],
        impact: { textDiff: "", structuralDiff: [], diagnostics: [], blockers: [], conflicts: [] },
        createdAt: "2026-08-07T00:00:00.000Z",
        updatedAt: "2026-08-07T00:00:00.000Z"
      };
      renderWorkbench({
        search: `?configSet=cs-default&file=file-board&sourceMode=candidate&candidate=cand-${status}`,
        fileRepository: createFileRepository({
          getCandidate: vi.fn(async () => candidate),
          downloadCandidate: vi.fn(async () => ({
            contentType: "text/plain",
            fileName: "aurora-board.dts",
            bytes: new TextEncoder().encode("/dts-v1/;\n/ { };\n")
          }))
        })
      });
      await screen.findByLabelText("候选只读源码模式");
      const inspectorToggle = screen.getByRole("button", { name: "检查器" });
      if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
        fireEvent.click(inspectorToggle);
      }
      await screen.findByRole("complementary", { name: "配置检查器" });
      expect(screen.queryByTestId("activate-candidate")).not.toBeInTheDocument();
    }
  });

  it("opens file and config-set inspectors from cutover query params", async () => {
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&inspector=file"
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const fileInspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(within(fileInspector).getByText("aurora-board.dts")).toBeInTheDocument();

    cleanup();
    renderWorkbench({
      search: "?configSet=cs-default&inspector=config-set"
    });
    const configInspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(configInspector).toHaveTextContent("default");
    expect(screen.getByRole("button", { name: "检查器" })).toHaveAttribute("aria-expanded", "true");
  });

  it("opens the Conflicts task dock from tasks=conflicts cutover query", async () => {
    renderWorkbench({
      search: "?configSet=cs-default&file=file-board&tasks=conflicts"
    });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "任务" })).toHaveAttribute("aria-expanded", "true")
    );
  });

  it("opens Activity from the command bar without a permanent audit banner above source", async () => {
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-activity-1",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-candidate-create",
          action: "create",
          severity: "Medium" as const,
          targetType: "project-parameter-file-candidate",
          targetId: "cand-1",
          metadata: {
            fileName: "aurora-board.dts",
            fileId: "file-board",
            status: "ready"
          },
          traceId: "trace-activity-1",
          createdAt: "2026-08-07T04:00:00.000Z"
        }
      ],
      nextCursor: null
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    expect(screen.queryByLabelText("治理审计")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("项目活动");
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(listAuditEvents.mock.calls[0]?.[0]).toMatchObject({
      projectId: PROJECT.id,
      apps: expect.arrayContaining(["parameters", "parameter-management", "parameter-admin"])
    });
    expect(inspector).toHaveTextContent("Ada Admin");
    expect(inspector).toHaveTextContent("创建");
    expect(inspector).toHaveTextContent("候选文件版本");
    expect(inspector).toHaveTextContent("成功");
  });


  it("restores file context from a targetable activity event and fails gracefully when missing", async () => {
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-file",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-upload",
          action: "upload",
          severity: "Low" as const,
          targetType: "project-parameter-file",
          targetId: "file-overlay",
          metadata: { fileName: "charging-overlay.dtsi" },
          traceId: "trace-file",
          createdAt: "2026-08-07T04:01:00.000Z"
        },
        {
          id: "evt-missing",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-candidate-create",
          action: "create",
          severity: "Medium" as const,
          targetType: "project-parameter-file-candidate",
          targetId: "cand-gone",
          metadata: { fileName: "gone.dts", fileId: "file-board", status: "ready" },
          traceId: "trace-missing",
          createdAt: "2026-08-07T04:02:00.000Z"
        }
      ],
      nextCursor: null
    }));
    const onNavigate = vi.fn();

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      onNavigate,
      listAuditEvents,
      syncSearch: true
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    await screen.findByLabelText("项目活动事件");

    fireEvent.click(screen.getByRole("button", { name: /上传 · 参数文件 · charging-overlay\.dtsi/i }));
    await waitFor(() =>
      expect(onNavigate.mock.calls.some((call) => String(call[0]).includes("file=file-overlay"))).toBe(true)
    );

    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    await screen.findByLabelText("项目活动事件");
    fireEvent.click(screen.getByRole("button", { name: /创建 · 候选文件版本 · gone\.dts/i }));
    expect(await screen.findByRole("status", { name: "活动目标不可用" })).toHaveTextContent(/候选/);
    expect(screen.getByRole("main", { name: "只读 DTS 源码" })).toBeInTheDocument();
  });


  it("shows mutation toasts and refreshes the activity timeline from server evidence", async () => {
    const listAuditEvents = vi.fn(async () => ({ items: [], nextCursor: null }));
    const createCandidate = vi.fn(async () => ({
      id: "cand-1",
      projectId: PROJECT.id,
      fileId: "file-board",
      fileName: "aurora-board.dts",
      format: "dts" as const,
      status: "ready" as const,
      sizeBytes: 32,
      createdAt: "2026-08-07T05:00:00.000Z",
      updatedAt: "2026-08-07T05:00:00.000Z",
      diagnostics: [],
      blockers: [],
      impact: {
        textDiff: "--- a\n+++ b\n",
        structuralDiff: [],
        conflicts: [],
        blockers: []
      }
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents,
      fileRepository: createFileRepository({ createCandidate })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledTimes(1));

    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['/dts-v1/;\n/ { model = "Cand"; };\n'], "aurora-board.dts", {
      type: "text/plain"
    });
    Object.defineProperty(uploadInput, "files", { configurable: true, value: [file] });
    fireEvent.change(uploadInput);

    await waitFor(() => expect(createCandidate).toHaveBeenCalled());
    expect(await screen.findByText("候选已创建，工作配置与活跃版本未改动。")).toBeInTheDocument();
    await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(1));
  });


  it("keeps the workbench when activity loading fails and preserves PCW-D15 layout attribute", async () => {
    const listAuditEvents = vi.fn(async () => {
      throw new Error("audit unavailable");
    });

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/audit unavailable|活动|失败/i);
    expect(screen.getByRole("main", { name: "只读 DTS 源码" })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "配置检查器" })).toHaveAttribute("data-layout");
  });





  it("creates a Config set from the empty project path with name validation and duplicate handling", async () => {
    const created = {
      id: "cs-board-a",
      organizationId: "org-1",
      projectId: PROJECT.id,
      name: "board-a",
      createdAt: "2026-08-07T12:00:00.000Z",
      updatedAt: "2026-08-07T12:00:00.000Z"
    };
    let configSets: Array<typeof created> = [];
    const createConfigSet = vi.fn(async (_projectId: string, input: { name: string }) => {
      const next = { ...created, name: input.name };
      configSets = [next, ...configSets];
      return next;
    });
    const listConfigSets = vi.fn(async () => configSets);
    const { onNavigate } = renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSets,
        createConfigSet,
        listConfigSetFiles: vi.fn(async () => [])
      })
    });

    expect(await screen.findByText("项目还没有配置集")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开旧配置集管理" })).not.toBeInTheDocument();
    expect(screen.getByText(/上传不会自动激活/)).toBeInTheDocument();

    await openCreateConfigSetDialog();
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    expect(await screen.findByText(/请先填写配置集名称/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "board-a" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    await waitFor(() => expect(createConfigSet).toHaveBeenCalledWith(PROJECT.id, { name: "board-a" }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        expect.stringContaining("configSet=cs-board-a")
      )
    );

    await openCreateConfigSetDialog();
    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "Board-A" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    expect(await screen.findByText(/已存在名为「Board-A」的配置集/)).toBeInTheDocument();
  });

  it("adds and removes Config set members with role, sortOrder, and blast-radius confirmation", async () => {
    const members = [
      {
        configSetId: "cs-default",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        format: "dts" as const,
        role: "base" as const,
        sortOrder: 0,
        currentVersionId: "version-board-12",
        currentVersionNumber: 12
      }
    ];
    const addConfigSetFile = vi.fn(async (_projectId: string, configSetId: string, input: { fileId: string; role: string; sortOrder?: number }) => {
      const added = {
        configSetId,
        fileId: input.fileId,
        fileName: "notes.json",
        format: "json" as const,
        role: input.role as "misc",
        sortOrder: input.sortOrder ?? 1,
        currentVersionId: "version-loose-1",
        currentVersionNumber: 1
      };
      members.push(added);
      return added;
    });
    const removeConfigSetFile = vi.fn(async (_projectId: string, _configSetId: string, fileId: string) => {
      const index = members.findIndex((item) => item.fileId === fileId);
      if (index >= 0) members.splice(index, 1);
    });
    const listConfigSetFiles = vi.fn(async () => [...members]);

    renderWorkbench({
      syncSearch: true,
      dtsRepository: createDtsRepository({
        listConfigSetFiles,
        addConfigSetFile,
        removeConfigSetFile
      })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const ungrouped = screen.getByRole("group", { name: "未编组项目文件" });
    expect(ungrouped).toHaveTextContent("notes.json");
    expect(ungrouped).toHaveTextContent("不参与当前工作配置");

    fireEvent.click(screen.getByRole("button", { name: "编入 notes.json" }));
    await waitFor(() =>
      expect(addConfigSetFile).toHaveBeenCalledWith(PROJECT.id, "cs-default", {
        fileId: "file-loose",
        role: "misc",
        sortOrder: 1
      })
    );
    await waitFor(() => expect(screen.getByRole("treeitem", { name: /notes\.json/ })).toBeInTheDocument());

    cleanup();
    renderWorkbench({
      syncSearch: true,
      search: "?configSet=cs-default&inspector=config-set",
      dtsRepository: createDtsRepository({
        listConfigSetFiles,
        addConfigSetFile,
        removeConfigSetFile
      })
    });
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("成员管理");
    expect(within(inspector).getByRole("button", { name: "关闭检查器" })).toBeInTheDocument();

    fireEvent.click(within(inspector).getByRole("button", { name: "移除 aurora-board.dts" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("后续基线与导出将不再包含它");
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() =>
      expect(removeConfigSetFile).toHaveBeenCalledWith(PROJECT.id, "cs-default", "file-board")
    );
  });

  it("runs manual sync from the file inspector and surfaces evidence in the task dock", async () => {
    const syncFile = vi.fn(async () => ({
      draftsCreated: 2,
      unchanged: 1,
      unmatched: 0,
      skipped: false
    }));
    const listConflicts = vi.fn(async () => [
      {
        id: "conflict-1",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        parameterModule: "Board",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileVersionLabel: "v12",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);

    renderWorkbench({
      syncSearch: true,
      fileRepository: createFileRepository({ syncFile, listConflicts })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    const inspectorToggle = screen.getByRole("button", { name: "检查器" });
    if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(inspectorToggle);
    }
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    fireEvent.click(within(inspector).getByRole("button", { name: "手动同步" }));
    await waitFor(() => expect(syncFile).toHaveBeenCalledWith(PROJECT.id, "file-board"));
    await waitFor(() => expect(listConflicts).toHaveBeenCalledWith(PROJECT.id));

    const taskToggle = screen.getByRole("button", { name: "任务" });
    if (taskToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(taskToggle);
    }
    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(tasks).toHaveTextContent("aurora-board.dts");
    expect(tasks).toHaveTextContent("已创建 2 条草稿");
    expect(taskToggle).toHaveTextContent("冲突");
    expect(taskToggle).toHaveTextContent("1");
    expect(within(tasks).getByLabelText("冲突仲裁")).toBeInTheDocument();
    expect(within(tasks).getByRole("button", { name: "使用文件值" })).toBeInTheDocument();
    expect(within(tasks).getByRole("button", { name: "保留界面值" })).toBeInTheDocument();
    expect(within(tasks).getByText("基线值")).toBeInTheDocument();
    expect(tasks).not.toHaveTextContent("旧冲突视图");
  });

  it("exports the selected Config set from the command context", async () => {
    const exportConfigSet = vi.fn(async () => ({
      manifest: {
        configSetId: "cs-default",
        name: "default",
        projectId: PROJECT.id,
        exportedAt: "2026-08-07T12:00:00.000Z",
        validation: { ok: true, mode: "warn" as const, compiler: "dtc" as const, requiresConfirmation: false },
        members: [
          {
            fileId: "file-board",
            fileName: "aurora-board.dts",
            role: "base" as const,
            sortOrder: 0,
            versionNumber: 12,
            format: "dts" as const
          }
        ]
      },
      files: [{ name: "aurora-board.dts", format: "dts" as const, content: '/dts-v1/;\n/ { model = "Aurora"; };\n' }]
    }));
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    const blobSpy = vi.spyOn(globalThis, "Blob");
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: clickSpy });
      }
      return element;
    });

    renderWorkbench({
      dtsRepository: createDtsRepository({ exportConfigSet })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "导出配置集" }));
    await waitFor(() => expect(exportConfigSet).toHaveBeenCalledWith(PROJECT.id, "cs-default"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(blobSpy).toHaveBeenCalled();
    const blobParts = (blobSpy.mock.calls.at(-1)?.[0] ?? []) as BlobPart[];
    const downloaded = blobParts.map((part) => (typeof part === "string" ? part : String(part))).join("");
    expect(downloaded).toContain("wiseeff-config-set-export-manifest.json");
    expect(downloaded).toContain('"role": "base"');
    expect(downloaded).toContain('"sortOrder": 0');
    expect(downloaded).toContain('"validation"');
    expect(downloaded).toContain('"mode": "warn"');
    expect(downloaded).toContain("aurora-board.dts");
    expect(downloaded).toContain("wiseeff-config-set-export-files");
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("downloads the active member DTS from the more menu", async () => {
    const downloadVersion = vi.fn(async () => ({
      contentType: "text/plain",
      fileName: "aurora-board.dts",
      bytes: new TextEncoder().encode('/dts-v1/;\n/ { model = "Aurora"; };\n')
    }));
    const createObjectURL = vi.fn(() => "blob:dts");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "a") {
        Object.defineProperty(element, "click", { value: clickSpy });
      }
      return element;
    });

    renderWorkbench({
      fileRepository: createFileRepository({ downloadVersion })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    const downloadItem = screen.getByRole("menuitem", { name: "下载 DTS" });
    expect(downloadItem).toBeEnabled();
    fireEvent.click(downloadItem);
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith(PROJECT.id, "file-board", "version-board-12")
    );
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps download DTS available for non-admin viewers", async () => {
    renderWorkbench({ canAdmin: false });
    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "下载 DTS" })).toBeEnabled();
    expect(screen.queryByRole("menuitem", { name: "导出配置集" })).not.toBeInTheDocument();
  });

  it("disables download DTS when the Config set has no members", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles: vi.fn(async () => [])
      })
    });
    await screen.findByText("当前配置集没有成员文件");
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "下载 DTS" })).toBeDisabled();
  });

  it("keeps read context visible and denies mutations when canAdmin is false", async () => {
    renderWorkbench({ canAdmin: false });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "未编组项目文件" })).toHaveTextContent("notes.json");
    expect(screen.getByText(/仅管理员可变更配置集成员、同步或导出/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /\+ 新建配置集/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.queryByRole("menuitem", { name: "导出配置集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编入 notes.json" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "手动同步" })).not.toBeInTheDocument();
  });

  it("shows a focused upload and assignment path for an empty Config set", async () => {
    renderWorkbench({
      dtsRepository: createDtsRepository({
        listConfigSetFiles: vi.fn(async () => [])
      })
    });

    expect(await screen.findByText("当前配置集没有成员文件")).toBeInTheDocument();
    expect(screen.getByText(/上传候选不会自动激活工作配置/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "上传候选" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "上传候选" })[0]).toBeEnabled();
    expect(screen.getByRole("group", { name: "未编组项目文件" })).toHaveTextContent("编入");
  });



  it("loads open conflicts on mount so the task count stays current", async () => {
    const listConflicts = vi.fn(async () => [
      {
        id: "conflict-mount",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      fileRepository: createFileRepository({ listConflicts })
    });

    await waitFor(() => expect(listConflicts).toHaveBeenCalledWith(PROJECT.id));
    const taskToggle = await screen.findByRole("button", { name: "任务" });
    expect(taskToggle).toHaveTextContent("冲突");
    expect(taskToggle).toHaveTextContent("1");
  });

  it("opens the Conflicts task dock from a conflict activity event", async () => {
    const listConflicts = vi.fn(async () => [
      {
        id: "conflict-activity",
        organizationId: "org-1",
        projectId: PROJECT.id,
        projectParameterValueId: "ppv-1",
        parameterDefinitionId: "def-1",
        parameterName: "model",
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        baseValue: "Legacy",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z",
        fileId: "file-board",
        fileName: "aurora-board.dts",
        nodePath: "board",
        propertyName: "model"
      }
    ]);
    const listAuditEvents = vi.fn(async () => ({
      items: [
        {
          id: "evt-conflict",
          organizationId: "org-chargelab",
          projectId: PROJECT.id,
          actorUserId: "user-ada",
          actorType: "user" as const,
          actorName: "Ada Admin",
          app: "parameters",
          kind: "parameter-file-conflict-open",
          action: "resolve",
          severity: "High" as const,
          targetType: "parameter-file-conflict",
          targetId: "conflict-activity",
          metadata: { fileId: "file-board", fileName: "aurora-board.dts", parameterName: "model" },
          traceId: "trace-conflict",
          createdAt: "2026-08-07T04:03:00.000Z"
        }
      ],
      nextCursor: null
    }));

    renderWorkbench({
      search: "?configSet=cs-default&file=file-board",
      listAuditEvents,
      fileRepository: createFileRepository({ listConflicts })
    });

    await screen.findByRole("heading", { name: "aurora-board.dts" });
    fireEvent.click(screen.getByRole("button", { name: "更多" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "活动" }));
    await screen.findByLabelText("项目活动事件");
    fireEvent.click(screen.getByRole("button", { name: /裁决 · 文件冲突 · aurora-board\.dts/i }));

    const tasks = await screen.findByRole("region", { name: "配置任务" });
    expect(within(tasks).getByLabelText("冲突仲裁")).toBeInTheDocument();
    expect(screen.queryByText(/冲突裁决面板尚未接入/)).not.toBeInTheDocument();
  });

});
