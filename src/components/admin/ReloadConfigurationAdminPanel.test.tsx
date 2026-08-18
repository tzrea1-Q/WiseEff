import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DtsReloadRepository } from "@/application/ports/DtsReloadRepository";
import type { ReloadConfigurationAdminView } from "@/domain/dtsReload/types";
import { ReloadConfigurationAdminPanel } from "./ReloadConfigurationAdminPanel";

afterEach(() => {
  cleanup();
});

function seededView(overrides: Partial<ReloadConfigurationAdminView> = {}): ReloadConfigurationAdminView {
  return {
    organisation: {
      scope: "organisation",
      source: "seeded-default",
      destinationDirectory: "/vendor/firmware/",
      destinationFilename: "power_dts_overlay.dtbo",
      triggerNodePath: "/sys/kernel/debug/power_debug/dts_overlay/trigger",
      triggerPayload: "1",
      kernelLogCommand: "dmesg",
      updatedAt: null,
      updatedByUserId: null
    },
    ...overrides
  };
}

function createRepository(overrides: Partial<DtsReloadRepository> = {}): DtsReloadRepository {
  return {
    listCandidates: vi.fn(),
    listRuns: vi.fn(async () => ({ items: [], nextCursor: null })),
    startRun: vi.fn(),
    restoreBaseline: vi.fn(),
    getResidue: vi.fn(async () => null),
    deployRun: vi.fn(),
    getRun: vi.fn(),
    downloadArtifact: vi.fn(),
    promoteToDrafts: vi.fn(),
    getReloadConfiguration: vi.fn(async () => seededView()),
    updateOrganisationReloadConfiguration: vi.fn(async (contract) => ({
      scope: "organisation" as const,
      source: "organisation" as const,
      ...contract,
      updatedAt: "2026-08-10T04:00:00.000Z",
      updatedByUserId: "user-1"
    })),
    ...overrides
  };
}

async function selectKernelLogCommand(command: string) {
  fireEvent.click(screen.getByLabelText("组织内核日志命令"));
  const listbox = await screen.findByRole("listbox");
  fireEvent.click(within(listbox).getByRole("option", { name: command }));
}

describe("ReloadConfigurationAdminPanel", () => {
  it("shows a static unavailable state when no repository is injected", () => {
    render(
      <ReloadConfigurationAdminPanel
        repository={null}
        canEdit={false}
        unavailableReason="重载配置仅在 API 模式下可用。"
      />
    );
    expect(screen.getByText(/仅在 API 模式下可用/)).toBeInTheDocument();
  });

  it("loads organisation defaults through the injected repository and saves edits", async () => {
    const repository = createRepository();
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);

    expect(await screen.findByDisplayValue("/vendor/firmware/")).toBeInTheDocument();
    expect(repository.getReloadConfiguration).toHaveBeenCalled();
    expect(screen.getByText("种子默认")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "保存组织默认值" });
    expect(saveButton).toBeDisabled();

    await selectKernelLogCommand("hilog");
    expect(await screen.findByText("有未保存的更改")).toBeInTheDocument();
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(repository.updateOrganisationReloadConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ kernelLogCommand: "hilog" })
      )
    );
    expect(await screen.findByText("组织默认重载配置已保存")).toBeInTheDocument();
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("warns about streaming kernel log commands and stays quiet for buffer dumps", async () => {
    const repository = createRepository();
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);

    await screen.findByDisplayValue("/vendor/firmware/");
    expect(screen.queryByText(/该命令为持续输出/)).not.toBeInTheDocument();

    await selectKernelLogCommand("hilog");
    expect(await screen.findByText(/该命令为持续输出/)).toBeInTheDocument();

    await selectKernelLogCommand("hilog -x");
    await waitFor(() => expect(screen.queryByText(/该命令为持续输出/)).not.toBeInTheDocument());
  });

  it("refuses load and save when the viewer lacks debugging:admin", () => {
    const repository = createRepository();
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit={false} />);
    expect(screen.getByText(/缺少 debugging:admin 权限，无法读取或修改/)).toBeInTheDocument();
    expect(repository.getReloadConfiguration).not.toHaveBeenCalled();
  });
});
