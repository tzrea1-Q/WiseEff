import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ParameterAdminProjectsPage } from "./ParameterAdminProjectsPage";
import { initialState } from "./mockData";

const listFilesMock = vi.fn().mockResolvedValue([]);
const listProjectsMock = vi.fn().mockResolvedValue([]);
const listConflictsMock = vi.fn().mockResolvedValue([]);

const resolveParameterFileRepository = vi.fn(() => ({
  listFiles: listFilesMock,
  uploadFile: vi.fn(),
  uploadVersion: vi.fn(),
  listVersions: vi.fn().mockResolvedValue([]),
  downloadVersion: vi.fn(),
  syncFile: vi.fn(),
  listConflicts: listConflictsMock,
  resolveConflict: vi.fn()
}));

vi.mock("@/application/parameters/parameterFileRuntime", () => ({
  resolveParameterFileRepository: (...args: unknown[]) => resolveParameterFileRepository(...args)
}));

vi.mock("@/infrastructure/http/parameterAdminClient", () => ({
  createParameterAdminClient: () => ({
    listProjects: listProjectsMock,
    getProject: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    deleteProject: vi.fn()
  })
}));

const resolveDtsStructuredRepository = vi.fn(() => ({
  listConfigSets: vi.fn().mockResolvedValue([
    {
      id: "cs-1",
      organizationId: "org-1",
      projectId: "atlas",
      name: "board-a",
      createdAt: "2026-07-14T08:00:00.000Z",
      updatedAt: "2026-07-14T08:00:00.000Z"
    }
  ]),
  createConfigSet: vi.fn(),
  addConfigSetFile: vi.fn(),
  removeConfigSetFile: vi.fn(),
  listBaselines: vi.fn().mockResolvedValue([]),
  createBaseline: vi.fn(),
  compareBaseline: vi.fn(),
  rollbackBaseline: vi.fn(),
  releaseBaseline: vi.fn(),
  exportConfigSet: vi.fn(),
  getStructure: vi.fn(),
  search: vi.fn()
}));

vi.mock("@/application/parameters/dtsStructuredRuntime", () => ({
  resolveDtsStructuredRepository: (...args: unknown[]) => resolveDtsStructuredRepository(...args)
}));

