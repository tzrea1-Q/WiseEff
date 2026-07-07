import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParameterAdminProjectsPage } from "./ParameterAdminProjectsPage";
import { initialState } from "./mockData";

describe("ParameterAdminProjectsPage", () => {
  it("renders project management workspace with sub navigation", () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    expect(screen.getByRole("navigation", { name: "参数管理后台分区" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "项目管理" })).toHaveClass("is-active");
    expect(screen.getByRole("table", { name: "项目管理列表" })).toBeInTheDocument();
    expect(screen.getByText("项目总数")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目清单" })).toBeInTheDocument();
    expect(document.querySelector(".project-admin-detail")).not.toBeInTheDocument();
  });

  it("opens the edit dialog from the table action icon", () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");
    fireEvent.click(screen.getByRole("button", { name: `编辑 ${atlasProject?.name ?? "atlas"}` }));

    const dialog = screen.getByRole("dialog", { name: "编辑项目详情" });

    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByLabelText("项目名称")).toHaveValue(atlasProject?.name ?? "");
    expect(within(dialog).getByLabelText("项目 ID")).toHaveValue("atlas");

    const statusSelect = within(dialog).getByLabelText("项目状态");
    const optionLabels = within(statusSelect)
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(optionLabels).toEqual(["在研", "维护"]);
    expect(statusSelect).toHaveValue("initialized");
  });

  it("dispatches a project status change to maintenance", () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");
    const dispatch = vi.fn();

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={dispatch}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");
    fireEvent.click(screen.getByRole("button", { name: `编辑 ${atlasProject?.name ?? "atlas"}` }));

    const dialog = screen.getByRole("dialog", { name: "编辑项目详情" });
    fireEvent.change(within(dialog).getByLabelText("项目状态"), { target: { value: "maintenance" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存修改" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "UPDATE_PROJECT",
        projectId: "atlas",
        patch: expect.objectContaining({ status: "maintenance" })
      })
    );
  });

  it("opens the shared new project wizard instead of a local create dialog", () => {
    const onNewProject = vi.fn();

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        onNewProject={onNewProject}
        search=""
        runtimeMode="api"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));

    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "新建项目" })).not.toBeInTheDocument();
  });

  it("allows deleting projects that still have parameters", () => {
    const dispatch = vi.fn();
    window.history.replaceState(null, "", "/parameter-admin/projects");

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={dispatch}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");
    const deleteButton = screen.getByRole("button", { name: `删除 ${atlasProject?.name ?? "atlas"}` });
    expect(deleteButton).not.toBeDisabled();

    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "DELETE_PARAMETER_ADMIN_PROJECT",
      projectId: "atlas"
    });
  });

  it("opens delete confirmation and dispatches delete for empty projects", () => {
    const dispatch = vi.fn();
    const stateWithEmptyProject = {
      ...initialState,
      configDraft: {
        ...initialState.configDraft,
        projects: [...initialState.configDraft.projects, { id: "empty-test", name: "Empty Test", code: "EMP" }]
      }
    };

    render(
      <ParameterAdminProjectsPage
        state={stateWithEmptyProject}
        dispatch={dispatch}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "删除 Empty Test" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    expect(dispatch).toHaveBeenCalledWith({
      type: "DELETE_PARAMETER_ADMIN_PROJECT",
      projectId: "empty-test"
    });
  });
});
