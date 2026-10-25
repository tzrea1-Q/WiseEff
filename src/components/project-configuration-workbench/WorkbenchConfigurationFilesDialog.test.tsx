import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchConfigurationFilesDialog, type WorkbenchConfigurationFilesDialogProps } from "./WorkbenchConfigurationFilesDialog";
import { WorkbenchSetRootDialog } from "./WorkbenchSetRootDialog";
import { createCanonicalMemberAdditionClient } from "@/infrastructure/http/canonicalMemberAdditionClient";
import { createApiClient } from "@/infrastructure/http/apiClient";

afterEach(cleanup);

function props(overrides: Partial<WorkbenchConfigurationFilesDialogProps> = {}): WorkbenchConfigurationFilesDialogProps {
  return {
    open: true, onClose: vi.fn(),
    configSet: { id: "set", name: "default", description: "Auto-seeded default config set", organizationId: "org", projectId: "project", createdAt: "", updatedAt: "" },
    members: [
      { configSetId: "set", fileId: "dts", fileName: "主板.dts", format: "dts", role: "base", sortOrder: 0, currentVersionNumber: 3 },
      { configSetId: "set", fileId: "json", fileName: "charging.json", format: "json", role: "charging", sortOrder: 2 }
    ],
    canAdmin: true, pendingAction: null, loading: false, error: "", ready: true, canonical: false, onRetry: vi.fn(),
    availableFiles: [{ id: "available", projectId: "project", fileName: "thermal.json", format: "json", enabled: true, updatedAt: "" }],
    addErrors: {}, memberFileId: "available", memberRole: "thermal", memberSortOrder: 4,
    onMemberFileIdChange: vi.fn(), onMemberRoleChange: vi.fn(), onMemberSortOrderChange: vi.fn(), onAddMember: vi.fn(),
    onRemoveMember: vi.fn(), canRequestReviewedMemberRemoval: true, onOpenFile: vi.fn(), onUpdateFile: vi.fn(),
    onOpenVersions: vi.fn(), onAddSourceFile: vi.fn(), ...overrides
  };
}

