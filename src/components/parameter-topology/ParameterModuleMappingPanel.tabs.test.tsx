import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createTestModuleRegistryRepository } from "@/test/harness";
import { ParameterModuleMappingPanel } from "./ParameterModuleMappingPanel";

describe("module governance workbench tabs", () => {
  it.each([
    ["/parameter-admin/modules", "?q=power", "模块", null],
    ["/parameter-admin/modules/queue", "?q=power", "发现队列", "/parameter-admin/modules?q=power&tab=queue"],
    ["/parameter-admin/modules/registry", "?q=power", "历史注册表", "/parameter-admin/modules?q=power&tab=registry"],
    ["/parameter-admin/modules", "?q=power&tab=registry", "历史注册表", null]
  ])("opens %s%s in its matching tab without losing bookmark context", async (pathname, search, label, redirect) => {
    const onNavigate = vi.fn();
    const repository = createTestModuleRegistryRepository();
    const view = render(<ParameterModuleMappingPanel canAdmin repository={repository}
      pathname={pathname} search={search} onNavigate={onNavigate} />);
    const tabs = await screen.findByRole("tablist", { name: "模块治理视图" });
    expect(within(tabs).getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName(label);
    for (const tab of within(tabs).getAllByRole("tab")) {
      expect(document.getElementById(tab.getAttribute("aria-controls")!)).toBe(screen.getByRole("tabpanel"));
    }
    expect(screen.getByRole("button", { name: "收起模块导航" })).toBeInTheDocument();
    if (redirect) await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(redirect, { replace: true }));
    else expect(onNavigate).not.toHaveBeenCalled();
    await userEvent.click(within(tabs).getByRole("tab", { name: "发现队列" }));
    if (label !== "发现队列") expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?q=power&tab=queue");
    view.rerender(<ParameterModuleMappingPanel canAdmin repository={repository}
      pathname="/parameter-admin/modules" search="?q=power&tab=queue" onNavigate={onNavigate} />);
    expect(within(tabs).getByRole("tab", { name: "发现队列" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "历史驱动注册表" })).not.toBeInTheDocument();
    expect(await screen.findByText("Mock 模式不提供规范发现队列，请使用 API 模式。")).toBeVisible();
    await userEvent.click(within(tabs).getByRole("tab", { name: "发现队列" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(within(tabs).getByRole("tab", { name: "历史注册表" })).toHaveFocus();
    expect(within(tabs).getByRole("tab", { name: "发现队列" })).toHaveAttribute("aria-selected", "true");
    await userEvent.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenLastCalledWith("/parameter-admin/modules?q=power&tab=registry");
  });

  it("shows read-only historical records without exposing taxonomy writes to a reader", async () => {
    const repository = createTestModuleRegistryRepository({
      listDriverRegistry: vi.fn().mockResolvedValue({ items: [{
        moduleId: "old-driver", name: "历史充电驱动", origin: "curated",
        businessCategoryId: null, businessCategoryName: null, defaultBusinessCategoryId: null,
        compatibles: ["vendor,charger", "vendor,charger-v2"], parameterCount: 3,
        observed: true, notYetObserved: false, driverNature: "physical-device", instanceCardinality: "multiple", parseCoverages: []
      }], total: 1 })
    });
    render(<ParameterModuleMappingPanel repository={repository} search="?tab=registry" />);
    const table = await screen.findByRole("table", { name: "历史驱动注册表" });
    expect(within(table).getByText("历史充电驱动")).toBeVisible();
    expect(within(table).getByText("vendor,charger、vendor,charger-v2")).toBeVisible();
    expect(within(table).getByText("未分类")).toBeVisible();
    expect(within(table).getByText("已观察")).toBeVisible();
    expect(screen.queryByRole("button", { name: "新建模块" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("button")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "模块", exact: true }));
    expect(screen.queryByRole("table", { name: "历史驱动注册表" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "历史注册表" }));
    expect(table).toBeVisible();
    expect(repository.createModule).not.toHaveBeenCalled();
    expect(repository.updateModule).not.toHaveBeenCalled();
    expect(repository.deleteModule).not.toHaveBeenCalled();
  });
});
