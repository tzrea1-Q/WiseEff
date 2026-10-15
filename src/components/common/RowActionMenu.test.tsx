import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RowActionMenu } from "./RowActionMenu";
import { ModalDialog } from "./ModalDialog";

afterEach(cleanup);

describe("RowActionMenu", () => {
  it("omits an empty menu and respects a disabled visible action", async () => {
    const user = userEvent.setup();
    const view = vi.fn();
    render(<RowActionMenu label="项目 A 操作" primaryAction={{ id: "view", label: "查看", disabled: true, onSelect: view }} items={[]} />);
    expect(screen.getByRole("button", { name: "查看" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "查看" }));
    expect(view).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /更多/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("exposes outlined row buttons and a keyboard-operated, labelled ARIA menu", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    render(<ModalDialog open className="confirm-dialog" onDismiss={() => undefined}>
      {({ titleId }) => <><h2 id={titleId}>项目操作</h2><RowActionMenu label="项目 A 操作" triggerLabel="项目操作：A" triggerText="操作" primaryAction={{ id: "view", label: "查看", onSelect: vi.fn() }} items={[
      { id: "disabled", label: "不可用", disabled: true, onSelect: vi.fn() },
      { id: "edit", label: "编辑", onSelect: edit },
      { id: "copy", label: "复制", onSelect: vi.fn() }
    ]} /></>}
    </ModalDialog>);
    const group = screen.getByRole("group", { name: "项目 A 操作" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["查看", "操作"]);
    for (const button of within(group).getAllByRole("button")) expect(button).toHaveAttribute("data-variant", "outline");
    const trigger = screen.getByRole("button", { name: "项目操作：A" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await user.tab();
    await user.tab();
    await user.keyboard("{ArrowDown}");
    const menu = screen.getByRole("menu", { name: "项目操作：A" });
    expect(menu).toHaveClass("row-action-menu__content--modal");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(menu).getByRole("menuitem", { name: "不可用" })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: "编辑" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(within(menu).getByRole("menuitem", { name: "复制" })).toHaveFocus();
    await user.keyboard("{Home}{Enter}");
    expect(edit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("requires confirmation for destructive items and restores focus on cancellation", async () => {
    const user = userEvent.setup();
    const remove = vi.fn();
    render(<RowActionMenu label="项目 A 操作" items={[{
      id: "delete", label: "删除", destructive: true, onSelect: remove,
      confirmation: { title: "删除项目 A", description: "将删除项目 A 及其配置，此操作不可撤销。", confirmLabel: "确认删除" }
    }]} />);
    const trigger = screen.getByRole("button", { name: "项目 A 操作：更多" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog", { name: "删除项目 A" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("将删除项目 A 及其配置，此操作不可撤销。");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps failed confirmations open and prevents repeated writes while pending", async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const remove = vi.fn().mockRejectedValueOnce(new Error("项目仍被引用"))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<RowActionMenu label="项目 A 操作" items={[{
      id: "delete", label: "删除", destructive: true, onSelect: remove,
      confirmation: { title: "删除项目 A", description: "将永久删除项目 A。", confirmLabel: "确认删除" }
    }]} />);
    await user.click(screen.getByRole("button", { name: "项目 A 操作：更多" }));
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("项目仍被引用");
    expect(screen.getByRole("dialog", { name: "删除项目 A" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}{Enter}");
    expect(screen.getByRole("dialog", { name: "删除项目 A" })).toBeVisible();
    expect(remove).toHaveBeenCalledTimes(2);
    await act(async () => finish());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目 A 操作：更多" })).toHaveFocus();
  });
});
