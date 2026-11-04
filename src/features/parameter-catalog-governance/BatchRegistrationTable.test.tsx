import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { selectControlOption } from "@/test/selectControlOption";
import { BatchRegistrationTable } from "./BatchRegistrationTable";

const rootModule = { id: "root", name: "未分类", parentId: null, kind: "unclassified" as const, occupied: false };

it("explains that a driver's children are registered with it", async () => {
  const repository = { listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1",
    items: [{ id: "driver", kind: "driver", canonicalName: "driver", availableModuleIds: ["root"], childCount: 2 }], modules: [rootModule] }),
    createBatchRegistration: vi.fn() };
  render(<BatchRegistrationTable repository={repository} organizationId="org" catalogReleaseId="release-1" />);
  expect(await screen.findByText("含 2 个子节点，将随驱动一同登记。")).toBeInTheDocument();
});
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createMockParameterCatalogGovernanceRepository } from "@/application/parameter-catalog/mockAdapter";

it("edits selected rows together, switches business categories, and excludes and re-adds rows", async () => {
  const items = [
    { id: "a", kind: "driver" as const, canonicalName: "driver-a", availableModuleIds: ["cat", "free"] },
    { id: "b", kind: "driver" as const, canonicalName: "driver-b", availableModuleIds: ["cat", "free"] },
    { id: "c", kind: "node-type" as const, canonicalName: "node-c", availableModuleIds: ["cat"] },
  ];
  const modules = [
    { id: "cat", name: "电源", parentId: null, kind: "business", occupied: false },
    { id: "free", name: "充电", parentId: "cat", kind: "business", occupied: false },
    { id: "busy", name: "占用驱动", parentId: "cat", kind: "driver-group", occupied: true },
  ];
  const createBatchRegistration = vi.fn().mockResolvedValue({ batchId: "batch", items: [] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules }), createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 driver-a" });
  expect(screen.getByRole("checkbox", { name: "全选" })).toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "全选" }));
  expect(screen.getByRole("button", { name: "继续确认（3）" })).toBeEnabled();
  await user.click(screen.getByRole("checkbox", { name: "全选" }));
  await user.click(screen.getByRole("checkbox", { name: "选择 node-c" }));
  await selectControlOption(screen.getByRole("combobox", { name: "批量业务分类" }), "category:cat");
  await user.click(screen.getByRole("button", { name: "设置业务分类" }));
  expect(screen.getByRole("combobox", { name: "driver-a 的业务分类" })).toHaveAttribute("data-value", "cat");
  expect(screen.getByRole("combobox", { name: "driver-b 的业务分类" })).toHaveAttribute("data-value", "cat");
  expect(screen.getByRole("combobox", { name: "node-c 的业务分类" })).toHaveAttribute("data-value", "");
  const name = screen.getByRole("textbox", { name: "driver-a 的展示别名" });
  await user.clear(name); await user.type(name, "新名称");
  const target = screen.getByRole("combobox", { name: "driver-b 的业务分类" });
  await user.click(target);
  expect(screen.queryByRole("option", { name: /占用驱动/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("option", { name: /充电/ }));
  await user.click(within(screen.getByRole("row", { name: /driver-b/ })).getByRole("button", { name: "移出本批" }));
  await user.click(within(screen.getByRole("row", { name: /node-c/ })).getByRole("button", { name: "移出本批" }));
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  expect(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByText("登记 1 个主体。")).toBeInTheDocument();
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "取消" }));
  await user.click(within(screen.getByRole("row", { name: /driver-b/ })).getByRole("button", { name: "加入本批" }));
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  const dialog = screen.getByRole("dialog", { name: "确认批量登记" });
  expect(within(dialog).getByText("登记 2 个主体。")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "确认登记" }));
  await waitFor(() => expect(createBatchRegistration).toHaveBeenCalledWith("org", { rows: [
    { subjectId: "a", target: { type: "existing-module", moduleId: "cat" }, displayAlias: "新名称" },
    { subjectId: "b", target: { type: "existing-module", moduleId: "free" } },
  ] }, expect.anything()));
});

