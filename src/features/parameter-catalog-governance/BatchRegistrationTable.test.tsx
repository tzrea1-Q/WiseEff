import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { selectControlOption } from "@/test/selectControlOption";
import { BatchRegistrationTable } from "./BatchRegistrationTable";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";

it.each([
  ["关闭按钮", "selection"],
  ["Escape", "category"],
  ["遮罩", "name"],
] as const)("guards %s after a %s edit and preserves the draft when continuing", async (method, edit) => {
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1",
    items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }], modules: [] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  if (edit === "selection") await user.click(screen.getByRole("checkbox", { name: "选择 vendor,a" }));
  if (edit === "category") await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  if (edit === "name") await user.type(screen.getByRole("textbox", { name: "vendor,a 的模块名称" }), "-编辑");
  const dismiss = async () => {
    if (method === "关闭按钮") await user.click(screen.getByRole("button", { name: "关闭" }));
    else if (method === "Escape") await user.keyboard("{Escape}");
    else {
      const backdrop = screen.getByRole("dialog", { name: "待登记主体" }).parentElement!;
      fireEvent.pointerDown(backdrop);
      fireEvent.pointerUp(backdrop);
    }
  };
  await dismiss();
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  if (edit === "selection") expect(screen.getByRole("checkbox", { name: "选择 vendor,a" })).not.toBeChecked();
  if (edit === "category") expect(screen.getByRole("combobox", { name: "vendor,a 的业务分类" })).toHaveAttribute("data-value", "unclassified");
  if (edit === "name") expect(screen.getByRole("textbox", { name: "vendor,a 的模块名称" })).toHaveValue("vendor,a-编辑");
  await dismiss();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it.each(["关闭按钮", "Escape", "遮罩"])("closes immediately with no edits via %s", async (method) => {
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items: [], modules: [] }), createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。");
  const user = userEvent.setup();
  if (method === "关闭按钮") await user.click(screen.getByRole("button", { name: "关闭" }));
  else if (method === "Escape") await user.keyboard("{Escape}");
  else {
    const backdrop = screen.getByRole("dialog", { name: "待登记主体" }).parentElement!;
    fireEvent.pointerDown(backdrop);
    fireEvent.pointerUp(backdrop);
  }
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
});

