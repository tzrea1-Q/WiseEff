import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterAdminNextScopeNav } from "@/components/parameter-admin-next/ParameterAdminNextScopeNav";
import { DebuggingAdminScopeNav } from "./DebuggingAdminScopeNav";

afterEach(cleanup);

describe("admin scope navigation", () => {
  it.each([
    { scope: "debugging", label: "调试后台范围", first: "参数调试", second: "节点调试", path: "/debugging-admin/nodes" },
    { scope: "parameters", label: "参数管理后台配置范围", first: "组织配置", second: "项目运营", path: "/parameter-admin/projects" }
  ])("moves focus without navigating, then activates $scope scope", async ({ scope, label, first, second, path }) => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(scope === "debugging"
      ? <DebuggingAdminScopeNav active="parameter" onNavigate={onNavigate} />
      : <ParameterAdminNextScopeNav active="organization" onNavigate={onNavigate} />);
    const navigation = screen.getByRole("navigation", { name: label });
    const current = within(navigation).getByRole("button", { name: first });
    const destination = within(navigation).getByRole("button", { name: second });
    expect(current).toHaveAttribute("aria-current", "page");
    current.focus();
    await user.keyboard("{ArrowRight}");
    expect(destination).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith(path);
  });
});
