import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DtsStructuredRepository } from "@/application/ports/DtsStructuredRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { ProjectConfigurationWorkbench } from "./ProjectConfigurationWorkbench";

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
    listCandidates: vi.fn(async () => []),
    createCandidate: vi.fn(),
    getCandidate: vi.fn(),
    getCandidateImpact: vi.fn(),
    downloadCandidate: vi.fn(),
    abandonCandidate: vi.fn(),
    recomputeCandidate: vi.fn(),
    ...overrides
  } as ParameterFileRepository;
}

function renderWorkbench(options: {
  search?: string;
  onNavigate?: ReturnType<typeof vi.fn>;
  dtsRepository?: DtsStructuredRepository;
  fileRepository?: ParameterFileRepository;
  syncSearch?: boolean;
  canAdmin?: boolean;
} = {}) {
  const onNavigate = options.onNavigate ?? vi.fn();
  const canAdmin = options.canAdmin;
  if (options.syncSearch) {
    function Harness() {
      const [search, setSearch] = useState(options.search ?? "");
      return (
        <ProjectConfigurationWorkbench
          project={PROJECT}
          search={search}
          onNavigate={(path) => {
            onNavigate(path);
            const queryIndex = path.indexOf("?");
            setSearch(queryIndex >= 0 ? path.slice(queryIndex) : "");
          }}
          dtsRepository={options.dtsRepository ?? createDtsRepository()}
          fileRepository={options.fileRepository ?? createFileRepository()}
          {...(canAdmin === undefined ? {} : { canAdmin })}
        />
      );
    }
    render(<Harness />);
    return { onNavigate };
  }
  render(
    <ProjectConfigurationWorkbench
      project={PROJECT}
      search={options.search ?? ""}
      onNavigate={onNavigate}
      dtsRepository={options.dtsRepository ?? createDtsRepository()}
      fileRepository={options.fileRepository ?? createFileRepository()}
      {...(canAdmin === undefined ? {} : { canAdmin })}
    />
  );
  return { onNavigate };
}

describe("ProjectConfigurationWorkbench", () => {
  it("selects the deterministic default Config set and renders working source identities", async () => {
    const { onNavigate } = renderWorkbench();

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "配置集" })).toHaveValue("cs-default");
    expect(screen.getByText("工作配置")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "创建基线" })).toBeDisabled();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("source unavailable");
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
    expect(screen.getByRole("region", { name: "配置任务" })).toHaveTextContent("任务证据");
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
    expect(await screen.findByRole("complementary", { name: "配置检查器" })).toBeInTheDocument();
    expect(await screen.findByText("属性名")).toBeInTheDocument();
    const inspector = screen.getByRole("complementary", { name: "配置检查器" });
    expect(inspector).toHaveTextContent("model");
    expect(inspector).toHaveTextContent("string-list");
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

    fireEvent.click(screen.getByRole("button", { name: "检查器返回" }));
    expect(await screen.findByText("成员数")).toBeInTheDocument();
    expect(inspector).toHaveTextContent("配置集");

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
    expect(screen.getByText("string-list")).toBeInTheDocument();
    expect(screen.getByText('"Aurora"')).toBeInTheDocument();
    expect(screen.getByText("Aurora")).toBeInTheDocument();
    expect(screen.getByText(/L2:3/)).toBeInTheDocument();

    const sourceHeading = screen.getByRole("heading", { name: "aurora-board.dts" });
    expect(sourceHeading).toBeInTheDocument();
    expect(onNavigate.mock.calls.at(-1)?.[0]).toContain("file=file-board");
  });

  it("walks inspector back from property to config set while preserving source selection", async () => {
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
    expect(await screen.findByText("属性名")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查器返回" }));
    await waitFor(() => expect(screen.getByText("节点路径")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查器返回" }));
    await waitFor(() => expect(screen.getByText("文件格式")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "检查器返回" }));
    await waitFor(() => expect(screen.getByText("成员数")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    const urls = onNavigate.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("file=file-board") && !url.includes("node="))).toBe(true);
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

    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写配置集名称");

    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "board-a" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    await waitFor(() => expect(createConfigSet).toHaveBeenCalledWith(PROJECT.id, { name: "board-a" }));
    await waitFor(() =>
      expect(onNavigate).toHaveBeenCalledWith(
        expect.stringContaining("configSet=cs-board-a")
      )
    );

    fireEvent.change(screen.getByLabelText("配置集名称"), { target: { value: "Board-A" } });
    fireEvent.click(screen.getByRole("button", { name: "创建配置集" }));
    expect(await screen.findByRole("alert")).toHaveTextContent('已存在名为「Board-A」的配置集');
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

    const inspectorToggle = screen.getByRole("button", { name: "检查器" });
    if (inspectorToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(inspectorToggle);
    }
    const inspector = await screen.findByRole("complementary", { name: "配置检查器" });
    if (within(inspector).queryByRole("button", { name: "检查器返回" })) {
      fireEvent.click(within(inspector).getByRole("button", { name: "检查器返回" }));
    }
    expect(inspector).toHaveTextContent("成员管理");

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
        fileVersionId: "version-board-12",
        fileDraftId: "fd-1",
        uiDraftId: "ud-1",
        fileValue: "Aurora",
        uiDraftValue: "Other",
        status: "open" as const,
        createdAt: "2026-08-07T12:00:00.000Z"
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
    expect(tasks).toHaveTextContent("冲突 1");
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
    fireEvent.click(screen.getByRole("button", { name: "导出配置集" }));
    await waitFor(() => expect(exportConfigSet).toHaveBeenCalledWith(PROJECT.id, "cs-default"));
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps read context visible and denies mutations when canAdmin is false", async () => {
    renderWorkbench({ canAdmin: false });

    expect(await screen.findByRole("heading", { name: "aurora-board.dts" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "未编组项目文件" })).toHaveTextContent("notes.json");
    expect(screen.getByText(/仅管理员可变更配置集成员、同步或导出/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "创建配置集" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出配置集" })).not.toBeInTheDocument();
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

});
