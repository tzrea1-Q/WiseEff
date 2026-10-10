import { useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ViewSwitch } from "./view-switch";
import { declarationsFor, readStylesheet } from "@/test/cssAssertions";

afterEach(cleanup);

describe("ViewSwitch", () => {
  it.each([
    ["section", "var(--space-10)", "var(--radius-full)", "var(--text-md)", "var(--leading-md)", "var(--nav-selected)"],
    ["tabs", "var(--space-8)", "var(--radius-md)", "var(--text-base)", "var(--leading-base)", "var(--accent-soft)"],
    ["toggle", "calc(var(--space-6) + var(--space-1))", "var(--radius-sm)", "var(--text-sm)", "var(--leading-sm)", "var(--surface)"]
  ] as const)("gives %s tokenized geometry, selected fill, and a visible keyboard focus ring", async (variant, height, radius, size, leading, fill) => {
    render(<ViewSwitch variant={variant} ariaLabel="视图" value="first" onValueChange={() => {}} items={[
      { value: "first", label: "第一项", id: "first-tab", panelId: "first-panel" }
    ]} />);
    await userEvent.tab();
    const focused = screen.getByRole(variant === "section" ? "button" : variant === "tabs" ? "tab" : "radio", { name: "第一项" });
    expect(focused).toHaveFocus();
    expect(focused).toHaveClass("view-switch__item");
    const css = readStylesheet("src/components/ui/view-switch.css");
    const tier = declarationsFor(css, `.view-switch--${variant}`);
    expect(tier["--view-switch-height"]).toBe(height);
    expect(tier["--view-switch-radius"]).toBe(radius);
    expect(tier["--view-switch-font-size"]).toBe(size);
    expect(tier["--view-switch-leading"]).toBe(leading);
    expect(tier["--view-switch-selected-fill"]).toBe(fill);
    const item = declarationsFor(css, ".view-switch__item");
    expect(item.height).toBe("var(--view-switch-height)");
    expect(item["border-radius"]).toBe("var(--view-switch-radius)");
    expect(item["font-size"]).toBe("var(--view-switch-font-size)");
    expect(item["line-height"]).toBe("var(--view-switch-leading)");
    expect(item["font-weight"]).toBe("var(--view-switch-font-weight)");
    expect(declarationsFor(css, '.view-switch__item[aria-current="page"]').background).toBe("var(--view-switch-selected-fill)");
    expect(declarationsFor(css, '.view-switch__item[aria-selected="true"]').background).toBe("var(--view-switch-selected-fill)");
    expect(declarationsFor(css, '.view-switch__item[aria-checked="true"]').background).toBe("var(--view-switch-selected-fill)");
    expect(declarationsFor(css, ".view-switch__item:focus-visible").outline).toBe("var(--view-switch-focus-width) solid var(--accent)");
    expect(declarationsFor(readStylesheet("src/styles.css"), ":root")["--view-switch-focus-width"]).toBe("2px");
    expect(declarationsFor(css, ".view-switch__item:disabled").opacity).toBe("var(--view-switch-disabled-opacity)");
  });
  it("names section navigation, moves focus without navigating, and activates the focused destination", async () => {
    function Sections() {
      const [value, setValue] = useState("profile");
      return <ViewSwitch variant="section" ariaLabel="组织管理范围" value={value} onValueChange={setValue} items={[
        { value: "profile", label: "组织管理" },
        { value: "disabled", label: "不可用", disabled: true },
        { value: "members", label: "人员管理" }
      ]} />;
    }
    const user = userEvent.setup();
    render(<Sections />);
    const navigation = screen.getByRole("navigation", { name: "组织管理范围" });
    const profile = within(navigation).getByRole("button", { name: "组织管理" });
    const members = within(navigation).getByRole("button", { name: "人员管理" });
    await user.tab();
    expect(profile).toHaveFocus();
    expect(profile).toHaveAttribute("aria-current", "page");
    await user.keyboard("{ArrowRight}");
    expect(members).toHaveFocus();
    expect(profile).toHaveAttribute("aria-current", "page");
    await user.keyboard("{Enter}");
    expect(members).toHaveAttribute("aria-current", "page");
    expect(profile).not.toHaveAttribute("aria-current");
    await user.keyboard("{ArrowRight}");
    expect(profile).toHaveFocus();
    await user.keyboard(" ");
    expect(profile).toHaveAttribute("aria-current", "page");
    await user.keyboard("{End}");
    expect(members).toHaveFocus();
    await user.keyboard("{Home}{ArrowLeft}");
    expect(members).toHaveFocus();
  });

  it("links content tabs to panels, roves past disabled tabs, and requires activation to change content", async () => {
    function ContentTabs() {
      const [value, setValue] = useState("accounts");
      return <>
        <ViewSwitch variant="tabs" ariaLabel="用户权限工作区" value={value} onValueChange={setValue} items={[
          { value: "accounts", label: "账号库", id: "accounts-tab", panelId: "accounts-panel" },
          { value: "disabled", label: "不可用", id: "disabled-tab", panelId: "disabled-panel", disabled: true },
          { value: "approvals", label: "注册申请", id: "approvals-tab", panelId: "approvals-panel" }
        ]} />
        {["accounts", "disabled", "approvals"].map((panel) => (
          <div key={panel} role="tabpanel" id={`${panel}-panel`} aria-labelledby={`${panel}-tab`} tabIndex={0} hidden={panel !== value}>
            {panel === "accounts" ? "平台用户" : "待处理申请"}
          </div>
        ))}
      </>;
    }
    const user = userEvent.setup();
    render(<ContentTabs />);
    const tabs = screen.getByRole("tablist", { name: "用户权限工作区" });
    const accounts = within(tabs).getByRole("tab", { name: "账号库" });
    const approvals = within(tabs).getByRole("tab", { name: "注册申请" });
    expect(accounts).toHaveAttribute("aria-selected", "true");
    expect(accounts).toHaveAttribute("aria-controls", screen.getByRole("tabpanel", { name: "账号库" }).id);
    await user.tab();
    expect(accounts).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(approvals).toHaveFocus();
    expect(accounts).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(approvals).toHaveAttribute("aria-selected", "true");
    expect(accounts).toHaveAttribute("aria-selected", "false");
    expect(approvals).toHaveAttribute("aria-controls", screen.getByRole("tabpanel", { name: "注册申请" }).id);
    await user.keyboard("{ArrowRight}");
    expect(accounts).toHaveFocus();
    await user.keyboard(" ");
    expect(accounts).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{End}");
    expect(approvals).toHaveFocus();
    await user.keyboard("{Home}");
    expect(accounts).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("tabpanel", { name: "账号库" })).toHaveFocus();
  });

  it("names an option radio group and selects with arrows, Space, or a click", async () => {
    function Options() {
      const [value, setValue] = useState("all");
      return <ViewSwitch variant="toggle" ariaLabel="显示范围" value={value} onValueChange={setValue} items={[
        { value: "all", label: "全部" },
        { value: "disabled", label: "不可用", disabled: true },
        { value: "mine", label: "我的" }
      ]} />;
    }
    const user = userEvent.setup();
    render(<Options />);
    const group = screen.getByRole("radiogroup", { name: "显示范围" });
    const all = within(group).getByRole("radio", { name: "全部" });
    const mine = within(group).getByRole("radio", { name: "我的" });
    const arrow = async (key: "ArrowRight" | "ArrowLeft" | "ArrowUp" | "ArrowDown", selected: HTMLElement) => {
      await user.keyboard(`{${key}>}`);
      await waitFor(() => expect(selected).toBeChecked());
      await user.keyboard(`{/${key}}`);
    };
    await user.tab();
    expect(all).toHaveFocus();
    expect(all).toBeChecked();
    await arrow("ArrowRight", mine);
    expect(mine).toHaveFocus();
    expect(mine).toBeChecked();
    expect(all).not.toBeChecked();
    await arrow("ArrowRight", all);
    expect(all).toHaveFocus();
    expect(all).toBeChecked();
    await arrow("ArrowLeft", mine);
    expect(mine).toBeChecked();
    await arrow("ArrowUp", all);
    await arrow("ArrowDown", mine);
    all.focus();
    await user.keyboard("{Enter}");
    expect(mine).toBeChecked();
    await user.keyboard(" ");
    expect(all).toBeChecked();
    await user.click(mine);
    expect(mine).toBeChecked();
    await user.click(within(group).getByRole("radio", { name: "不可用" }));
    expect(mine).toBeChecked();
  });
});