describe("ParameterAdminProjectsPage", () => {
  beforeEach(() => {
    resolveDtsStructuredRepository.mockClear();
    resolveParameterFileRepository.mockClear();
    listFilesMock.mockReset();
    listFilesMock.mockResolvedValue([]);
    listConflictsMock.mockReset();
    listConflictsMock.mockResolvedValue([]);
    listProjectsMock.mockReset();
    listProjectsMock.mockResolvedValue([]);
  });

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

  it("opens manage-files dialog with config-set / baseline tab wired to dts repository", async () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");
    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: `管理文件 ${atlasProject?.name ?? "atlas"}` }));

    const dialog = screen.getByRole("dialog", { name: new RegExp(`管理文件 · ${atlasProject?.name ?? "atlas"}`) });
    expect(within(dialog).getByRole("tab", { name: "参数文件" })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("tab", { name: "配置集 / 基线" }));

    expect(await within(dialog).findByRole("region", { name: "配置集 / 基线" })).toBeInTheDocument();
    expect(resolveDtsStructuredRepository).toHaveBeenCalledWith("mock");
  });

  it("opens structure browser tab and loads teaching structure for value editing", async () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");
    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");
    const getStructure = vi.fn().mockResolvedValue({
      nodes: [
        {
          nodePath: "demo_bool",
          name: "demo_bool",
          labels: ["demo_bool"],
          properties: [
            {
              name: "weak_source_sleep_enabled",
              valueType: "bool",
              rawText: "",
              normalizedValue: "true"
            }
          ],
          phandleRefs: []
        }
      ]
    });
    resolveDtsStructuredRepository.mockReturnValueOnce({
      listConfigSets: vi.fn().mockResolvedValue([]),
      createConfigSet: vi.fn(),
      addConfigSetFile: vi.fn(),
      removeConfigSetFile: vi.fn(),
      listBaselines: vi.fn().mockResolvedValue([]),
      createBaseline: vi.fn(),
      compareBaseline: vi.fn(),
      rollbackBaseline: vi.fn(),
      releaseBaseline: vi.fn(),
      exportConfigSet: vi.fn(),
      getStructure,
      search: vi.fn()
    });

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: `管理文件 ${atlasProject?.name ?? "atlas"}` }));
    const dialog = screen.getByRole("dialog", { name: new RegExp(`管理文件 · ${atlasProject?.name ?? "atlas"}`) });
    fireEvent.click(within(dialog).getByRole("tab", { name: "结构浏览" }));

    const panel = await within(dialog).findByRole("region", { name: "结构浏览" });
    await waitFor(() => {
      expect(getStructure).toHaveBeenCalledWith("atlas", "file-teaching-dts", "version-teaching-1");
    });

    fireEvent.click(within(panel).getByRole("treeitem", { name: "demo_bool" }));
    fireEvent.click(within(panel).getByRole("button", { name: /编辑属性 weak_source_sleep_enabled/ }));
    expect(within(panel).getByRole("checkbox", { name: "布尔开关" })).toBeInTheDocument();
  });

  it("resolves the http dts repository when runtimeMode is api", () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="api"
      />
    );

    expect(resolveDtsStructuredRepository).toHaveBeenCalledWith("api");
  });

  it("in mock mode loads availableFiles via the parameter file repository", async () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");
    const atlasProject = initialState.configDraft.projects.find((project) => project.id === "atlas");
    listFilesMock.mockResolvedValue([
      {
        id: "file-teaching",
        projectId: "atlas",
        fileName: "teaching-sample.dts",
        format: "dts",
        enabled: true,
        updatedAt: "2026-07-14T08:00:00.000Z"
      },
      {
        id: "file-board",
        projectId: "atlas",
        fileName: "board-sample.dts",
        format: "dts",
        enabled: true,
        updatedAt: "2026-07-14T08:01:00.000Z"
      }
    ]);

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="mock"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: `管理文件 ${atlasProject?.name ?? "atlas"}` }));
    fireEvent.click(screen.getByRole("tab", { name: "配置集 / 基线" }));

    const panel = await screen.findByRole("region", { name: "配置集 / 基线" });
    await waitFor(() => {
      expect(within(panel).getByLabelText("成员文件")).toBeInTheDocument();
    });

    expect(resolveParameterFileRepository).toHaveBeenCalledWith("mock");
    expect(listFilesMock).toHaveBeenCalledWith("atlas");

    const fileSelect = within(panel).getByLabelText("成员文件");
    expect(within(fileSelect).getByRole("option", { name: "teaching-sample.dts" })).toBeInTheDocument();
    expect(within(fileSelect).getByRole("option", { name: "board-sample.dts" })).toBeInTheDocument();
  });

  it("in api mode loads availableFiles via parameter file repository for ConfigSetBaselinePanel", async () => {
    window.history.replaceState(null, "", "/parameter-admin/projects");
    listProjectsMock.mockResolvedValue([
      {
        id: "atlas",
        name: "Atlas",
        code: "ATL",
        status: "initialized",
        moduleCount: 1,
        parameterCount: 1,
        updatedAt: "2026-07-14T08:00:00.000Z"
      }
    ]);
    listFilesMock.mockResolvedValue([
      {
        id: "file-engine",
        projectId: "atlas",
        fileName: "engine.dts",
        format: "dts",
        enabled: true,
        updatedAt: "2026-07-14T08:00:00.000Z"
      },
      {
        id: "file-board",
        projectId: "atlas",
        fileName: "board.dts",
        format: "dts",
        enabled: true,
        updatedAt: "2026-07-14T08:01:00.000Z"
      }
    ]);

    render(
      <ParameterAdminProjectsPage
        state={initialState}
        dispatch={vi.fn()}
        onNavigate={vi.fn()}
        search=""
        runtimeMode="api"
      />
    );

    fireEvent.click(await screen.findByRole("button", { name: "管理文件 Atlas" }));
    fireEvent.click(screen.getByRole("tab", { name: "配置集 / 基线" }));

    const panel = await screen.findByRole("region", { name: "配置集 / 基线" });
    await waitFor(() => expect(listFilesMock).toHaveBeenCalledWith("atlas"));

    const fileSelect = within(panel).getByLabelText("成员文件");
    expect(within(fileSelect).getByRole("option", { name: "engine.dts" })).toBeInTheDocument();
    expect(within(fileSelect).getByRole("option", { name: "board.dts" })).toBeInTheDocument();
  });
});


