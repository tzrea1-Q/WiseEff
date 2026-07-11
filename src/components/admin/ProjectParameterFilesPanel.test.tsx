import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectParameterFilesPanel } from "./ProjectParameterFilesPanel";

const listFilesMock = vi.fn();

vi.mock("@/infrastructure/http/parameterFileClient", () => ({
  createParameterFileClient: () => ({
    listFiles: listFilesMock,
    uploadFile: vi.fn(),
    uploadVersion: vi.fn(),
    listVersions: vi.fn(),
    downloadVersion: vi.fn(),
    syncFile: vi.fn(),
    listConflicts: vi.fn(),
    resolveConflict: vi.fn()
  })
}));

describe("ProjectParameterFilesPanel", () => {
  it("renders file list with mocked client", async () => {
    listFilesMock.mockResolvedValueOnce([
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
    ]);

    render(<ProjectParameterFilesPanel projectId="atlas" runtimeMode="api" />);

    expect(await screen.findByText("engine.dts")).toBeInTheDocument();
    expect(screen.getByText("格式：DTS")).toBeInTheDocument();
    expect(screen.getByText("当前版本：3")).toBeInTheDocument();
  });

  it("shows upload button in api mode", () => {
    listFilesMock.mockResolvedValueOnce([]);

    render(<ProjectParameterFilesPanel projectId="atlas" runtimeMode="api" />);

    expect(screen.getByText("上传参数文件")).toBeInTheDocument();
  });
});
