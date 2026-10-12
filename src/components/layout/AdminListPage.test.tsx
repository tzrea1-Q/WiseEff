import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import { ProjectAdminFormDialog } from "@/components/admin/ProjectAdminFormDialog";
import { AdminListPage } from "./AdminListPage";

describe("AdminListPage", () => {
  it("lets Escape cancel row deletion without activating the row or issuing a write", async () => {
    const remove = vi.fn();
    const navigate = vi.fn();
    render(<AdminListPage label="项目" headerActions={null} filterBar={null}
      table={{ rows: [{ id: "alpha" }], rowKey: (row) => row.id, onRowClick: navigate,
        columns: [{ key: "id", header: "项目", render: (row) => row.id }] }}
      rowActions={() => ({ label: "Alpha操作", items: [{ id: "delete", label: "删除", destructive: true,
        confirmation: { title: "删除项目 Alpha", description: "不可撤销", confirmLabel: "确认删除" }, onSelect: remove }] })}
      emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: vi.fn() }} />);
    const trigger = screen.getByRole("button", { name: "Alpha操作：更多" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "删除项目 Alpha" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("resets controlled pagination when the shared table sorts its own rows", async () => {
    function SortedList() {
      const [page, setPage] = useState(2);
      return <AdminListPage label="项目" headerActions={null} filterBar={null}
        table={{ rows: [{ id: "Beta" }, { id: "Alpha" }], rowKey: (row) => row.id,
          page, onPageChange: setPage, pageSize: 1,
          columns: [{ key: "id", header: "项目", sortAccessor: (row) => row.id, render: (row) => row.id }] }}
        emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: vi.fn() }} />;
    }
    render(<SortedList />);
    await userEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(screen.getByText("第 1 / 2 页 · 共 2 条")).toBeVisible();
    expect(screen.getByText("Alpha")).toBeVisible();
  });
  it("opens details from overflow without losing keyboard focus on dismissal", async () => {
    function DetailList() {
      const [open, setOpen] = useState(false);
      return <AdminListPage label="项目" headerActions={null} filterBar={null}
        table={{ rows: [{ id: "alpha" }], rowKey: (row) => row.id,
          columns: [{ key: "id", header: "项目", render: (row) => row.id }] }}
        rowActions={() => ({ label: "Alpha操作", items: [{ id: "edit", label: "编辑", onSelect: () => setOpen(true) }] })}
        emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: vi.fn() }}
        detailDrawer={<ProjectAdminFormDialog open={open} mode="edit" initialName="Alpha" initialCode="ALPHA"
          onClose={() => setOpen(false)} onSubmit={vi.fn()} />} />;
    }
    render(<DetailList />);
    const trigger = screen.getByRole("button", { name: "Alpha操作：更多" });
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    const dialog = screen.getByRole("dialog", { name: "编辑项目详情" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it("offers one next step in an empty table", async () => {
    const create = vi.fn();
    render(<AdminListPage label="项目" headerActions={null} filterBar={null}
      table={{ rows: [], rowKey: (row: { id: string }) => row.id,
        columns: [{ key: "id", header: "项目", render: (row) => row.id }], ariaLabel: "项目列表" }}
      emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: create }} />);
    const empty = screen.getByRole("cell");
    expect(empty).toHaveTextContent("暂无项目");
    expect(within(empty).getAllByRole("button")).toHaveLength(1);
    await userEvent.click(within(empty).getByRole("button", { name: "新建项目" }));
    expect(create).toHaveBeenCalledOnce();
  });
  it("restores URL pagination and sorting after remount and updates the URL on navigation", async () => {
    window.history.replaceState(null, "", "/parameter-admin/projects?sort=name-desc&page=2");
    function UrlList() {
      const { search, updateSearch } = useParamAdminProjectsSearch();
      return <AdminListPage label="项目" headerActions={null} filterBar={null}
        table={{ rows: [{ name: "Alpha" }, { name: "Beta" }], rowKey: (row) => row.name, pageSize: 1,
          columns: [{ key: "name", header: "项目", sortAccessor: (row) => row.name, render: (row) => row.name }],
          sort: { key: "name", direction: search.sort === "name-desc" ? "desc" : "asc" },
          onSort: () => updateSearch({ sort: "name-asc" }), page: search.page, onPageChange: (page) => updateSearch({ page }) }}
        emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: vi.fn() }} />;
    }
    const first = render(<UrlList />);
    expect(screen.getByText("第 2 / 2 页 · 共 2 条")).toBeVisible();
    expect(screen.getByText("Alpha")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(window.location.search).toBe("?sort=name-desc");
    first.unmount();
    render(<UrlList />);
    expect(screen.getByText("Beta")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "项目" }));
    expect(window.location.search).toBe("");
    expect(screen.getByText("Alpha")).toBeVisible();
    window.history.replaceState(null, "", "/parameter-admin/projects");
  });
  it("renders header actions, filters, the shared table and an optional detail dialog", () => {
    render(<AdminListPage label="项目清单" headerActions={<button>新建项目</button>}
      filterBar={<input aria-label="搜索项目" />} table={{ rows: [{ id: "alpha" }], rowKey: (row) => row.id,
        columns: [{ key: "id", header: "项目", render: (row) => row.id }], ariaLabel: "项目列表" }}
      emptyState={{ message: "暂无项目", actionLabel: "新建项目", onAction: vi.fn() }}
      detailDrawer={<div role="dialog" aria-label="项目详情">详情</div>} />);
    expect(screen.getByRole("group", { name: "项目清单操作" })).toContainElement(screen.getByRole("button", { name: "新建项目" }));
    expect(screen.getByRole("group", { name: "项目清单筛选" })).toContainElement(screen.getByRole("textbox", { name: "搜索项目" }));
    expect(within(screen.getByRole("table", { name: "项目列表" })).getByText("alpha")).toBeVisible();
    expect(screen.getByRole("dialog", { name: "项目详情" })).toBeVisible();
  });
});