it("does not treat handoff preselection and hints as unsaved edits", async () => {
  const onClose = vi.fn();
  const repository = { listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1",
    items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }], modules: [] }), createBatchRegistration: vi.fn() };
  render(<BatchRegistrationTable repository={repository} organizationId="org" catalogReleaseId="release-1" onClose={onClose}
    initial={{ subjectIds: ["csub_a"], hints: { csub_a: { categoryPath: "未分类", moduleName: "电源" } } }} />);
  await screen.findByDisplayValue("电源");
  await userEvent.setup().click(screen.getByRole("button", { name: "关闭" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
});

it.each([true, false])("after success retains the guard only for edited rows still in the table: %s", async (remaining) => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: [] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce({ catalogReleaseId: "release-1", items, modules: [] })
    .mockResolvedValueOnce({ catalogReleaseId: "release-1", items: remaining ? items.slice(1) : [], modules: [] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn().mockResolvedValue({ batchId: "batch", items: [] }) }}
    organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 node-b" });
  await user.click(screen.getByRole("checkbox", { name: "选择 node-b" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  await screen.findByText("已登记 1 个主体。");
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
  await user.click(screen.getByRole("button", { name: "关闭" }));
  if (remaining) {
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeInTheDocument();
  } else {
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
  }
});

it("defaults selection by source and preserves remaining selections after a successful refresh", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: [] },
    { id: "csub_c", kind: "configuration-schema" as const, canonicalName: "schema-c", availableModuleIds: [] },
  ];
  const modules = [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }];
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce({ catalogReleaseId: "release-1", items, modules })
    .mockResolvedValueOnce({ catalogReleaseId: "release-1", items, modules })
    .mockResolvedValueOnce({ catalogReleaseId: "release-1", items: items.slice(1), modules });
  const createBatchRegistration = vi.fn().mockResolvedValue({ batchId: "batch", items: [] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  const first = await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  expect((first as HTMLInputElement).checked).toBe(true);
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "all");
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
  expect((screen.getByRole("checkbox", { name: "选择 vendor,a" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox", { name: "选择 node-b" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole("button", { name: "继续确认（0）" })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: "选择 vendor,a" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(3));
  expect((screen.getByRole("checkbox", { name: "选择 node-b" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox", { name: "选择 schema-c" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole("status")).toHaveTextContent("已登记 1 个主体。");
});

it("places category and name errors beneath their controls and links them accessibly", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockResolvedValue(data);
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, message: "同一分类下已有同名模块。" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  const category = await screen.findByRole("combobox", { name: "vendor,a 的业务分类" });
  const name = screen.getByRole("textbox", { name: "vendor,a 的模块名称" });
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  const categoryError = screen.getByText("请选择业务分类。");
  expect(categoryError).toHaveClass("field-error");
  expect(category.closest("td")).toContainElement(categoryError);
  expect(category).toHaveAttribute("aria-invalid", "true");
  expect(category).toHaveAccessibleDescription("请选择业务分类。");
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  await selectControlOption(category, "unclassified");
  await user.clear(name);
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  const nameError = screen.getByText("请输入模块名称。");
  expect(nameError).toHaveClass("field-error");
  expect(name.closest("td")).toContainElement(nameError);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("请输入模块名称。");
  await user.type(name, "冲突名称");
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  const conflict = await screen.findByText("同一分类下已有同名模块。");
  expect(name.closest("td")).toContainElement(conflict);
  expect(name).toHaveAccessibleDescription("同一分类下已有同名模块。");
});

it("links a server category failure to the category control", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }], modules: [] };
  const repository = { listUnregisteredSubjects: vi.fn().mockResolvedValue(data),
    createBatchRegistration: vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, message: "业务分类不存在或不可用。" }] }, "request")) };
  render(<BatchRegistrationTable repository={repository} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  const category = await screen.findByRole("combobox", { name: "vendor,a 的业务分类" });
  await selectControlOption(category, "unclassified");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  const error = await screen.findByText("业务分类不存在或不可用。");
  expect(category.closest("td")).toContainElement(error);
  expect(category).toHaveAttribute("aria-invalid", "true");
  expect(category).toHaveAccessibleDescription("业务分类不存在或不可用。");
});

it("shows source-specific empty states inside the table and puts the disabled count action beside close", async () => {
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items: [], modules: [] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const empty = await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。");
  expect(empty.tagName).toBe("TD");
  expect(empty).toHaveAttribute("colspan", "4");
  const confirm = screen.getByRole("button", { name: "继续确认（0）" });
  expect(confirm).toBeDisabled();
  const close = screen.getByRole("button", { name: "关闭" });
  expect(confirm.parentElement).toBe(close.parentElement);
  expect(close.nextElementSibling).toBe(confirm);
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "all");
  const allEmpty = await screen.findByText("当前目录中没有待登记主体。");
  expect(allEmpty.tagName).toBe("TD");
  await userEvent.setup().click(close);
  expect(onClose).toHaveBeenCalledOnce();
});

it("waits for the first read before showing an empty result", async () => {
  let finishRead!: (value: { catalogReleaseId: string; items: []; modules: [] }) => void;
  const listUnregisteredSubjects = vi.fn(() => new Promise<{ catalogReleaseId: string; items: []; modules: [] }>((resolve) => { finishRead = resolve; }));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" />);
  expect(screen.queryByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。")).not.toBeInTheDocument();
  finishRead({ catalogReleaseId: "release-1", items: [], modules: [] });
  expect(await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。")).toBeInTheDocument();
});

it("preserves handoff selection on both sources and displays the existing subject kind labels", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: [] },
    { id: "csub_c", kind: "configuration-schema" as const, canonicalName: "schema-c", availableModuleIds: [] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules: [] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" initial={{ subjectIds: ["csub_b"] }} />);
  const first = await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  expect(first).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 node-b" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 schema-c" })).not.toBeChecked();
  expect(screen.getByText(/vendor,a/).closest("td")).toHaveTextContent("驱动");
  expect(screen.getByText(/node-b/).closest("td")).toHaveTextContent("节点类型");
  expect(screen.getByText(/schema-c/).closest("td")).toHaveTextContent("配置模型");
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "organization");
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("checkbox", { name: "选择 vendor,a" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 node-b" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 schema-c" })).not.toBeChecked();
});