it("keeps remaining edits and shows row rejections until evidence is reread", async () => {
  const items = [
    { id: "a", kind: "driver" as const, canonicalName: "driver-a", availableModuleIds: ["root"] },
    { id: "b", kind: "driver" as const, canonicalName: "driver-b", availableModuleIds: ["root"] },
  ];
  const data = { catalogReleaseId: "release-1", items, modules: [rootModule] };
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce(data).mockResolvedValueOnce({ ...data, items: items.slice(1) });
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, code: "already-registered", field: "subject" }, { index: 1, code: "conflict", field: "subject" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 driver-a" });
  await selectControlOption(screen.getByRole("combobox", { name: "批量业务分类" }), "unclassified");
  await user.click(screen.getByRole("button", { name: "设置业务分类" }));
  await user.type(screen.getByRole("textbox", { name: "driver-b 的展示别名" }), "-编辑");
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  expect(await screen.findByText("主体已登记，请刷新。")).toBeInTheDocument();
  expect(screen.getByText("登记失败，请刷新后重试。").closest("tr")).toHaveTextContent("driver-b");
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(screen.queryByText(/driver-a ·/)).not.toBeInTheDocument());
  expect(screen.getByRole("textbox", { name: "driver-b 的展示别名" })).toHaveValue("-编辑");
  expect(screen.getByRole("combobox", { name: "driver-b 的业务分类" })).toHaveAttribute("data-value", "root");
});

it("requires a new target when a chosen module becomes occupied after rereading", async () => {
  const subject = { id: "a", kind: "driver" as const, canonicalName: "driver-a", availableModuleIds: ["free"] };
  const module = { id: "free", name: "业务分类", parentId: null, kind: "business", occupied: false };
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce({ catalogReleaseId: "release-1", items: [subject], modules: [module] })
    .mockResolvedValueOnce({ catalogReleaseId: "release-1", items: [{ ...subject, availableModuleIds: ["root"] }], modules: [{ ...module, occupied: true }] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" />);
  await screen.findByRole("checkbox", { name: "选择 driver-a" });
  await selectControlOption(screen.getByRole("combobox", { name: "driver-a 的业务分类" }), "free");
  await userEvent.setup().click(screen.getByRole("button", { name: "重新读取" }));
  expect(await screen.findByText("目标模块已不可用，请重新选择。")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "继续确认（1）" }));
  expect(screen.queryByRole("dialog", { name: "确认批量登记" })).not.toBeInTheDocument();
});

it("allows two re-added rows to target the same business module", async () => {
  const items = ["a", "b"].map((id) => ({ id, kind: "driver" as const, canonicalName: id, availableModuleIds: ["free"] }));
  const modules = [{ id: "free", name: "业务分类", parentId: null, kind: "business", occupied: true }];
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules }), createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 a" });
  await user.click(within(screen.getByRole("row", { name: /a ·/ })).getByRole("button", { name: "移出本批" }));
  await selectControlOption(screen.getByRole("combobox", { name: "a 的业务分类" }), "free");
  await selectControlOption(screen.getByRole("combobox", { name: "b 的业务分类" }), "free");
  await user.click(within(screen.getByRole("row", { name: /a ·/ })).getByRole("button", { name: "加入本批" }));
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  expect(screen.getByRole("dialog", { name: "确认批量登记" })).toBeVisible();
});

it.each([
  ["关闭按钮", "selection"],
  ["Escape", "category"],
  ["遮罩", "name"],
] as const)("guards %s after a %s edit and preserves the draft when continuing", async (method, edit) => {
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1",
    items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }], modules: [rootModule] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  if (edit === "selection") await user.click(screen.getByRole("checkbox", { name: "选择 vendor,a" }));
  if (edit === "category") await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
  if (edit === "name") await user.type(screen.getByRole("textbox", { name: "vendor,a 的展示别名" }), "-编辑");
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
  if (edit === "category") expect(screen.getByRole("combobox", { name: "vendor,a 的业务分类" })).toHaveAttribute("data-value", "root");
  if (edit === "name") expect(screen.getByRole("textbox", { name: "vendor,a 的展示别名" })).toHaveValue("-编辑");
  await dismiss();
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it.each(["关闭按钮", "Escape", "遮罩"])("closes immediately with no edits via %s", async (method) => {
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items: [], modules: [rootModule] }), createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
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
    items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }], modules: [rootModule] }), createBatchRegistration: vi.fn() };
  render(<BatchRegistrationTable repository={repository} organizationId="org" catalogReleaseId="release-1" onClose={onClose}
    initial={{ subjectIds: ["csub_a"], hints: { csub_a: { categoryPath: "未分类", displayAlias: "电源" } } }} />);
  await screen.findByDisplayValue("电源");
  await userEvent.setup().click(screen.getByRole("button", { name: "关闭" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "放弃修改" })).not.toBeInTheDocument();
});