describe("WorkbenchConfigurationFilesDialog", () => {
  it("creates shared resources from checked private DTS sources and keeps JSON and fixed shared members out", async () => {
    const user = userEvent.setup(), onCreateShared = vi.fn(), values = props();
    values.members.push({ ...values.members[0]!, fileId:"include",fileName:"parts/power.dtsi",role:"misc" });
    const view = render(<WorkbenchConfigurationFilesDialog {...values} onCreateShared={onCreateShared} />);
    await user.click(screen.getByRole("button", {name:"parts/power.dtsi 更多"}));
    await user.click(screen.getByRole("menuitem", {name:"创建共享资源"}));
    expect(onCreateShared).toHaveBeenCalledWith(values.members[2]);
    await user.click(screen.getByRole("button", {name:"charging.json 更多"}));
    expect(screen.queryByRole("menuitem", {name:"创建共享资源"})).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} onCreateShared={onCreateShared} canAdmin={false} />);
    await user.click(screen.getByRole("button", {name:"主板.dts 更多"}));
    expect(screen.queryByRole("menuitem", {name:"创建共享资源"})).not.toBeInTheDocument();
  });
  it("identifies fixed shared source and offers viewing without project file mutation controls", () => {
    const values = props({ canonical: true });
    values.members = [{ ...values.members[0]!, fileName: "shared.dtsi", sharedReference: {
      referenceId: "ref", resourceId: "resource", versionId: "revision", version: 2, memberId: "member", digest: "sha256:fixed", readOnly: true
    } }];
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("dialog", { name: "配置组成" })).toBeInTheDocument();
    expect(screen.getByText("共享引用 · 版本 2 · 只读")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新文件" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看源码" })).toBeInTheDocument();
  });
  it("offers set-root only for a checked non-root DTS member", async () => {
    const user = userEvent.setup(), onSetRoot = vi.fn();
    const values = props({ canonical: true, onSetRoot });
    values.members.push({ configSetId: "set", fileId: "next", fileName: "next.dts", format: "dts", role: "misc", sortOrder: 3 });
    const view = render(<WorkbenchConfigurationFilesDialog {...values} />);
    for (const name of ["主板.dts", "charging.json"]) {
      await user.click(screen.getByRole("button", { name: `${name} 更多` }));
      expect(screen.queryByRole("menuitem", { name: "设为根文件" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
    }
    await user.click(screen.getByRole("button", { name: "next.dts 更多" }));
    await user.click(screen.getByRole("menuitem", { name: "设为根文件" }));
    expect(onSetRoot).toHaveBeenCalledWith(values.members[2]);
    for (const gate of [{ canAdmin: false }, { ready: false }, { loading: true }, { error: "读取失败" }]) {
      view.rerender(<WorkbenchConfigurationFilesDialog {...values} {...gate} />);
      await user.click(screen.getByRole("button", { name: "next.dts 更多" }));
      expect(screen.queryByRole("menuitem", { name: "设为根文件" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
    }
  });

  it("retries root-swap diagnostics and confirms the exact impact with the keyboard", async () => {
    const user = userEvent.setup(), onApplied = vi.fn(), requests: Array<Record<string, unknown>> = [];
    let fail = true;
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      if (fail) {
        fail = false;
        return new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "配置引用无法解析，当前配置已保留。",
          details: { diagnostics: [{ message: "next.dts：找不到引用的节点。" }] } } }), { status: 400 });
      }
      return new Response(JSON.stringify({ item: String(input).endsWith("/apply") ? {
        requestId: "request", fileId: "next", fileVersionId: "version", configRevisionId: "revision"
      } : { proofToken: "a".repeat(64), configSetId: "set", fileName: "next.dts", format: "dts", members: [],
        entryFile: "next.dts", includeSearchPaths: ["."], overlayOrder: ["board.dts"], diagnostics: [],
        impact: { parameterChanges: 1, nodeAdditions: 2, nodeRemovals: 3, retainedBindings: 4, sourceReplacements: 1 } } }), { status: 200 });
    };
    render(<WorkbenchSetRootDialog projectId="project" configSetId="set" fileId="next" fileName="next.dts"
      client={createCanonicalMemberAdditionClient(createApiClient({ baseUrl: "", fetchImpl }))} onDismiss={vi.fn()} onApplied={onApplied} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("当前配置已保留");
    expect(screen.getByLabelText("来源校验诊断")).toHaveTextContent("找不到引用的节点");
    expect(screen.getByRole("button", { name: "确认设为根文件" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新预览" }));
    expect(await screen.findByText("参数变化：1；新增节点：2；移除节点：3。")).toBeInTheDocument();
    expect(screen.getByText("确认后由当前管理员直接提交，并记录实际操作人。")).toBeInTheDocument();
    await user.type(screen.getByLabelText("切换原因"), "更换根文件");
    screen.getByRole("button", { name: "确认设为根文件" }).focus();
    await user.keyboard("{Enter}");
    expect(onApplied).toHaveBeenCalledOnce();
    expect(requests.at(-1)).toMatchObject({ fileId: "next", role: "base", setAsRoot: true, proofToken: "a".repeat(64), reason: "更换根文件" });
  });
  it("opens the Canonical composition preview only for an administrator after source checks", async () => {
    const user = userEvent.setup(), onCanonicalAdd = vi.fn();
    const values = props({ canonical: true, onCanonicalAdd });
    const view = render(<WorkbenchConfigurationFilesDialog {...values} />);
    await user.click(screen.getByRole("button", { name: "添加配置文件" }));
    expect(onCanonicalAdd).toHaveBeenCalledOnce();
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} canAdmin={false} />);
    expect(screen.queryByRole("button", { name: "添加配置文件" })).not.toBeInTheDocument();
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} ready={false} />);
    expect(screen.queryByRole("button", { name: "添加配置文件" })).not.toBeInTheDocument();
  });
  it("shows configuration file metadata without default seed descriptions or single-file order noise", () => {
    const values = props();
    const view = render(<WorkbenchConfigurationFilesDialog {...values} />);
    const dialog = screen.getByRole("dialog", { name: "配置组成" });
    expect(dialog).toHaveAccessibleDescription("默认配置 · 2 个文件");
    expect(screen.getByRole("button", { name: "关闭配置组成" })).toHaveFocus();
    expect(dialog).not.toHaveTextContent("Auto-seeded");
    const table = screen.getByRole("table", { name: "配置文件" });
    expect(within(table).getByRole("columnheader", { name: "顺序" })).toBeInTheDocument();
    expect(table).toHaveTextContent("DTS");
    expect(table).toHaveTextContent("版本 3");
    expect(table).toHaveTextContent("暂无版本");
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} members={[values.members[0]!]} />);
    expect(screen.queryByRole("columnheader", { name: "顺序" })).not.toBeInTheDocument();
  });

  it("opens the exact file, source update and version history from its row", async () => {
    const user = userEvent.setup();
    const values = props();
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    const row = screen.getByRole("button", { name: "charging.json" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "charging.json" }));
    expect(values.onOpenFile).toHaveBeenCalledWith("json");
    await user.click(within(row).getByRole("button", { name: "更新文件" }));
    expect(values.onUpdateFile).toHaveBeenCalledWith("json");
    await user.click(within(row).getByRole("button", { name: "charging.json 更多" }));
    await user.click(screen.getByRole("menuitem", { name: "版本历史与下载" }));
    expect(values.onOpenVersions).toHaveBeenCalledWith("json");
    await user.click(within(row).getByRole("button", { name: "charging.json 更多" }));
    await user.click(screen.getByRole("menuitem", { name: "从配置移除" }));
    expect(values.onRemoveMember).toHaveBeenCalledWith(values.members[1]);
  });

  it("offers administrator impact preview for both Canonical DTS and JSON members", async () => {
    const user = userEvent.setup();
    const values = props({ canonical: true });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("添加或移除文件均需预览并确认");
    expect(screen.queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "主板.dts 更多" }));
    await user.click(screen.getByRole("menuitem", { name: "预览移除影响" }));
    expect(values.onRemoveMember).toHaveBeenCalledWith(values.members[0]);
    await user.click(screen.getByRole("button", { name: "charging.json 更多" }));
    await user.click(screen.getByRole("menuitem", { name: "预览移除影响" }));
    expect(values.onRemoveMember).toHaveBeenCalledWith(values.members[1]);
  });

  it("retains the optional existing JSON review action alongside direct impact preview", async () => {
    const user = userEvent.setup();
    const reviewed = vi.fn();
    const values = props({ canonical: true, onReviewedMemberRemoval: reviewed });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    await user.click(screen.getByRole("button", { name: "charging.json 更多" }));
    expect(screen.getByRole("menuitem", { name: "预览移除影响" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "申请从配置移除" }));
    expect(reviewed).toHaveBeenCalledWith(values.members[1]);
  });

  it.each([
    { ready: false }, { loading: true }, { error: "来源读取失败" }, { canRequestReviewedMemberRemoval: false }
  ])("keeps reviewed removal unavailable until every source gate passes: %j", async (gate) => {
    const user = userEvent.setup();
    render(<WorkbenchConfigurationFilesDialog {...props({ canonical: true, ...gate })} />);
    await user.click(screen.getByRole("button", { name: "charging.json 更多" }));
    expect(screen.queryByRole("menuitem", { name: /移除/ })).not.toBeInTheDocument();
    expect(screen.queryByText("移除仅解除配置关联，不会删除项目文件。")).not.toBeInTheDocument();
  });

  it("keeps read-only browsing and history without any mutation actions", async () => {
    const user = userEvent.setup();
    const values = props({ canAdmin: false });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("默认配置 · 2 个文件 · 只读");
    expect(screen.queryByRole("button", { name: "更新文件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "主板.dts" }));
    expect(values.onOpenFile).toHaveBeenCalledWith("dts");
    await user.click(within(screen.getByRole("button", { name: "主板.dts" }).closest("tr")!).getByRole("button", { name: "更新记录" }));
    expect(values.onUpdateFile).toHaveBeenCalledWith("dts");
    await user.click(screen.getByRole("button", { name: "主板.dts 更多" }));
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "版本历史与下载" }));
    expect(values.onOpenVersions).toHaveBeenCalledWith("dts");
  });

  it("edits the controlled add form and submits only an available, unblocked file", async () => {
    const user = userEvent.setup();
    const values = props({ memberFileId: "" });
    const view = render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("button", { name: "添加文件" })).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "待加入文件" }));
    await user.click(screen.getByRole("option", { name: "thermal.json" }));
    expect(values.onMemberFileIdChange).toHaveBeenCalledWith("available");
    await user.click(screen.getByRole("combobox", { name: "文件用途" }));
    await user.click(screen.getByRole("option", { name: "覆盖层" }));
    expect(values.onMemberRoleChange).toHaveBeenCalledWith("overlay");
    fireEvent.change(screen.getByRole("spinbutton", { name: "文件顺序" }), { target: { value: "8" } });
    expect(values.onMemberSortOrderChange).toHaveBeenCalledWith(8);
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} memberFileId="available" />);
    await user.click(screen.getByRole("button", { name: "添加文件" }));
    expect(values.onAddMember).toHaveBeenCalledOnce();
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} memberFileId="available" addErrors={{ available: "该文件已归属其他配置" }} />);
    expect(screen.getByRole("combobox", { name: "待加入文件" })).toHaveAccessibleDescription("该文件已归属其他配置");
    expect(screen.getByRole("button", { name: "添加文件" })).toBeDisabled();
    view.rerender(<WorkbenchConfigurationFilesDialog {...values} memberFileId="not-available" />);
    expect(screen.getByRole("button", { name: "添加文件" })).toBeDisabled();
  });

  it.each(["add-member", "remove-member", "remove-member-json"])("blocks close and repeated actions only during its own mutation: %s", async (pendingAction) => {
    const user = userEvent.setup();
    const values = props({ pendingAction });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("button", { name: "关闭配置组成" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "更新文件" }).every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("button", { name: pendingAction === "add-member" ? "添加中…" : "添加文件" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(values.onClose).not.toHaveBeenCalled();
  });

  it("does not lock its controls or Escape dismissal for unrelated background actions", async () => {
    const user = userEvent.setup();
    const values = props({ pendingAction: "export-set" });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("button", { name: "关闭配置组成" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "添加文件" }));
    expect(values.onAddMember).toHaveBeenCalledOnce();
    await user.keyboard("{Escape}");
    expect(values.onClose).toHaveBeenCalledOnce();
  });

  it("offers a real retry on source errors and hides unsafe mutation actions", async () => {
    const user = userEvent.setup();
    const values = props({ error: "来源读取失败", ready: false, members: [] });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("alert")).toHaveTextContent("来源读取失败");
    expect(screen.queryByRole("button", { name: "添加文件" })).not.toBeInTheDocument();
    expect(screen.queryByText("此配置暂无文件。")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新核对" }));
    expect(values.onRetry).toHaveBeenCalledOnce();
  });

  it("shows failed management operations inside the dialog while retaining the selected file and retry action", async () => {
    const user = userEvent.setup();
    const values = props({ operationError: "添加文件失败，请重试。" });
    render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("添加文件失败，请重试。");
    expect(screen.getByRole("combobox", { name: "待加入文件" })).toHaveAttribute("data-value", "available");
    expect(screen.getByRole("spinbutton", { name: "文件顺序" })).toHaveValue(4);
    await user.click(screen.getByRole("button", { name: "添加文件" }));
    expect(values.onAddMember).toHaveBeenCalledOnce();
    expect(values.onRetry).not.toHaveBeenCalled();
  });

  it("offers source upload only for an empty, ready legacy configuration", async () => {
    const user = userEvent.setup();
    const values = props({ members: [], availableFiles: [] });
    const view = render(<WorkbenchConfigurationFilesDialog {...values} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("此配置暂无文件。");
    await user.click(screen.getByRole("button", { name: "上传来源文件" }));
    expect(values.onAddSourceFile).toHaveBeenCalledOnce();
    for (const blocked of [{ canonical: true }, { ready: false }, { canAdmin: false }, { loading: true }]) {
      view.rerender(<WorkbenchConfigurationFilesDialog {...values} {...blocked} />);
      expect(screen.queryByRole("button", { name: "上传来源文件" })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("status")).toHaveTextContent("正在核对配置文件");
  });
});
