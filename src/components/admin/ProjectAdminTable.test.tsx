import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ParamAdminProjectsSearch } from "@/hooks/useParamAdminProjectsSearch";
import type { ParameterAdminProjectRow } from "@/parameterAdminProjects";
import { ProjectAdminTable } from "./ProjectAdminTable";

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
  const onManageFiles = overrides.onManageFiles ?? vi.fn();
  render(
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
  return { onUpdateSearch, onEditProject, onDeleteProject, onManageFiles };
}

describe("ProjectAdminTable", () => {
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
    renderTable({ rows: manyRows });

    expect(screen.getByText("第 1 / 2 页 · 共 12 条")).toBeInTheDocument();
    expect(screen.getByText("Project 10")).toBeInTheDocument();
    expect(screen.queryByText("Project 11")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
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
    await userEvent.click(within(alphaRow).getByRole("button", { name: "编辑 Alpha" }));
    expect(onEditProject).toHaveBeenCalledWith("project-alpha");
    expect(onManageFiles).not.toHaveBeenCalled();

    await userEvent.click(within(alphaRow).getByRole("button", { name: "删除 Alpha" }));
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