it.each([true, false])("after success retains the guard only for edited rows still in the table: %s", async (remaining) => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: ["root"] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce({ catalogReleaseId: "release-1", items, modules: [rootModule] })
    .mockResolvedValueOnce({ catalogReleaseId: "release-1", items: remaining ? items.slice(1) : [], modules: [rootModule] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn().mockResolvedValue({ batchId: "batch", items: [] }) }}
    organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 node-b" });
  await user.click(screen.getByRole("checkbox", { name: "选择 node-b" }));
  await user.click(within(screen.getByRole("row", { name: /node-b/ })).getByRole("button", { name: "移出本批" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
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
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: ["root"] },
    { id: "csub_c", kind: "configuration-schema" as const, canonicalName: "schema-c", availableModuleIds: ["root"] },
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
  await user.click(within(screen.getByRole("row", { name: /vendor,a/ })).getByRole("button", { name: "加入本批" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(3));
  expect((screen.getByRole("checkbox", { name: "选择 node-b" }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox", { name: "选择 schema-c" }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole("status")).toHaveTextContent("已登记 1 个主体。");
  expect(screen.getByRole("combobox", { name: "来源" }).parentElement?.parentElement).toContainElement(screen.getByRole("button", { name: "重新读取" }));
  expect(screen.getByRole("combobox", { name: "来源" }).parentElement?.parentElement).not.toContainElement(screen.getByRole("status"));
});

it("places category and alias errors beneath their controls and links them accessibly", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockResolvedValue(data);
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, code: "name-invalid", field: "name" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  const category = await screen.findByRole("combobox", { name: "vendor,a 的业务分类" });
  const name = screen.getByRole("textbox", { name: "vendor,a 的展示别名" });
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  const categoryError = screen.getByText("请选择业务分类。");
  expect(categoryError).toHaveClass("field-error");
  expect(category.closest("td")).toContainElement(categoryError);
  expect(category).toHaveAttribute("aria-invalid", "true");
  expect(category).toHaveAccessibleDescription("请选择业务分类。");
  expect(name).not.toHaveAttribute("aria-invalid", "true");
  await selectControlOption(category, "root");
  fireEvent.change(name, { target: { value: "invalid\u0001alias" } });
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  const nameError = screen.getByText("请输入有效的展示别名（最多 128 字）。");
  expect(nameError).toHaveClass("field-error");
  expect(name.closest("td")).toContainElement(nameError);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(name).toHaveAccessibleDescription("请输入有效的展示别名（最多 128 字）。");
  await user.clear(name);
  await user.type(name, "冲突名称");
  await user.click(screen.getByRole("button", { name: /继续确认/ }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  const conflict = await screen.findByText("请输入有效的展示别名（最多 128 字）。");
  expect(name.closest("td")).toContainElement(conflict);
  expect(name).toHaveAccessibleDescription("请输入有效的展示别名（最多 128 字）。");
});

it("links a server category failure to the category control", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }], modules: [rootModule] };
  const repository = { listUnregisteredSubjects: vi.fn().mockResolvedValue(data),
    createBatchRegistration: vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, code: "category-missing", field: "category" }] }, "request")) };
  render(<BatchRegistrationTable repository={repository} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  const category = await screen.findByRole("combobox", { name: "vendor,a 的业务分类" });
  await selectControlOption(category, "root");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  const error = await screen.findByText("业务分类不存在或不可用。");
  expect(category.closest("td")).toContainElement(error);
  expect(category).toHaveAttribute("aria-invalid", "true");
  expect(category).toHaveAccessibleDescription("业务分类不存在或不可用。");
});

it("shows source-specific empty states without batch editing or a zero-count confirm action", async () => {
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items: [], modules: [rootModule] });
  const onClose = vi.fn();
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" onClose={onClose} />);
  const empty = await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。");
  expect(empty.tagName).toBe("TD");
  expect(empty).toHaveAttribute("colspan", "5");
  expect(screen.queryByRole("button", { name: /继续确认/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "批量业务分类" })).not.toBeInTheDocument();
  const close = screen.getByRole("button", { name: "关闭" });
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "all");
  const allEmpty = await screen.findByText("当前目录中没有待登记主体。");
  expect(allEmpty.tagName).toBe("TD");
  await userEvent.setup().click(close);
  expect(onClose).toHaveBeenCalledOnce();
});

