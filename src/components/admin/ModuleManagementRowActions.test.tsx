import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModuleManagementRowActions } from "./ModuleManagementRowActions";

describe("ModuleManagementRowActions", () => {
  it("renders the more menu in the document body so table overflow cannot clip it", () => {
    render(
      <ModuleManagementRowActions
        moduleName="Power IC"
        itemCount={0}
        viewItemsLabel="查看节点"
        canDelete
        onEdit={vi.fn()}
        onViewItems={vi.fn()}
        onAddChild={vi.fn()}
        onMove={vi.fn()}
        onDelete={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Power IC 更多操作" }));

    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole("menuitem", { name: "添加子模块" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "移动" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });
});
