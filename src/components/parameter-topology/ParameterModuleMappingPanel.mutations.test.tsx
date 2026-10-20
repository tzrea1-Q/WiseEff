import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createTestModuleRegistryRepository } from "@/test/harness";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

const parent: ParameterModule = { id: "power", name: "电源", parentId: null, kind: "business", origin: "curated",
  sortOrder: 0, description: "", scope: "", sourceKey: null, importance: "medium", effectiveImportance: "medium", parameterCount: 0, definitionCount: 0 };
const child = { ...parent, id: "battery", name: "电池", parentId: parent.id };

describe("module mutation failure through the real page callbacks", () => {
  it("clears a deleted module selection so retained subjects remain reachable", async () => {
    const repository = createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [parent], mappings: [] }),
      deleteModule: vi.fn().mockResolvedValue({ modules: [], mappings: [] }) });
    const onNavigate = vi.fn();
    render(<ParameterModuleMappingPanel canAdmin repository={repository} search="?moduleId=power" onNavigate={onNavigate} />);
    await userEvent.click(await screen.findByRole("button", { name: "删除模块 电源" }));
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules"));
    expect(screen.queryByRole("button", { name: "删除模块 电源" })).not.toBeInTheDocument();
  });
  it("retains new-module input when create fails", async () => {
    const repository = createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [parent], mappings: [] }),
      createModule: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<ParameterModuleMappingPanel canAdmin repository={repository} />);
    await userEvent.click(await screen.findByRole("button", { name: "新建模块" }));
    const dialog = screen.getByRole("dialog", { name: "新增根模块" });
    fireEvent.change(within(dialog).getByLabelText("模块名称"), { target: { value: "保留输入" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "创建" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(within(dialog).getByLabelText("模块名称")).toHaveValue("保留输入");
    expect(repository.createModule).toHaveBeenCalledTimes(1);
  });

  it("retains the selected destination when move fails", async () => {
    const repository = createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [parent, child], mappings: [] }),
      updateModule: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<ParameterModuleMappingPanel canAdmin repository={repository} />);
    await userEvent.click(await screen.findByRole("button", { name: "电池 更多操作" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "调整上级模块 电池" }));
    const dialog = screen.getByRole("dialog", { name: "移动「电池」" });
    await userEvent.click(within(dialog).getByRole("button", { name: "目标业务分类" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "根级（无父模块）" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "确认移动" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "目标业务分类" })).toHaveTextContent("根级");
    expect(repository.updateModule).toHaveBeenCalledWith(child.id, { parentId: null });
  });

  it("keeps deletion confirmation open when delete fails", async () => {
    const repository = createTestModuleRegistryRepository({ getRegistry: vi.fn().mockResolvedValue({ modules: [parent], mappings: [] }),
      deleteModule: vi.fn().mockRejectedValue(new Error("offline")) });
    render(<ParameterModuleMappingPanel canAdmin repository={repository} />);
    await userEvent.click(await screen.findByRole("button", { name: "删除模块 电源" }));
    const dialog = screen.getByRole("dialog", { name: "删除模块「电源」" });
    await userEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
    expect(await within(dialog).findByRole("alert")).toBeVisible();
    expect(repository.deleteModule).toHaveBeenCalledWith(parent.id);
  });
});