it("explains bulk-edit selection independently of submission and keeps filtered batch rows", async () => {
  const items = ["a", "b"].map(id => ({ id, kind: "driver" as const, canonicalName: `driver-${id}`, availableModuleIds: ["root"] }));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects: vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules: [rootModule] }), createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 driver-a" });
  expect(screen.getByText(/勾选用于批量设置业务分类/)).toBeVisible();
  await user.click(screen.getByRole("checkbox", { name: "选择 driver-a" }));
  expect(screen.getByRole("button", { name: "继续确认（2）" })).toBeEnabled();
  expect(screen.getByText("已勾选 1 个用于批量编辑，本批登记 2 个。")).toBeVisible();
  await user.type(screen.getByRole("searchbox", { name: "搜索待登记主体" }), "driver-a");
  expect(screen.queryByRole("row", { name: /driver-b/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "继续确认（2）" })).toBeEnabled();
  expect(screen.getByText("当前显示 1 / 2 个主体，筛选不会移出本批。" )).toBeVisible();
});

it("waits for the first read before showing an empty result", async () => {
  let finishRead!: (value: { catalogReleaseId: string; items: []; modules: typeof rootModule[] }) => void;
  const listUnregisteredSubjects = vi.fn(() => new Promise<{ catalogReleaseId: string; items: []; modules: typeof rootModule[] }>((resolve) => { finishRead = resolve; }));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" />);
  expect(screen.queryByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。")).not.toBeInTheDocument();
  finishRead({ catalogReleaseId: "release-1", items: [], modules: [rootModule] });
  expect(await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。")).toBeInTheDocument();
});

it("preserves handoff selection on both sources and displays the existing subject kind labels", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: ["root"] },
    { id: "csub_c", kind: "configuration-schema" as const, canonicalName: "schema-c", availableModuleIds: ["root"] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules: [rootModule] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org" catalogReleaseId="release-1" initial={{ subjectIds: ["csub_b"] }} />);
  const first = await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  expect(first).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 node-b" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 schema-c" })).not.toBeChecked();
  expect(screen.getByText(/vendor,a/).closest("td")).toHaveTextContent("驱动");
  expect(screen.getByText(/node-b/).closest("td")).toHaveTextContent("节点类型");
  expect(screen.getByText(/schema-c/).closest("td")).toHaveTextContent("配置模型");
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "all");
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("checkbox", { name: "选择 vendor,a" })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 node-b" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 schema-c" })).not.toBeChecked();
});

it("falls back to all subjects when the organization source lacks a preselected subject", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] },
    { id: "csub_b", kind: "driver" as const, canonicalName: "vendor,b", availableModuleIds: ["root"] },
  ];
  const listUnregisteredSubjects = vi.fn(async (_organizationId: string, source: "organization" | "all") => ({
    catalogReleaseId: "release-1", items: source === "organization" ? items.slice(0, 1) : items, modules: [rootModule],
  }));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration: vi.fn() }} organizationId="org"
    catalogReleaseId="release-1" initial={{ subjectIds: ["csub_a", "csub_b"], hints: { csub_b: { displayAlias: "充电" } } }} />);
  expect(await screen.findByRole("checkbox", { name: "选择 vendor,b" })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: "选择 vendor,a" })).toBeChecked();
  expect(screen.getByLabelText("vendor,b 的展示别名")).toHaveValue("充电");
  expect(listUnregisteredSubjects.mock.calls.map((call) => call[1])).toEqual(["organization", "all"]);
  expect(screen.getByRole("combobox", { name: "来源" })).toHaveAttribute("data-value", "all");
  await selectControlOption(screen.getByRole("combobox", { name: "来源" }), "organization");
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(3));
  expect(screen.getByRole("combobox", { name: "来源" })).toHaveAttribute("data-value", "organization");
  expect(screen.queryByRole("checkbox", { name: "选择 vendor,b" })).not.toBeInTheDocument();
});

