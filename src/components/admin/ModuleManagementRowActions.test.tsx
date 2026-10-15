import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleManagementRowActions } from "./ModuleManagementRowActions";
import userEvent from "@testing-library/user-event";
import { ModalDialog } from "@/components/common/ModalDialog";

describe("ModuleManagementRowActions", () => {
  it("renders an accessible portal menu and confirms before deleting a module", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <ModalDialog open className="confirm-dialog" onDismiss={vi.fn()}>
        {({ titleId }) => <><h2 id={titleId}>模块管理</h2><ModuleManagementRowActions
        moduleName="Power IC"
        itemCount={0}
        viewItemsLabel="查看节点"
        canDelete
        onEdit={vi.fn()}
        onViewItems={vi.fn()}
        onAddChild={vi.fn()}
        onMove={vi.fn()}
        onDelete={onDelete}
      /></>}
      </ModalDialog>
    );

    await user.click(screen.getByRole("button", { name: "Power IC 更多操作" }));

    const menu = screen.getByRole("menu");
    expect(document.body).toContainElement(menu);
    expect(menu).toHaveClass("row-action-menu__content--modal");
    expect(screen.getByRole("menuitem", { name: "添加子模块" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "移动" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "删除模块「Power IC」？" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "删除模块" }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
