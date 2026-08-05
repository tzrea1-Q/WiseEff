import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import { ProjectParameterFilesPanel } from "./ProjectParameterFilesPanel";

const createParameterFileClient = vi.fn();

vi.mock("@/infrastructure/http/parameterFileClient", () => ({
  createParameterFileClient: (...args: unknown[]) => createParameterFileClient(...args)
}));

function createStubRepository(overrides: Partial<ParameterFileRepository> = {}): ParameterFileRepository {
  return {
    listFiles: vi.fn().mockResolvedValue([]),
    uploadFile: vi.fn(),
    uploadVersion: vi.fn(),
    listVersions: vi.fn().mockResolvedValue([]),
    downloadVersion: vi.fn(),
    syncFile: vi.fn(),
    listConflicts: vi.fn().mockResolvedValue([]),
    resolveConflict: vi.fn(),
    ...overrides
  };
}

describe("ProjectParameterFilesPanel", () => {
  it("renders file list from the injected repository", async () => {
    const repository = createStubRepository({
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-1",
          projectId: "atlas",
          fileName: "engine.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "v1",
          currentVersionNumber: 3,
          updatedAt: "2026-07-11T10:00:00.000Z"
        }
      ])
    });

    render(<ProjectParameterFilesPanel projectId="atlas" repository={repository} />);

    expect(await screen.findByText("engine.dts")).toBeInTheDocument();
    expect(screen.getByText("格式：DTS")).toBeInTheDocument();
    expect(screen.getByText("当前版本：3")).toBeInTheDocument();
    expect(createParameterFileClient).not.toHaveBeenCalled();
  });

  it("loads files via mock repository without calling the HTTP client", async () => {
    const repository = createStubRepository({
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-mock",
          projectId: "atlas",
          fileName: "atlas-board.dts",
          format: "dts",
          enabled: true,
          currentVersionNumber: 1,
          updatedAt: "2026-07-14T10:00:00.000Z"
        }
      ])
    });

    render(<ProjectParameterFilesPanel projectId="atlas" repository={repository} />);

    expect(await screen.findByText("atlas-board.dts")).toBeInTheDocument();
    expect(screen.getByText("上传参数文件")).toBeInTheDocument();
    expect(createParameterFileClient).not.toHaveBeenCalled();
    expect(repository.listFiles).toHaveBeenCalledWith("atlas");
  });

  it("gives each version a time, an operator, and its own download", async () => {
    const downloadVersion = vi.fn().mockResolvedValue({
      contentType: "text/plain",
      fileName: "engine.dts",
      bytes: new Uint8Array([1, 2, 3])
    });
    const repository = createStubRepository({
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-1",
          projectId: "atlas",
          fileName: "engine.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "ver-2",
          currentVersionNumber: 2,
          updatedAt: "2026-07-11T10:00:00.000Z"
        }
      ]),
      listVersions: vi.fn().mockResolvedValue([
        {
          id: "ver-2",
          fileId: "file-1",
          versionNumber: 2,
          checksum: "sha-2",
          sizeBytes: 2048,
          parsedIndex: {},
          origin: "writeback",
          createdAt: "2026-07-11T10:00:00.000Z",
          createdByUserId: "user-hw"
        },
        {
          id: "ver-1",
          fileId: "file-1",
          versionNumber: 1,
          checksum: "sha-1",
          sizeBytes: 64,
          parsedIndex: {},
          origin: "upload",
          createdAt: "2026-07-10T09:30:00.000Z"
        }
      ]),
      downloadVersion
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:version");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    render(<ProjectParameterFilesPanel projectId="atlas" repository={repository} />);

    fireEvent.click(await screen.findByRole("button", { name: "查看版本" }));
    const versions = await screen.findByRole("list", { name: "engine.dts 版本列表" });

    expect(within(versions).getByText("参数回写")).toBeInTheDocument();
    expect(within(versions).getByText("手动上传")).toBeInTheDocument();
    expect(within(versions).getByText("当前版本")).toBeInTheDocument();
    expect(within(versions).getByText("操作人：user-hw")).toBeInTheDocument();
    expect(within(versions).getByText("操作人：未记录")).toBeInTheDocument();
    expect(within(versions).getByText("2.0 KB")).toBeInTheDocument();
    expect(within(versions).getByText("64 B")).toBeInTheDocument();
    // Raw byte counts and untranslated origins were the whole of this list before.
    expect(within(versions).queryByText(/bytes/)).not.toBeInTheDocument();

    fireEvent.click(
      within(versions).getByRole("button", { name: "下载 engine.dts 版本 1" })
    );
    await waitFor(() =>
      expect(downloadVersion).toHaveBeenCalledWith("atlas", "file-1", "ver-1")
    );
  });
});