it("retains the remaining checked and unchecked rows after a rejected batch is refreshed", async () => {
  const items = [
    { id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] },
    { id: "csub_b", kind: "node-type" as const, canonicalName: "node-b", availableModuleIds: ["root"] },
  ];
  const listUnregisteredSubjects = vi.fn().mockResolvedValue({ catalogReleaseId: "release-1", items, modules: [rootModule] });
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, code: "already-registered", field: "subject" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 node-b" });
  await user.click(screen.getByRole("checkbox", { name: "选择 node-b" }));
  await user.click(within(screen.getByRole("row", { name: /node-b/ })).getByRole("button", { name: "移出本批" }));
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
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
    { id: "csub_a", kind: "driver", canonicalName: "vendor,a", availableModuleIds: ["category", "root"] },
    { id: "csub_b", kind: "node-type", canonicalName: "node-b", availableModuleIds: ["root"] },
  ], modules: [
    { id: "category", name: "电源", parentId: null, kind: "business", occupied: false },
    { id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false },
  ] });
  const createBatchRegistration = vi.fn().mockResolvedValue({ batchId: "batch", items: [] });
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1"
    initial={{ subjectIds: ["csub_a", "csub_b"], hints: { csub_a: { categoryPath: "电源", displayAlias: "充电" } } }} onCompleted={vi.fn()} />);
  const user = userEvent.setup();
  expect(await screen.findByDisplayValue("充电")).toBeTruthy();
  expect(screen.getByLabelText("node-b 的展示别名")).toHaveValue("");
  await user.clear(screen.getByLabelText("vendor,a 的展示别名"));
  await user.type(screen.getByLabelText("vendor,a 的展示别名"), "充电芯片");
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  expect(screen.getByText("请选择业务分类。")).toBeTruthy();
  await selectControlOption(screen.getByRole("combobox", { name: "node-b 的业务分类" }), "root");
  await user.click(screen.getByRole("button", { name: "继续确认（2）" }));
  const dialog = screen.getByRole("dialog", { name: "确认批量登记" });
  expect(within(dialog).getByText("登记 2 个主体。")).toBeTruthy();
  expect(within(dialog).getByText("电源：1 个")).toBeTruthy();
  expect(within(dialog).getByText("未分类：1 个")).toBeTruthy();
  await user.click(within(dialog).getByRole("button", { name: "确认登记" }));
  await waitFor(() => expect(createBatchRegistration).toHaveBeenCalledOnce());
  expect(createBatchRegistration).toHaveBeenCalledWith("org", { rows: [
    { subjectId: "csub_a", target: { type: "existing-module", moduleId: "category" }, displayAlias: "充电芯片" },
    { subjectId: "csub_b", target: { type: "existing-module", moduleId: "root" } },
  ] }, expect.objectContaining({ catalogReleaseId: "release-1" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenCalledTimes(2));
});

it("explains that batch registration needs API mode", async () => {
  render(<BatchRegistrationTable repository={createMockParameterCatalogGovernanceRepository()} organizationId="org" catalogReleaseId="release-1" />);
  expect(await screen.findByText("模拟模式不支持批量登记，请使用 API 模式。")).toBeTruthy();
});

it("refreshes the release pin before retrying after the catalog changes", async () => {
  const data = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockImplementation(async (_organizationId: string, _source: string, release: string) => ({ ...data, catalogReleaseId: release }));
  const createBatchRegistration = vi.fn().mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "目录版本已变化，请刷新后重试。", { reason: "release-drift" }, "request"));
  const onRefreshEvidence = vi.fn().mockResolvedValue("release-2");
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" onRefreshEvidence={onRefreshEvidence} />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  expect(await screen.findByText("目录发布已变化，请刷新后重新确认。")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await waitFor(() => expect(listUnregisteredSubjects).toHaveBeenLastCalledWith("org", "organization", "release-2"));
});

it("shows the server row failure and requires fresh evidence before retry", async () => {
  const response = { catalogReleaseId: "release-1", items: [{ id: "csub_a", kind: "driver" as const, canonicalName: "vendor,a", availableModuleIds: ["root"] }],
    modules: [{ id: "root", name: "未分类", parentId: null, kind: "unclassified", occupied: false }] };
  const listUnregisteredSubjects = vi.fn().mockResolvedValueOnce(response).mockResolvedValueOnce({ ...response, items: [] });
  const createBatchRegistration = vi.fn().mockRejectedValue(new WiseEffApiError("CONFLICT", "登记失败", { rows: [{ index: 0, code: "already-registered", field: "subject" }] }, "request"));
  render(<BatchRegistrationTable repository={{ listUnregisteredSubjects, createBatchRegistration }} organizationId="org" catalogReleaseId="release-1" />);
  const user = userEvent.setup();
  await screen.findByRole("checkbox", { name: "选择 vendor,a" });
  await selectControlOption(screen.getByRole("combobox", { name: "vendor,a 的业务分类" }), "root");
  await user.click(screen.getByRole("button", { name: "继续确认（1）" }));
  await user.click(within(screen.getByRole("dialog", { name: "确认批量登记" })).getByRole("button", { name: "确认登记" }));
  expect(await screen.findByText("主体已登记，请刷新。")).toBeTruthy();
  expect((screen.getByRole("button", { name: "继续确认（1）" }) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "重新读取" }));
  await screen.findByText("本组织发布引入的主体都已登记。可切换来源查看全部 Catalog 主体。");
  expect(screen.queryByRole("checkbox", { name: "选择 vendor,a" })).toBeNull();
});
