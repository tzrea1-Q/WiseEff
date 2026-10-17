import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";
import { ProjectAdminTable } from "./ProjectAdminTable";
import { mapProjectAdminSummaryDto } from "@/parameterAdminProjects";
import { collectConsistencyMeasurements } from "../../../e2e/quality/consistency-collector";
import { requireMeasuredCategories, requireCompactControlHeights } from "../../../e2e/quality/consistency-assertions";

const rows: ParameterAdminProjectRow[] = [
  {
    id: "project-beta",
    name: "Beta",
    code: "BETA",
    status: "maintenance",
    statusLabel: "维护",
    moduleCount: 2,
    parameterCount: 8,
    openConflictCount: 1,
    releasedBaselineCount: 0,
    baselineLabel: "无已发布",
    updatedAt: "2026-08-22T02:00:00.000Z",
    updatedAtLabel: "08/22 10:00"
  },
  {
    id: "project-alpha",
    name: "Alpha",
    code: "ALPHA",
    status: "initialized",
    statusLabel: "在研",
    moduleCount: 3,
    parameterCount: 12,
    openConflictCount: 0,
    releasedBaselineCount: 1,
    baselineLabel: "已发布",
    updatedAt: "2026-08-22T03:00:00.000Z",
    updatedAtLabel: "08/22 11:00"
  }
];

const defaultSearch: ParamAdminProjectsSearch = {
  q: "",
  statuses: [],
  sort: "name-asc"
};

function renderTable(overrides: {
  rows?: ParameterAdminProjectRow[];
  search?: ParamAdminProjectsSearch;
  onUpdateSearch?: (patch: Partial<ParamAdminProjectsSearch>) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onManageFiles?: (projectId: string) => void;
} = {}) {
  const onUpdateSearch = overrides.onUpdateSearch ?? vi.fn();
  const onEditProject = overrides.onEditProject ?? vi.fn();
  const onDeleteProject = overrides.onDeleteProject ?? vi.fn();
  const onManageFiles = vi.fn(overrides.onManageFiles);
  const view = render(
    <ProjectAdminTable
      rows={overrides.rows ?? rows}
      search={overrides.search ?? defaultSearch}
      onUpdateSearch={onUpdateSearch}
      onCreateProject={vi.fn()}
      onEditProject={onEditProject}
      onDeleteProject={onDeleteProject}
      onManageFiles={onManageFiles}
      primaryActionLabel="配置工作台"
    />
  );
  return { onUpdateSearch, onEditProject, onDeleteProject, onManageFiles, unmount: view.unmount };
}