it("retains the remaining checked and unchecked rows after a rejected batch is refreshed", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: [] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules: [] });
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, message: "主体已登记，请刷新。" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 node-b" });
  await user.click(screen.getByRole("checkbox", { name: "选择 node-b" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  await screen.findByText("主体已登记，请刷新。");
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("checkbox", { name: "选择 vendor,a" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 node-b" })).not.toBeChecked();
});

it("opens preselected subjects with placement hints, requires a category and confirms once before refreshing", async () => {
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items: [
    { id: "csub_a", kind: "driver", canonicalName: "vendor,a", availableModuleIds: [] },
    { id: "csub_b", kind: "node-type", canonicalName: "node-b", availableModuleIds: [] },
  ], modules: [
    { id: "category", name: "电源", parentId: null, kind: "business", occupied: false },
    { id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false },
  ] });
  const createBatchRegistration = vi.fn().mockResolvedValue({ batchId: "batch", items: [] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1"
    initial={{ subjectIds: ["csub_a", "csub_b"], hints: { csub_a: { categoryPath: "电源", moduleName: "充电" } } }} onCompleted={vi.fn()} />);
  const user = userEvent.setup();
  expect(await screen.findByDisplayValue("充电")).toBeTruthy();
  expect(screen.getByDisplayValue("node-b")).toBeTruthy();
  await user.clear(screen.getByLabelText("vendor,a 的模块名称"));
  await user.type(screen.getByLabelText("vendor,a 的模块名称"), "充电芯片");
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  expect(screen.getByText("请选择业务分类。")).toBeTruthy();
  await selectControlOption(screen.getByRole("combobox", { name: "node-b 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  const dialog = screen.getByRole("dialog", { name: "确认批量登记" });
  expect(within(dialog).getByText("登记 2 个主体，新建 2 个模块。")).toBeTruthy();
  expect(within(dialog).getByText("电源：1 个")).toBeTruthy();
  expect(within(dialog).getByText("未分类：1 个")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "确认登记" }));
  await waitFor(() => expect(createBatchRegistration).toHaveBeenCalledOnce());
  expect(createBatchRegistration).toHaveBeenCalledWith("org", { rows: [
    { subjectId: "csub_a", target: { type: "new-module", parentModuleId: "category", name: "充电芯片" } },
    { subjectId: "csub_b", target: { type: "unclassified", name: "node-b" } },
  ] }, expect.objectContaining({ catalogReleaseId: "release-1" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
});

it("explains that batch registration needs API mode", async () => {
  render(<BatchRegistrationTable repository={createMockParameterCatalogGovernanceRepository()} organizationId="org" catalogReleaseId="release-1" />);
  expect(await screen.findByText("模拟模式不支持批量登记，请使用 API 模式。")).toBeTruthy();
});

it("refreshes the release pin before retrying after the catalog changes", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockImplementation(async (_organizationId: string, _source: string, release: string) => ({ ...data, catalogReleaseId: release }));
  const createBatchRegistration = vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "目录版本已变化，请刷新后重试。", { reason: "release-drift" }, "request"));
  const onRefreshEvidence = vi.fn().mockResolvedValue("release-2");
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" onRefreshEvidence={onRefreshEvidence} />);
  const user = userEvent.setup();
  await screen.findByDisplayValue("vendor,a");
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  expect(await screen.findByText("目录版本已变化，请刷新后重试。")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenLastCalledWith("org", "organization", "release-2"));
});

it("shows the server row failure and requires fresh evidence before retry", async () => {
  const response = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: [] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response, items: [] });
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, message: "主体已登记，请刷新。" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByDisplayValue("vendor,a");
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  expect(await screen.findByText("主体已登记，请刷新。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "继续确认（1）" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。");
  expect(screen.queryByDisplayValue("vendor,a")).toBeNull();
});
