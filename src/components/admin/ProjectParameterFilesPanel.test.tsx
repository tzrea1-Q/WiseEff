import { render, screen } from "@testing-library/react";
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
          fileName: "teaching-sample.dts",
          format: "dts",
          enabled: true,
          currentVersionNumber: 1,
          updatedAt: "2026-07-14T10:00:00.000Z"
        }
      ])
    });

    render(<ProjectParameterFilesPanel projectId="atlas" repository={repository} />);

    expect(await screen.findByText("teaching-sample.dts")).toBeInTheDocument();
    expect(screen.getByText("上传参数文件")).toBeInTheDocument();
    expect(createParameterFileClient).not.toHaveBeenCalled();
    expect(repository.listFiles).toHaveBeenCalledWith("atlas");
  });
});