describe("ProjectAdminTable", () => {
  it("hides archived projects by default while the archived filter exposes them", () => {
    const archived = { ...rows[0]!, status: "archived" as const, statusLabel: "已归档" };
    const view = renderTable({ rows: [archived, rows[1]!] });
    expect(screen.queryByText(archived.name)).not.toBeInTheDocument();
    view.unmount();
    renderTable({ rows: [archived, rows[1]!], search: { ...defaultSearch, statuses: ["archived"] } });
    expect(screen.getByText(archived.name)).toBeVisible();
    expect(screen.queryByText(rows[1]!.name)).not.toBeInTheDocument();
  });
  it("exposes the shared status filter and sortable headers to the live consistency collector", () => {
    const { container } = render(<main><ProjectAdminTable rows={rows} search={defaultSearch}
      onUpdateSearch={vi.fn()} onCreateProject={vi.fn()} onEditProject={vi.fn()}
      onDeleteProject={vi.fn()} onManageFiles={vi.fn()} /></main>);
    for (const element of container.querySelectorAll("*")) {
      element.getBoundingClientRect = () => new DOMRect(0, 0, 120, 32);
      Object.defineProperty(element, "checkVisibility", { value: () => true });
    }
    const measurements = collectConsistencyMeasurements();
    expect(() => requireMeasuredCategories(measurements, ["filterControls", "sortControls"], "/parameter-admin/projects")).not.toThrow();
    expect(measurements.filterControls).toHaveLength(1);
    expect(measurements.sortControls).toHaveLength(3);
    expect(() => requireCompactControlHeights(measurements, "/parameter-admin/projects")).not.toThrow();
    for (const name of ["筛选状态", "项目名称", "参数", "最近更新"]) {
      expect(screen.getByRole("button", { name })).toHaveClass("compact-filter-control");
    }
  });

  it("gates canonical project Delete with the retention policy while empty Delete stays enabled", async () => {
    const canonical = mapProjectAdminSummaryDto({ ...rows[0], canonicalOwned: true });
    const empty = mapProjectAdminSummaryDto({ ...rows[1], parameterCount: 0, canonicalOwned: false });
    const { onDeleteProject } = renderTable({ rows: [canonical, empty] });
    await userEvent.click(screen.getByRole("button", { name: `${canonical.name}操作：更多` }));
    const disabledDelete = screen.getByRole("menuitem", { name: `删除 ${canonical.name}` });
    expect(disabledDelete).toHaveAttribute("data-disabled");
    expect(disabledDelete).toHaveAccessibleDescription("项目需保留规范历史，不能删除；可归档后从默认清单收起。");
    expect(screen.getByText("项目需保留规范历史，不能删除；可归档后从默认清单收起。")).toBeVisible();
    await userEvent.click(disabledDelete);
    expect(onDeleteProject).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: `${empty.name}操作：更多` }));
    const emptyDelete = screen.getByRole("menuitem", { name: `删除 ${empty.name}` });
    expect(emptyDelete).not.toHaveAttribute("data-disabled");
    await userEvent.click(emptyDelete);
    expect(onDeleteProject).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("dialog", { name: /删除项目 Alpha/ });
    expect(confirmation).toHaveTextContent("此操作不可撤销");
    expect(confirmation).toHaveTextContent("共享参数库中的参数定义会保留");
    await userEvent.click(within(confirmation).getByRole("button", { name: "确认删除" }));
    expect(onDeleteProject).toHaveBeenCalledWith(empty.id);
  });

  it("exposes the controlled project-name sort through the table header", async () => {
    const { onUpdateSearch } = renderTable();
    const table = screen.getByRole("table", { name: "项目管理列表" });
    const nameHeader = within(table).getByRole("columnheader", { name: /项目名称/ });

    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Alpha");

    await userEvent.click(within(nameHeader).getByRole("button", { name: /项目名称/ }));

    expect(onUpdateSearch).toHaveBeenCalledWith({ sort: "name-desc" });
  });

  it("binds search, status filter, clear, and empty controls to the URL search contract", async () => {
    const onUpdateSearch = vi.fn();
    const { rerender } = render(
      <ProjectAdminTable
        rows={rows}
        search={defaultSearch}
        onUpdateSearch={onUpdateSearch}
        onCreateProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onManageFiles={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索项目" }), {
      target: { value: "Beta" }
    });
    expect(onUpdateSearch).toHaveBeenLastCalledWith({ q: "Beta" });

    await userEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "维护" }));
    expect(onUpdateSearch).toHaveBeenLastCalledWith({ statuses: ["maintenance"] });

    rerender(
      <ProjectAdminTable
        rows={rows}
        search={{ q: "missing", statuses: ["maintenance"], sort: "name-asc" }}
        onUpdateSearch={onUpdateSearch}
        onCreateProject={vi.fn()}
        onEditProject={vi.fn()}
        onDeleteProject={vi.fn()}
        onManageFiles={vi.fn()}
      />
    );
    expect(screen.getByText("没有匹配的项目。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "清除筛选条件" }));
    expect(onUpdateSearch).toHaveBeenLastCalledWith({ q: "", statuses: [] });
  });

  it("paginates more than ten projects without losing controlled sorting", async () => {
    const manyRows = Array.from({ length: 12 }, (_, index): ParameterAdminProjectRow => ({
      ...rows[0],
      id: `project-${String(index + 1).padStart(2, "0")}`,
      name: `Project ${String(index + 1).padStart(2, "0")}`,
      code: `P${String(index + 1).padStart(2, "0")}`,
      parameterCount: index + 1
    }));
    const { onUpdateSearch, unmount } = renderTable({ rows: manyRows });

    expect(screen.getByText("第 1 / 2 页 · 共 12 条")).toBeInTheDocument();
    expect(screen.getByText("Project 10")).toBeInTheDocument();
    expect(screen.queryByText("Project 11")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onUpdateSearch).toHaveBeenLastCalledWith({ page: 2 });
    unmount();
    renderTable({ rows: manyRows, search: { ...defaultSearch, page: 2 } });
    expect(screen.getByText("Project 11")).toBeInTheDocument();
    expect(screen.getByText("Project 12")).toBeInTheDocument();
  });

  it("opens a row with Enter while edit and delete actions do not bubble", async () => {
    const { onEditProject, onDeleteProject, onManageFiles } = renderTable();
    const alphaRow = screen.getByRole("row", { name: /Alpha/ });

    alphaRow.focus();
    await userEvent.keyboard("{Enter}");
    expect(onManageFiles).toHaveBeenCalledWith("project-alpha");

    onManageFiles.mockClear();
    expect(within(alphaRow).getAllByRole("button")).toHaveLength(2);
    await userEvent.click(within(alphaRow).getByRole("button", { name: "Alpha操作：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑 Alpha" }));
    expect(onEditProject).toHaveBeenCalledWith("project-alpha");
    expect(onManageFiles).not.toHaveBeenCalled();

    await userEvent.click(within(alphaRow).getByRole("button", { name: "Alpha操作：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "删除 Alpha" }));
    expect(onDeleteProject).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认删除" }));
    expect(onDeleteProject).toHaveBeenCalledWith("project-alpha");
    expect(onManageFiles).not.toHaveBeenCalled();
  });

  it("provides every semantic mobile field label and opts into the shared scroll rail", () => {
    renderTable();
    const alphaRow = screen.getByRole("row", { name: /Alpha/ });

    expect(
      within(alphaRow)
        .getAllByRole("cell")
        .map((cell) => cell.getAttribute("data-label"))
    ).toEqual(["项目名称", "项目代号", "状态", "冲突", "基线", "模块", "参数", "最近更新", "操作"]);
    expect(document.querySelector(".horizontal-drag-scroll-rail")).toBeInTheDocument();
  });
});
