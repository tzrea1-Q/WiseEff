import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";
import {
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./topologyTeachingFixtures";
import { ApiProjectTopologyWorkspace } from "./ApiProjectTopologyWorkspace";

const httpTestSeams = vi.hoisted(() => {
  const moduleRegistryRepository = {
    getRegistry: vi.fn().mockResolvedValue({ modules: [], mappings: [] })
  };
  const parameterFileRepository = {
    listFiles: vi.fn().mockResolvedValue([]),
    downloadVersion: vi.fn().mockResolvedValue({
      contentType: "text/plain",
      fileName: "unused.dts",
      bytes: new Uint8Array()
    })
  };
  const parameterRepository = {
    listDrafts: vi.fn().mockResolvedValue([]),
    deleteDraft: vi.fn().mockResolvedValue(undefined)
  };
  const createHttpParameterModuleRegistryRepository = vi.fn(() => moduleRegistryRepository);
  const createHttpParameterRepository = vi.fn(() => parameterRepository);
  const resolveParameterFileRepository = vi.fn(() => parameterFileRepository);
  const fetchCalls: string[] = [];
  const fetchSentinel = vi.fn((input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    fetchCalls.push(url);
    return Promise.reject(
      new Error(`Unexpected fetch in ApiProjectTopologyWorkspace.test.tsx: ${url}`)
    );
  });

  return {
    moduleRegistryRepository,
    parameterFileRepository,
    parameterRepository,
    createHttpParameterModuleRegistryRepository,
    createHttpParameterRepository,
    resolveParameterFileRepository,
    fetchCalls,
    fetchSentinel
  };
});

vi.mock("@/infrastructure/http/parameterModuleRegistryClient", () => ({
  createHttpParameterModuleRegistryRepository: httpTestSeams.createHttpParameterModuleRegistryRepository
}));

vi.mock("@/infrastructure/http/parameterClient", () => ({
  createHttpParameterRepository: httpTestSeams.createHttpParameterRepository
}));

vi.mock("@/application/parameters/parameterFileRuntime", () => ({
  resolveParameterFileRepository: httpTestSeams.resolveParameterFileRepository
}));

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

function createRepository(
  overrides: Partial<ParameterTopologyRepository> = {}
): ParameterTopologyRepository {
  return {
    listSpecs: vi.fn(),
    getSpec: vi.fn().mockResolvedValue({
      id: "spec-sc8562-gpio-int",
      organizationId: "org-chargelab",
      sourceKind: "vendor",
      specificationKey: "sc8562/gpio_int",
      propertyKey: "gpio_int",
      driverModule: "sc8562",
      lifecycle: "active",
      currentVersionId: "spec-version-1",
      currentVersion: 1,
      displayName: "gpio_int",
      description: "Interrupt GPIO",
      valueShape: null,
      schemaDefault: null,
      exampleValue: null,
      schemaNamespace: null,
      units: null,
      constraints: null,
      documentation: null,
      compatiblePatterns: null,
      policyTarget: null
    }),
    listSpecReviewTasks: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    resolveSpecReviewTask: vi.fn().mockResolvedValue(undefined),
    listBindings: vi.fn().mockResolvedValue(TOPOLOGY_TEACHING_BINDINGS),
    getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
      if (view === "source") {
        return {
          view: "source" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: "dcs-default-aurora",
          projectId: "aurora",
          status: "resolved",
          incompleteBase: false,
          diagnostics: [],
          nodes: TOPOLOGY_TEACHING_SOURCE_NODES
        };
      }
      return {
        view: "effective" as const,
        revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
        configSetId: "dcs-default-aurora",
        projectId: "aurora",
        status: "resolved",
        incompleteBase: false,
        diagnostics: [],
        nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
      };
    }),
    listMappingTasks: vi.fn().mockResolvedValue([]),
    resolveMapping: vi.fn(),
    listConfigRevisions: vi.fn().mockResolvedValue([]),
    validateRevision: vi.fn().mockResolvedValue({ id: "run-1", status: "passed", stage: "toolchain" }),
    createBindingDraft: vi.fn().mockResolvedValue({
      draftId: "draft-1",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "rev-candidate-2",
      rawText: "<&gpio13 29 0>",
      action: "set",
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts"
    }),
    createNodeEnablementDraft: vi.fn().mockResolvedValue({
      draftId: "draft-enable-1",
      candidateRevisionId: "rev-candidate-2",
      rawText: '"disabled"',
      action: "set",
      logicalNodeId: "logical-sc8562",
      target: "force-disabled",
      writeTarget: { role: "overlay", propertyKey: "status", targetRef: "sc8562@6E" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts",
      previousRaw: '"okay"'
    }),
    ...overrides
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}


async function createGpioDraftFromWorkbench(
  workspace: HTMLElement,
  fireEvent: typeof import("@testing-library/react").fireEvent,
  input: { reason: string; rawValue?: string; editButtonName?: RegExp }
) {
  const editName = input.editButtonName ?? /编辑 gpio_int（未分类 · sc8562/;
  fireEvent.click(within(workspace).getByRole("button", { name: editName }));
  const draftDialog = await screen.findByRole("dialog", { name: "修改草稿" });
  if (input.rawValue !== undefined) {
    fireEvent.change(within(draftDialog).getByRole("textbox", { name: "目标值" }), {
      target: { value: input.rawValue }
    });
  }
  fireEvent.change(within(draftDialog).getByRole("textbox", { name: "修改原因" }), {
    target: { value: input.reason }
  });
  fireEvent.click(within(draftDialog).getByRole("button", { name: "校验并加入本轮" }));
  return draftDialog;
}

describe("ApiProjectTopologyWorkspace", () => {
  beforeEach(() => {
    httpTestSeams.fetchCalls.length = 0;
    httpTestSeams.fetchSentinel.mockClear();
    httpTestSeams.createHttpParameterModuleRegistryRepository.mockClear();
    httpTestSeams.createHttpParameterRepository.mockClear();
    httpTestSeams.resolveParameterFileRepository.mockClear();
    vi.stubGlobal("fetch", httpTestSeams.fetchSentinel);
  });

  it("does not call fetch when rendering the default workspace seam", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });

    expect(httpTestSeams.fetchSentinel).not.toHaveBeenCalled();
    expect(httpTestSeams.fetchCalls).toEqual([]);
    expect(httpTestSeams.createHttpParameterModuleRegistryRepository).toHaveBeenCalled();
    expect(httpTestSeams.createHttpParameterRepository).toHaveBeenCalled();
    expect(httpTestSeams.resolveParameterFileRepository).toHaveBeenCalledWith("api");
  });

  it("loads real config set and current revision — never teaching ids", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(workspace).toHaveAttribute("data-revision-id", "rev-real-1");
    expect(workspace.getAttribute("data-config-set-id")).not.toMatch(/-default-config$/);
    expect(workspace.getAttribute("data-revision-id")).not.toMatch(/-head$/);

    expect(listConfigSets).toHaveBeenCalledWith("aurora");
    expect(repository.getTopology).toHaveBeenCalledWith("aurora", "dcs-default-aurora", "current", "effective");
    expect(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
  });

  it("hides toolchain compile diagnostics but keeps product governance errors", async () => {
    const repository = createRepository({
      getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
        const diagnostics =
          view === "effective"
            ? [
                {
                  code: "ranges_format",
                  message: "aurora-board.dts:525.9-30: Warning (ranges_format): empty ranges",
                  severity: "warning" as const
                },
                {
                  code: "TOPOLOGY_NOT_READY",
                  message: "拓扑尚未就绪，无法提交编辑。"
                }
              ]
            : [];
        if (view === "source") {
          return {
            view: "source" as const,
            revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
            configSetId: _configSetId,
            projectId: _projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          };
        }
        return {
          view: "effective" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: _configSetId,
          projectId: _projectId,
          status: "resolved",
          incompleteBase: false,
          diagnostics,
          nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
        };
      })
    });
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("region", { name: "DTS 参数工作台" });
    expect(screen.queryByText(/ranges_format/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/empty ranges/i)).not.toBeInTheDocument();
    expect(screen.getByText("拓扑尚未就绪，无法提交编辑。")).toBeVisible();
    expect(screen.getByRole("region", { name: "编译诊断" })).toBeVisible();
  });

  it("collapses dangling-reference diagnostics into one expandable summary", async () => {
    const repository = createRepository({
      getTopology: vi.fn(async (_projectId, _configSetId, revisionId, view) => {
        const diagnostics =
          view === "effective"
            ? [
                {
                  code: "dangling-reference",
                  severity: "warning" as const,
                  message:
                    'Overlay target "&amba" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
                },
                {
                  code: "dangling-reference",
                  severity: "warning" as const,
                  message:
                    'Overlay target "&charging_core" is not defined in the uploaded file set; its properties are attached to a synthetic anchor node so parameters stay manageable (full-tree resolution unavailable until the definition is provided)'
                }
              ]
            : [];
        if (view === "source") {
          return {
            view: "source" as const,
            revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
            configSetId: _configSetId,
            projectId: _projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          };
        }
        return {
          view: "effective" as const,
          revisionId: revisionId === "current" ? "rev-real-1" : revisionId,
          configSetId: _configSetId,
          projectId: _projectId,
          status: "resolved",
          incompleteBase: false,
          diagnostics,
          nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
        };
      })
    });
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("region", { name: "DTS 参数工作台" });
    const footer = screen.getByRole("region", { name: "解析提示" });
    expect(
      within(footer).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    ).toBeVisible();
    expect(screen.queryByText(/Overlay target "&amba"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[warning\]/)).not.toBeInTheDocument();

    fireEvent.click(
      within(footer).getByText(/2 个悬空 overlay 引用已自锚定，参数仍可管理/)
    );
    expect(within(footer).getByText("&amba")).toBeVisible();
    expect(within(footer).getByText("&charging_core")).toBeVisible();
  });

  it("hydrates binding drafts from listDrafts after reload and shows shared working tip tray", async () => {
    const sharedTip = "rev-shared-tip";
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "draft-gpio",
        projectId: "aurora",
        parameterId: "binding-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        candidateConfigRevisionId: sharedTip,
        targetValue: "<&gpio13 30 0>",
        action: "set" as const,
        reason: "Hydrated gpio draft",
        updatedAt: "2026-07-23T02:00:00.000Z"
      },
      {
        id: "draft-mt5788",
        projectId: "aurora",
        parameterId: "binding-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        candidateConfigRevisionId: sharedTip,
        targetValue: "<&gpio6 16 0>",
        action: "set" as const,
        reason: "Hydrated mt5788 draft",
        updatedAt: "2026-07-23T02:01:00.000Z"
      }
    ]);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    await waitFor(() => expect(listDrafts).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        sharedTip
      )
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
    expect(within(tray).getByText("Hydrated gpio draft")).toBeVisible();
    expect(within(tray).getByText("Hydrated mt5788 draft")).toBeVisible();
  });

  it("does not hydrate preferredRevision when reload drafts have mixed working tips", async () => {
    const listDrafts = vi.fn().mockResolvedValue([
      {
        id: "draft-gpio",
        projectId: "aurora",
        parameterId: "binding-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        candidateConfigRevisionId: "rev-tip-a",
        targetValue: "<&gpio13 30 0>",
        action: "set" as const,
        reason: "Hydrated gpio draft",
        updatedAt: "2026-07-23T02:00:00.000Z"
      },
      {
        id: "draft-mt5788",
        projectId: "aurora",
        parameterId: "binding-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        candidateConfigRevisionId: "rev-tip-b",
        targetValue: "<&gpio6 16 0>",
        action: "set" as const,
        reason: "Hydrated mt5788 draft",
        updatedAt: "2026-07-23T02:01:00.000Z"
      }
    ]);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    await waitFor(() => expect(listDrafts).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      )
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByRole("alert")).toHaveTextContent(/不在同一工作版本上.*无法一起提交/);
    expect(within(tray).getByText("提交 2 / 2 项")).toBeVisible();
    expect(within(tray).queryByText(/^本轮 2 项$/)).not.toBeInTheDocument();
  });

  it("shows empty state when no config set exists", async () => {
    const repository = createRepository();
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={async () => []}
      />
    );

    expect(
      await screen.findByText(/尚未上传项目 DTS/i)
    ).toBeVisible();
    expect(repository.getTopology).not.toHaveBeenCalled();
  });

  it("shows empty state when current revision is missing (404)", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const repository = createRepository({
      getTopology: vi.fn().mockRejectedValue(new WiseEffApiError("NOT_FOUND", "missing", {}, "req"))
    });

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "cs-1", name: "default" }]}
      />
    );

    expect(
      await screen.findByText(/尚未生成语义配置修订/i)
    ).toBeVisible();
  });

  it("calls createBindingDraft then reloads with candidate revision", async () => {
    const repository = createRepository();
    const { act, fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("treeitem", { name: /未分类 · sc8562/ })).toBeVisible();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create a typed binding draft" });

    await waitFor(() => {
      expect(repository.createBindingDraft).toHaveBeenCalledWith(
        "aurora",
        "binding-sc8562-gpio-int",
        expect.objectContaining({
          baseRevisionId: "rev-real-1",
          reason: "Create a typed binding draft"
        })
      );
    });

    await waitFor(() => {
      expect(repository.getTopology).toHaveBeenCalledWith(
        "aurora",
        "dcs-default-aurora",
        "rev-candidate-2",
        "effective"
      );
    });
  });

  it("drops the previous project's candidate revision and draft before loading the next project", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    const getTopology = vi.fn(async (projectId: string, configSetId: string, revisionId: string, view: "source" | "effective") => {
      if (projectId === "nebula" && revisionId === "rev-candidate-2") {
        throw new WiseEffApiError("NOT_FOUND", "foreign candidate revision", {}, "req-project-switch");
      }
      const resolvedRevisionId = revisionId === "current" ? `rev-${projectId}-current` : revisionId;
      return view === "source"
        ? {
            view: "source" as const,
            revisionId: resolvedRevisionId,
            configSetId,
            projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_SOURCE_NODES
          }
        : {
            view: "effective" as const,
            revisionId: resolvedRevisionId,
            configSetId,
            projectId,
            status: "resolved",
            incompleteBase: false,
            diagnostics: [],
            nodes: TOPOLOGY_TEACHING_EFFECTIVE_NODES
          };
    });
    const repository = createRepository({ getTopology });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const auroraWorkspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(auroraWorkspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(auroraWorkspace, fireEvent, { reason: "Create Aurora candidate before switching projects" });

    await screen.findByRole("region", { name: "参数修改提交" });
    await waitFor(() => {
      expect(getTopology).toHaveBeenCalledWith(
        "aurora",
        "dcs-default-aurora",
        "rev-candidate-2",
        "effective"
      );
    });

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(getTopology).toHaveBeenCalledWith(
        "nebula",
        "dcs-default-nebula",
        "current",
        "effective"
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-nebula-current"
      );
    });
    expect(getTopology).not.toHaveBeenCalledWith(
      "nebula",
      "dcs-default-nebula",
      "rev-candidate-2",
      "effective"
    );
  });

  it("ignores an Aurora draft response that resolves after switching to Nebula", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    let resolveDraft!: (value: Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>) => void;
    const draftPromise = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((resolve) => {
      resolveDraft = resolve;
    });
    const createBindingDraft = vi.fn(() => draftPromise);
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Aurora request must not leak" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledWith(
      "aurora",
      "binding-sc8562-gpio-int",
      expect.any(Object)
    ));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });

    await act(async () => {
      resolveDraft({
        draftId: "draft-aurora-late",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-late",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    });

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    expect(listWorkflowAssignees).not.toHaveBeenCalled();
    expect(repository.getTopology).not.toHaveBeenCalledWith(
      "nebula",
      "dcs-default-nebula",
      "rev-aurora-late",
      "effective"
    );
  });

  it("ignores a stale Aurora draft after switching Aurora to Nebula and back to Aurora", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const draftRequest = createDeferred<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>();
    const createBindingDraft = vi.fn()
      .mockImplementationOnce(() => draftRequest.promise)
      .mockResolvedValueOnce({
        draftId: "draft-aurora-current",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-current",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Stale Aurora draft must not return after switching back" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledWith(
      "aurora",
      "binding-sc8562-gpio-int",
      expect.any(Object)
    ));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    const auroraTopologyCalls = vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "aurora").length;

    await act(async () => {
      draftRequest.resolve({
        draftId: "draft-aurora-stale",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-stale",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
      await draftRequest.promise;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "aurora").length).toBe(auroraTopologyCalls);
    expect(repository.getTopology).not.toHaveBeenCalledWith(
      "aurora",
      "dcs-default-aurora",
      "rev-aurora-stale",
      "effective"
    );

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Current Aurora draft after stale response settled"
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数修改提交" })).toBeVisible());
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "rev-aurora-current"
    );
  });

  it("drops a stale Aurora draft error after switching back and releases only its draft lock", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const draftRequest = createDeferred<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>();
    const createBindingDraft = vi.fn()
      .mockImplementationOnce(() => draftRequest.promise)
      .mockResolvedValueOnce({
        draftId: "draft-aurora-current",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-aurora-current",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Stale Aurora error must not block current Aurora" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });

    await act(async () => {
      draftRequest.reject(new Error("Stale Aurora draft failed"));
      await draftRequest.promise.catch(() => undefined);
    });

    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(screen.queryByText("Stale Aurora draft failed")).not.toBeInTheDocument();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Current Aurora draft after stale error settled"
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "参数修改提交" })).toBeVisible());
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "rev-aurora-current"
    );
  });

  it("aligns same-project pending drafts to the shared working tip after create", async () => {
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-gpio",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-gpio",
        workingCandidateRevisionId: "working-tip-1",
        rebasedDraftIds: [],
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockResolvedValueOnce({
        draftId: "draft-status",
        parameterId: "binding-mt5788-gpio-int",
        candidateRevisionId: "candidate-mt5788",
        workingCandidateRevisionId: "working-tip-2",
        rebasedDraftIds: ["draft-gpio"],
        rawText: "<&gpio6 16 0>",
        action: "set" as const,
        parameterSpecId: "spec-mt5788-gpio-int",
        projectParameterBindingId: "binding-mt5788-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "mt5788" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({
      createBindingDraft,
      getSpec: vi.fn().mockImplementation(async (specId: string) => ({
        id: specId,
        organizationId: "org-chargelab",
        sourceKind: "vendor",
        specificationKey: specId,
        propertyKey: specId.includes("status") ? "status" : "gpio_int",
        driverModule: "sc8562",
        lifecycle: "active",
        currentVersionId: "spec-version-1",
        currentVersion: 1,
        displayName: specId.includes("status") ? "status" : "gpio_int",
        description: "",
        valueShape: null,
        schemaDefault: null,
        exampleValue: null,
        schemaNamespace: null,
        units: null,
        constraints: null,
        documentation: null,
        compatiblePatterns: null,
        policyTarget: null
      }))
    });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "First binding draft",
      rawValue: "<&gpio13 30 0>"
    });
    await screen.findByRole("region", { name: "参数修改提交" });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · mt5788/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Second binding draft",
      rawValue: "<&gpio6 16 0>",
      editButtonName: /编辑 gpio_int（未分类 · mt5788/
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText(/^本轮 2 项$/)).toBeVisible();
    expect(within(tray).queryByText("技术身份")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "working-tip-2"
    );
    const submitButton = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submitButton).toBeEnabled());
  });

  it("submits a typed binding draft with server-filtered role assignees", async () => {
    const repository = createRepository({
      createBindingDraft: vi.fn().mockResolvedValue({
        draftId: "draft-typed-1",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "rev-candidate-2",
        rawText: "<&gpio13 30 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
    });
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const onNavigate = vi.fn();
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
        onNavigate={onNavigate}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Raise gpio line for typed workflow", rawValue: "<&gpio13 30 0>" });

    const submission = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(submission).getByRole("heading", { name: "本轮已修改" })).toBeVisible();
    await waitFor(() => expect(listWorkflowAssignees).toHaveBeenCalledWith("aurora"));
    expect(await within(submission).findByLabelText("硬件 MDE")).toHaveValue("u-hw");
    expect(within(submission).getByLabelText("软件 MDE")).toHaveValue("u-sw");
    expect(within(submission).getByLabelText("软件开发")).toHaveValue("u-user");
    const submitButton = within(submission).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submitButton).toBeEnabled());
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitBindingChanges).toHaveBeenCalledWith({
        projectId: "aurora",
        items: [
          {
            draftId: "draft-typed-1",
            action: "set",
            targetValue: "<&gpio13 30 0>",
            reason: "Raise gpio line for typed workflow",
            projectParameterBindingId: "binding-sc8562-gpio-int",
            parameterSpecId: "spec-sc8562-gpio-int",
            editSubjectKind: "binding"
          }
        ],
        assignees: {
          hardwareCommitterId: "u-hw",
          softwareCommitterId: "u-sw",
          softwareUserId: "u-user"
        }
      });
    });
    // Consumed drafts leave the tray; the success notice keeps the review entry.
    const successNotice = await screen.findByRole("region", { name: "参数提交结果" });
    expect(within(successNotice).getByRole("status")).toHaveTextContent(/已提交正式审核（1 项）/);
    fireEvent.click(within(successNotice).getByRole("button", { name: "查看变更审阅" }));
    expect(onNavigate).toHaveBeenCalledWith("/parameter-review");
  });

  it("replaces a draft for the same binding and keeps the original binding value in the current-edits diff", async () => {
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-first",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-first",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockResolvedValueOnce({
        draftId: "draft-replacement",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-replacement",
        rawText: "<&gpio13 31 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
    const repository = createRepository({ createBindingDraft });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={vi.fn().mockResolvedValue(undefined)}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "First typed change", rawValue: "<&gpio13 30 0>" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute("data-revision-id", "candidate-first"));

    const replacementWorkspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(replacementWorkspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(replacementWorkspace, fireEvent, { reason: "Replacement typed change", rawValue: "<&gpio13 31 0>" });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-replacement"
      );
    });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const diff = within(tray).getByLabelText("gpio_int 值变更");
    expect(within(diff).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(within(diff).getByText("<&gpio13 31 0>")).toBeVisible();
    expect(within(tray).queryByText("candidate-first")).not.toBeInTheDocument();
    expect(within(tray).queryByText("技术身份")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "candidate-replacement"
    );
    expect(within(tray).getByText(/^本轮 1 项$/)).toBeVisible();
  });

  it("locks only the submitting project until the real submit mutation settles", async () => {
    let resolveSubmit!: () => void;
    const pendingSubmit = new Promise<void>((resolve) => {
      resolveSubmit = resolve;
    });
    const submitBindingChanges = vi.fn(() => pendingSubmit);
    const createBindingDraft = vi.fn().mockResolvedValue({
      draftId: "draft-project-lock",
      parameterId: "binding-sc8562-gpio-int",
      candidateRevisionId: "candidate-project-lock",
      rawText: "<&gpio13 30 0>",
      action: "set" as const,
      parameterSpecId: "spec-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
      overlayFileId: "file-overlay",
      overlayFileName: "overlay.dts"
    });
    const repository = createRepository({ createBindingDraft });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { act, fireEvent } = await import("@testing-library/react");
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Lock Aurora while submitting", rawValue: "<&gpio13 30 0>" });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const submit = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(submitBindingChanges).toHaveBeenCalledTimes(1);
    expect(within(tray).getByRole("button", { name: "移出本轮修改" })).toBeDisabled();
    expect(within(tray).getByLabelText("硬件 MDE")).toBeDisabled();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    fireEvent.click(within(workspace).getByRole("button", { name: /查看 gpio_int（未分类 · sc8562/ }));
    const detail = screen.getByRole("dialog", { name: /参数详情/ });
    expect(within(detail).queryByLabelText("目标值")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /加入草稿/ })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();
    expect(createBindingDraft).toHaveBeenCalledTimes(1);

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    await waitFor(() => {
      expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();
    });
  });

  it("blocks formal submit while a delayed replacement draft mutation owns the project lock", async () => {
    let resolveReplacement!: (value: Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>) => void;
    const replacementRequest = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((resolve) => {
      resolveReplacement = resolve;
    });
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-reused",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-first",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockImplementationOnce(() => replacementRequest);
    const repository = createRepository({ createBindingDraft });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const listWorkflowAssignees = vi.fn().mockResolvedValue({
      hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
      softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
      softwareUsers: [{ id: "u-user", name: "Software Merger" }]
    });
    const { act, fireEvent } = await import("@testing-library/react");
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create first draft", rawValue: "<&gpio13 30 0>" });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-first"
      );
    });
    await screen.findByRole("region", { name: "参数修改提交" });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Delayed replacement",
      rawValue: "<&gpio13 31 0>"
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    let tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    const blockedSubmit = within(tray).getByText(/^提交审核/).closest("button") as HTMLButtonElement;
    expect(blockedSubmit).toBeDisabled();
    expect(within(tray).getByRole("alert", { hidden: true })).toHaveTextContent(/正在创建 typed draft/);
    fireEvent.click(blockedSubmit);
    expect(submitBindingChanges).not.toHaveBeenCalled();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();
    expect(createBindingDraft).toHaveBeenCalledTimes(2);

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).toBeEnabled();

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        listWorkflowAssignees={listWorkflowAssignees}
        submitBindingChanges={submitBindingChanges}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int（未分类 · sc8562/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveReplacement({
        draftId: "draft-reused",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-replacement",
        rawText: "<&gpio13 31 0>",
        action: "set",
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      });
      await replacementRequest;
    });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
    expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    expect(screen.queryByText("candidate-replacement")).not.toBeInTheDocument();
    expect(submitBindingChanges).not.toHaveBeenCalled();
  });

  it("releases the project mutation lock when replacement draft creation rejects", async () => {
    let rejectReplacement!: (error: Error) => void;
    const replacementRequest = new Promise<Awaited<ReturnType<ParameterTopologyRepository["createBindingDraft"]>>>((_resolve, reject) => {
      rejectReplacement = reject;
    });
    const createBindingDraft = vi.fn()
      .mockResolvedValueOnce({
        draftId: "draft-existing",
        parameterId: "binding-sc8562-gpio-int",
        candidateRevisionId: "candidate-existing",
        rawText: "<&gpio13 30 0>",
        action: "set" as const,
        parameterSpecId: "spec-sc8562-gpio-int",
        projectParameterBindingId: "binding-sc8562-gpio-int",
        writeTarget: { role: "overlay", propertyKey: "gpio_int", targetRef: "sc8562" },
        overlayFileId: "file-overlay",
        overlayFileName: "overlay.dts"
      })
      .mockImplementationOnce(() => replacementRequest);
    const repository = createRepository({ createBindingDraft });
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const { act, fireEvent } = await import("@testing-library/react");
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    let workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, { reason: "Create existing draft" });
    await screen.findByRole("region", { name: "参数修改提交" });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "candidate-existing"
      );
    });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Replacement must reject",
      rawValue: "<&gpio13 31 0>"
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    let tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    expect(within(tray).getByRole("button", { name: /^提交审核/, hidden: true })).toBeDisabled();

    await act(async () => {
      rejectReplacement(new Error("replacement rejected"));
      await replacementRequest.catch(() => undefined);
    });
    tray = screen.getByRole("region", { name: "参数修改提交", hidden: true });
    const submit = within(tray).getByText(/^提交审核/).closest("button") as HTMLButtonElement;
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
  });

  it("does not render a toolbar revision-validate action", async () => {
    const repository = createRepository();
    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workspace).queryByRole("button", { name: "校验" })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
    expect(repository.validateRevision).not.toHaveBeenCalled();
  });

  it("deletes the server draft on tray removal and refreshes the draft list", async () => {
    const serverDraft = {
      id: "draft-server-1",
      projectId: "aurora",
      parameterId: "binding-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-real-1",
      targetValue: "<&gpio13 30 0>",
      action: "set" as const,
      reason: "Server draft to delete",
      updatedAt: "2026-08-01T02:00:00.000Z"
    };
    const listDrafts = vi.fn()
      .mockResolvedValueOnce([serverDraft])
      .mockResolvedValue([]);
    const deleteDraft = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={deleteDraft}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    expect(within(tray).getByText("Server draft to delete")).toBeVisible();

    fireEvent.click(within(tray).getByRole("button", { name: "移出本轮修改" }));

    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("draft-server-1"));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    // Draft list is re-read from the server so a reload cannot revive the deleted draft.
    await waitFor(() => expect(listDrafts.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("keeps the draft and shows an inline error when server draft delete fails", async () => {
    const serverDraft = {
      id: "draft-server-1",
      projectId: "aurora",
      parameterId: "binding-sc8562-gpio-int",
      projectParameterBindingId: "binding-sc8562-gpio-int",
      candidateConfigRevisionId: "rev-real-1",
      targetValue: "<&gpio13 30 0>",
      action: "set" as const,
      reason: "Draft delete must fail visibly",
      updatedAt: "2026-08-01T02:00:00.000Z"
    };
    const listDrafts = vi.fn().mockResolvedValue([serverDraft]);
    const deleteDraft = vi.fn().mockRejectedValue(new Error("server offline"));
    const repository = createRepository();

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={deleteDraft}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
      />
    );

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    fireEvent.click(within(tray).getByRole("button", { name: "移出本轮修改" }));

    await waitFor(() => expect(deleteDraft).toHaveBeenCalledWith("draft-server-1"));
    expect(await within(tray).findByText(/移除草稿失败/)).toBeVisible();
    expect(within(tray).getByText("Draft delete must fail visibly")).toBeVisible();
  });

  it("clears the tray after a successful submit so consumed draft ids cannot be resubmitted", async () => {
    const listDrafts = vi.fn().mockResolvedValue([]);
    const submitBindingChanges = vi.fn().mockResolvedValue(undefined);
    const repository = createRepository();
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
        listDrafts={listDrafts}
        deleteDraft={vi.fn()}
        listWorkflowAssignees={vi.fn().mockResolvedValue({
          hardwareCommitters: [{ id: "u-hw", name: "Hardware Reviewer" }],
          softwareCommitters: [{ id: "u-sw", name: "Software Reviewer" }],
          softwareUsers: [{ id: "u-user", name: "Software Merger" }]
        })}
        submitBindingChanges={submitBindingChanges}
      />
    );

    await screen.findByRole("treeitem", { name: /未分类 · sc8562/ });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Submit then clear",
      rawValue: "<&gpio13 30 0>"
    });

    const tray = await screen.findByRole("region", { name: "参数修改提交" });
    const submit = within(tray).getByRole("button", { name: /^提交审核/ });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(submit).toHaveTextContent("提交审核（1 项）");
    fireEvent.click(submit);

    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(screen.queryByRole("region", { name: "参数修改提交" })).not.toBeInTheDocument();
    });
    // The workspace returns to the current revision once the round is consumed.
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
  });

  it("loads project-primary DTS in tech view via parameter file repository", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);
    const parameterFileRepository = {
      listFiles: vi.fn().mockResolvedValue([
        {
          id: "file-board",
          projectId: "aurora",
          fileName: "aurora-board.dts",
          format: "dts",
          enabled: true,
          currentVersionId: "ver-1",
          currentVersionNumber: 2,
          updatedAt: "2026-01-01T00:00:00.000Z"
        }
      ]),
      downloadVersion: vi.fn().mockResolvedValue({
        contentType: "text/plain",
        fileName: "aurora-board.dts",
        bytes: new TextEncoder().encode('/ {\n  board_id = "aurora";\n};')
      })
    } as unknown as ParameterFileRepository;
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        topologyRepository={repository}
        listConfigSets={listConfigSets}
        parameterFileRepository={parameterFileRepository}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "技术视图" }));

    await waitFor(() => expect(parameterFileRepository.listFiles).toHaveBeenCalledWith("aurora"));
    await waitFor(() =>
      expect(parameterFileRepository.downloadVersion).toHaveBeenCalledWith("aurora", "file-board", "ver-1")
    );
    expect(screen.getByRole("tree", { name: "业务模块树" })).toBeInTheDocument();
    expect(screen.queryByRole("tree", { name: "生效 DTS 拓扑" })).not.toBeInTheDocument();
    expect(screen.queryByText(/aurora-board\.dts · v2/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("DTS 源码")).toBeInTheDocument();
  });
});
