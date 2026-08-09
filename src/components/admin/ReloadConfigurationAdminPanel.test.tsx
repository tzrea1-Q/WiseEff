import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    deviceOverrides: [],
    ...overrides
  };
}

function createRepository(overrides: Partial<DtsReloadRepository> = {}): DtsReloadRepository {
  return {
    listCandidates: vi.fn(),
    startRun: vi.fn(),
    getRun: vi.fn(),
    downloadArtifact: vi.fn(),
    getReloadConfiguration: vi.fn(async () => seededView()),
    updateOrganisationReloadConfiguration: vi.fn(async (contract) => ({
      scope: "organisation" as const,
      source: "organisation" as const,
      ...contract,
      updatedAt: "2026-08-10T04:00:00.000Z",
      updatedByUserId: "user-1"
    })),
    upsertDeviceReloadConfiguration: vi.fn(async (deviceId, contract) => ({
      scope: "device" as const,
      deviceId,
      deviceName: "Aurora-A",
      ...contract,
      updatedAt: "2026-08-10T04:00:00.000Z",
      updatedByUserId: "user-1"
    })),
    deleteDeviceReloadConfiguration: vi.fn(async (deviceId) => ({ deviceId })),
    ...overrides
  };
}

describe("ReloadConfigurationAdminPanel", () => {
  it("shows a static unavailable state when no repository is injected", () => {
    render(
      <ReloadConfigurationAdminPanel
        repository={null}
        devices={[]}
        canEdit={false}
        unavailableReason="重载配置仅在 API 模式下可用。"
      />
    );
    expect(screen.getByText(/仅在 API 模式下可用/)).toBeInTheDocument();
  });

  it("loads organisation defaults through the injected repository and saves edits", async () => {
    const repository = createRepository();
    render(
      <ReloadConfigurationAdminPanel
        repository={repository}
        devices={[{ id: "device-1", name: "Aurora-A" }]}
        canEdit
      />
    );

    expect(await screen.findByDisplayValue("/vendor/firmware/")).toBeInTheDocument();
    expect(repository.getReloadConfiguration).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("组织内核日志命令"), { target: { value: "hilog" } });
    fireEvent.click(screen.getByRole("button", { name: "保存组织默认值" }));

    await waitFor(() =>
      expect(repository.updateOrganisationReloadConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ kernelLogCommand: "hilog" })
      )
    );
    expect(await screen.findByText("组织默认重载配置已保存")).toBeInTheDocument();
  });

  it("saves and deletes a per-device override through the injected repository", async () => {
    const repository = createRepository();
    render(
      <ReloadConfigurationAdminPanel
        repository={repository}
        devices={[{ id: "device-1", name: "Aurora-A" }]}
        canEdit
      />
    );

    await screen.findByDisplayValue("/vendor/firmware/");
    fireEvent.change(screen.getByLabelText("覆盖设备"), { target: { value: "device-1" } });
    fireEvent.change(screen.getByLabelText("设备 Overlay 目标目录"), {
      target: { value: "/data/vendor/firmware/" }
    });
    fireEvent.click(screen.getByRole("button", { name: "保存设备覆盖" }));

    await waitFor(() =>
      expect(repository.upsertDeviceReloadConfiguration).toHaveBeenCalledWith(
        "device-1",
        expect.objectContaining({ destinationDirectory: "/data/vendor/firmware/" })
      )
    );

    fireEvent.click(screen.getByRole("button", { name: "删除设备覆盖" }));
    await waitFor(() => expect(repository.deleteDeviceReloadConfiguration).toHaveBeenCalledWith("device-1"));
  });

  it("refuses load and save when the viewer lacks debugging:admin", () => {
    const repository = createRepository();
    render(
      <ReloadConfigurationAdminPanel
        repository={repository}
        devices={[{ id: "device-1", name: "Aurora-A" }]}
        canEdit={false}
      />
    );
    expect(screen.getByText(/缺少 debugging:admin 权限，无法读取或修改/)).toBeInTheDocument();
    expect(repository.getReloadConfiguration).not.toHaveBeenCalled();
  });
});
