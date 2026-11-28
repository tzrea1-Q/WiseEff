import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DebuggingAdminScopeNav } from "./DebuggingAdminScopeNav";

afterEach(cleanup);

describe("debugging admin scope navigation", () => {
  it("moves focus without navigating, then activates the focused scope", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<DebuggingAdminScopeNav active="parameter" onNavigate={onNavigate} />);
    const navigation = screen.getByRole("navigation", { name: "调试后台范围" });
    const current = within(navigation).getByRole("button", { name: "参数调试" });
    const destination = within(navigation).getByRole("button", { name: "节点调试" });
    expect(current).toHaveAttribute("aria-current", "page");
    current.focus();
    await user.keyboard("{ArrowRight}");
    expect(destination).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("/debugging-admin/nodes");
  });
});
