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
  it("does not report a load failure as a failed save", async () => {
    const repository = createRepository({ getReloadConfiguration: vi.fn().mockRejectedValue(new Error("无法读取配置")) });
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取配置");
    expect(screen.queryByText("保存失败")).not.toBeInTheDocument();
    expect(screen.queryByText("系统默认")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "组织 Overlay 目标目录" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    vi.mocked(repository.getReloadConfiguration).mockResolvedValueOnce(seededView());
    fireEvent.click(screen.getByRole("button", { name: "重新加载配置" }));
    expect(await screen.findByDisplayValue("/vendor/firmware/")).toBeEnabled();
    expect(repository.updateOrganisationReloadConfiguration).not.toHaveBeenCalled();
  });

  it("shows grouped configuration, execution preview and modification evidence with accessible hints", async () => {
    const view = seededView();
    view.organisation = { ...view.organisation, source: "organisation", updatedAt: "2026-08-10T04:00:00.123456Z", updatedByUserId: "user-1" };
    const onNavigate = vi.fn();
    const repository = createRepository({ getReloadConfiguration: vi.fn(async () => view) });
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit canViewAudit onNavigate={onNavigate} users={[{ id: "user-1", name: "Riley Chen" }]} />);
    const directory = await screen.findByDisplayValue("/vendor/firmware/");
    expect(directory).toHaveAccessibleDescription(expect.stringContaining("末尾 / 可省略"));
    for (const name of ["产物位置", "触发重载", "日志采集"]) expect(screen.getByRole("group", { name })).toBeInTheDocument();
    expect(screen.getByLabelText("内核日志命令")).toBe(screen.getByLabelText("组织内核日志命令"));
    expect(screen.getByText(/修改人：Riley Chen/)).toHaveAttribute("title", "账户 user-1");
    const preview = screen.getByRole("region", { name: "最终配置摘要" });
    expect(screen.getByRole("complementary", { name: "配置预览与记录" })).toContainElement(preview);
    expect(screen.getByRole("form", { name: "DTS 重载设置" })).not.toContainElement(preview);
    fireEvent.change(directory, { target: { value: "/oem/firmware" } });
    expect(within(preview).getByText("未保存")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "最终配置摘要" })).getByText("/oem/firmware/power_dts_overlay.dtbo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(repository.updateOrganisationReloadConfiguration).toHaveBeenCalledWith(expect.objectContaining({ destinationDirectory: "/oem/firmware" }), "2026-08-10T04:00:00.123456Z"));
    await waitFor(() => expect(within(preview).queryByText("未保存")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "查看配置变更记录" }));
    expect(onNavigate).toHaveBeenCalledWith("/audit?app=debugging&kind=dts-reload-configuration-update");
  });

  it("preserves stale drafts, blocks another save, and explicitly confirms replacing them with the latest configuration", async () => {
    const error = Object.assign(new Error("配置已被更新"), { code: "CONFLICT" });
    const repository = createRepository({ updateOrganisationReloadConfiguration: vi.fn().mockRejectedValue(error) });
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);
    const directory = await screen.findByDisplayValue("/vendor/firmware/");
    fireEvent.change(directory, { target: { value: "/my-draft/" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeDisabled());
    expect(directory).toHaveValue("/my-draft/");
    fireEvent.click(screen.getByRole("button", { name: "重新加载配置" }));
    fireEvent.click(screen.getByRole("button", { name: "保留当前修改" }));
    expect(directory).toHaveValue("/my-draft/");
    fireEvent.click(screen.getByRole("button", { name: "重新加载配置" }));
    fireEvent.click(screen.getByRole("button", { name: "放弃并重新加载" }));
    expect(await screen.findByDisplayValue("/vendor/firmware/")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
    expect(repository.updateOrganisationReloadConfiguration).toHaveBeenCalledTimes(1);
  });

  it("discards edits without writes and validates inline before saving", async () => {
    const repository = createRepository();
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);
    const directory = await screen.findByDisplayValue("/vendor/firmware/");
    fireEvent.change(directory, { target: { value: "relative/path" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(directory).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
    expect(repository.updateOrganisationReloadConfiguration).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "放弃" }));
    expect(directory).toHaveValue("/vendor/firmware/");
    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();
  });

  it("keeps drafts available to retry after a failed save", async () => {
    const repository = createRepository({ updateOrganisationReloadConfiguration: vi.fn().mockRejectedValue(new Error("网络中断")) });
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);
    const directory = await screen.findByDisplayValue("/vendor/firmware/");
    fireEvent.change(directory, { target: { value: "/oem/firmware/" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("网络中断");
    expect(directory).toHaveValue("/oem/firmware/");
    expect(screen.getByRole("button", { name: "放弃" })).toBeEnabled();
  });

  it.each([
    ["组织 Overlay 目标文件名", "../escape.dtbo", "请输入单个文件名"],
    ["组织触发节点路径", "/sys/../trigger", "请输入不含 . 或 .. 路径段的绝对路径"],
    ["组织触发写入值", " ", "触发写入值不能为空"],
    ["组织触发写入值", "1".repeat(257), "不能超过 256 个字符"]
  ])("associates inline validation with %s and prevents invalid server writes", async (label, value, message) => {
    const repository = createRepository();
    render(<ReloadConfigurationAdminPanel repository={repository} canEdit />);
    await screen.findByDisplayValue("/vendor/firmware/");
    const field = screen.getByRole("textbox", { name: label });
    fireEvent.change(field, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(screen.getByRole("alert", { name: "保存错误摘要" })).toHaveTextContent("请修正标记的字段后重试。");
    expect(repository.updateOrganisationReloadConfiguration).not.toHaveBeenCalled();
  });

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
    expect(screen.getByText("系统默认")).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "保存" })).not.toBeInTheDocument();

    await selectKernelLogCommand("hilog");
    const saveButton = screen.getByRole("button", { name: "保存" });
    expect(await screen.findByText("有未保存的更改")).toBeInTheDocument();
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(repository.updateOrganisationReloadConfiguration).toHaveBeenCalledWith(
        expect.objectContaining({ kernelLogCommand: "hilog" }), null
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
