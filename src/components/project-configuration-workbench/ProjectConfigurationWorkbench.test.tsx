import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    listVersions: vi.fn(),
    syncFile: vi.fn(),
    listConflicts: vi.fn(async () => []),
    resolveConflict: vi.fn(),
    ...overrides
  } as ParameterFileRepository;
}

function renderWorkbench(options: {
  search?: string;
  dtsRepository?: DtsStructuredRepository;
  fileRepository?: ParameterFileRepository;
} = {}) {
  const onNavigate = vi.fn();
  render(
    <ProjectConfigurationWorkbench
      project={PROJECT}
      search={options.search ?? ""}
      onNavigate={onNavigate}
      dtsRepository={options.dtsRepository ?? createDtsRepository()}
      fileRepository={options.fileRepository ?? createFileRepository()}
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
    expect(screen.getByRole("button", { name: "上传候选" })).toBeDisabled();
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
    expect(screen.getByRole("region", { name: "配置任务" })).toHaveTextContent("本阶段为只读查看");
  });
});
