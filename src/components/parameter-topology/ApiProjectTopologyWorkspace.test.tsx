import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import {
  TOPOLOGY_TEACHING_BINDINGS,
  TOPOLOGY_TEACHING_EFFECTIVE_NODES,
  TOPOLOGY_TEACHING_SOURCE_NODES
} from "./topologyTeachingFixtures";
import { ApiProjectTopologyWorkspace } from "./ApiProjectTopologyWorkspace";

afterEach(() => {
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
  const editName = input.editButtonName ?? /编辑 gpio_int/;
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

function createOpenMappingTask(projectId: string): IdentityMappingTask {
  return {
    id: `map-${projectId}`,
    projectId,
    configRevisionId: "rev-real-1",
    previousLogicalNodeId: "logical-old",
    candidateLogicalNodeIds: ["logical-sc8562", "logical-mt5788"],
    status: "open",
    reason: "ambiguous",
    createdAt: "2026-07-16T00:00:00.000Z",
    evidence: {
      previousNodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
      evidence: ["unit-address"],
      candidates: [
        {
          logicalNodeId: "logical-sc8562",
          nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
          name: "sc8562"
        },
        {
          logicalNodeId: "logical-mt5788",
          nodeLocator: "/amba/i2c@FDF5E000/mt5788@55",
          name: "mt5788"
        }
      ]
    }
  };
}

describe("ApiProjectTopologyWorkspace", () => {
  it("loads real config set and current revision — never teaching ids", async () => {
    const repository = createRepository();
    const listConfigSets = vi.fn().mockResolvedValue([{ id: "dcs-default-aurora", name: "default" }]);

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
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

    await screen.findByRole("region", { name: "绑定变更提交" });
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
      expect(screen.queryByRole("region", { name: "绑定变更提交" })).not.toBeInTheDocument();
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
      expect(screen.queryByRole("region", { name: "绑定变更提交" })).not.toBeInTheDocument();
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

    expect(screen.queryByRole("region", { name: "绑定变更提交" })).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole("region", { name: "绑定变更提交" })).toBeVisible());
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

    expect(screen.queryByRole("region", { name: "绑定变更提交" })).not.toBeInTheDocument();
    expect(screen.queryByText("Stale Aurora draft failed")).not.toBeInTheDocument();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Current Aurora draft after stale error settled"
    });
    await waitFor(() => expect(screen.getByRole("region", { name: "绑定变更提交" })).toBeVisible());
    expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
      "data-revision-id",
      "rev-aurora-current"
    );
  });

  it("clears project-scoped mapping feedback when switching projects", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const repository = createRepository({
      listMappingTasks: vi.fn(async (projectId: string) =>
        projectId === "aurora"
          ? [
              {
                id: "map-project-switch",
                projectId: "aurora",
                configRevisionId: "rev-real-1",
                previousLogicalNodeId: "logical-old",
                candidateLogicalNodeIds: ["logical-sc8562"],
                status: "open" as const,
                reason: "ambiguous",
                createdAt: "2026-07-18T00:00:00.000Z",
                evidence: {
                  previousNodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
                  evidence: ["unit-address"],
                  candidates: [
                    {
                      logicalNodeId: "logical-sc8562",
                      nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
                      name: "sc8562"
                    }
                  ]
                }
              }
            ]
          : []
      ),
      resolveMapping: vi.fn().mockResolvedValue(undefined)
    });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Confirm Aurora identity" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));
    expect(await screen.findByText(/映射已确认/)).toBeVisible();

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("region", { name: "DTS 参数工作台" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
    expect(screen.queryByText(/映射已确认/)).not.toBeInTheDocument();
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
    await screen.findByRole("region", { name: "绑定变更提交" });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · mt5788/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Second binding draft",
      rawValue: "<&gpio6 16 0>",
      editButtonName: /编辑 gpio_int/
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    const tray = await screen.findByRole("region", { name: "绑定变更提交" });
    expect(within(tray).getByText(/本轮 2 项 · 同一工作版本/)).toBeVisible();
    expect(within(tray).getAllByText("working-tip-2")).toHaveLength(2);
    const submitButton = within(tray).getByRole("button", { name: "提交审核" });
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

    const submission = await screen.findByRole("region", { name: "绑定变更提交" });
    expect(within(submission).getByRole("heading", { name: "本轮已修改" })).toBeVisible();
    await waitFor(() => expect(listWorkflowAssignees).toHaveBeenCalledWith("aurora"));
    expect(await within(submission).findByLabelText("硬件 MDE")).toHaveValue("u-hw");
    expect(within(submission).getByLabelText("软件 MDE")).toHaveValue("u-sw");
    expect(within(submission).getByLabelText("软件开发")).toHaveValue("u-user");
    const submitButton = within(submission).getByRole("button", { name: "提交审核" });
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
            parameterSpecId: "spec-sc8562-gpio-int"
          }
        ],
        assignees: {
          hardwareCommitterId: "u-hw",
          softwareCommitterId: "u-sw",
          softwareUserId: "u-user"
        }
      });
    });
    fireEvent.click(within(submission).getByRole("button", { name: "查看审核队列" }));
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

    const tray = await screen.findByRole("region", { name: "绑定变更提交" });
    const diff = within(tray).getByLabelText("gpio_int 值变更");
    expect(within(diff).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(within(diff).getByText("<&gpio13 31 0>")).toBeVisible();
    expect(within(tray).queryByText("candidate-first")).not.toBeInTheDocument();
    fireEvent.click(within(tray).getByText("技术身份"));
    expect(within(tray).getByText("candidate-replacement")).toBeVisible();
    expect(within(tray).getByText(/本轮 1 项 · 同一工作版本/)).toBeVisible();
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

    const tray = await screen.findByRole("region", { name: "绑定变更提交" });
    const submit = within(tray).getByRole("button", { name: "提交审核" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(submitBindingChanges).toHaveBeenCalledTimes(1);
    expect(within(tray).getByRole("button", { name: "移出本轮修改" })).toBeDisabled();
    expect(within(tray).getByLabelText("硬件 MDE")).toBeDisabled();

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    fireEvent.click(within(workspace).getByRole("button", { name: /查看 gpio_int/ }));
    const detail = screen.getByRole("dialog", { name: /参数详情/ });
    expect(within(detail).queryByLabelText("目标值")).not.toBeInTheDocument();
    expect(within(detail).queryByRole("button", { name: /加入草稿/ })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();
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
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int/ })).toBeEnabled();

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
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    await waitFor(() => {
      expect(within(workspace).getByRole("button", { name: /编辑 gpio_int/ })).toBeEnabled();
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
    await screen.findByRole("region", { name: "绑定变更提交" });

    workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /未分类 · sc8562/ }));
    await createGpioDraftFromWorkbench(workspace, fireEvent, {
      reason: "Delayed replacement",
      rawValue: "<&gpio13 31 0>"
    });
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    let tray = screen.getByRole("region", { name: "绑定变更提交", hidden: true });
    const blockedSubmit = within(tray).getByText("提交审核").closest("button") as HTMLButtonElement;
    expect(blockedSubmit).toBeDisabled();
    expect(within(tray).getByRole("alert", { hidden: true })).toHaveTextContent(/正在创建 typed draft/);
    fireEvent.click(blockedSubmit);
    expect(submitBindingChanges).not.toHaveBeenCalled();
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();
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
    expect(within(workspace).getByRole("button", { name: /编辑 gpio_int/ })).toBeEnabled();

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
    expect(within(workspace).queryByRole("button", { name: /编辑 gpio_int/ })).not.toBeInTheDocument();

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
    expect(screen.queryByRole("region", { name: "绑定变更提交" })).not.toBeInTheDocument();
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
    await screen.findByRole("region", { name: "绑定变更提交" });
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
    let tray = screen.getByRole("region", { name: "绑定变更提交", hidden: true });
    expect(within(tray).getByRole("button", { name: "提交审核", hidden: true })).toBeDisabled();

    await act(async () => {
      rejectReplacement(new Error("replacement rejected"));
      await replacementRequest.catch(() => undefined);
    });
    tray = screen.getByRole("region", { name: "绑定变更提交", hidden: true });
    const submit = within(tray).getByText("提交审核").closest("button") as HTMLButtonElement;
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
  });

  it("publish calls fail-closed validateRevision", async () => {
    const repository = createRepository();
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" })).toBeEnabled();
    });
    const workspace = screen.getByRole("region", { name: "DTS 参数工作台" });
    expect(within(workspace).queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole("button", { name: "校验" }));

    await waitFor(() => {
      expect(repository.validateRevision).toHaveBeenCalledWith("aurora", "rev-real-1");
    });
    expect(await screen.findByText(/校验通过|发布条件/)).toBeVisible();
  });

  it("ignores a late successful validate response after switching projects", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const validateRequest = createDeferred<{
      id: string;
      status: "passed";
      stage: "toolchain";
    }>();
    const validateRevision = vi.fn(() => validateRequest.promise);
    const repository = createRepository({ validateRevision });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" })).toBeEnabled();
    });
    fireEvent.click(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" }));
    expect(validateRevision).toHaveBeenCalledWith("aurora", "rev-real-1");

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        canPublish
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

    await act(async () => {
      validateRequest.resolve({ id: "validate-aurora-late", status: "passed", stage: "toolchain" });
      await validateRequest.promise;
    });

    expect(screen.queryByText("校验通过，修订已具备发布条件。")).not.toBeInTheDocument();
  });

  it("ignores a late failed validate response after switching projects", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const validateRequest = createDeferred<never>();
    const validateRevision = vi.fn(() => validateRequest.promise);
    const repository = createRepository({ validateRevision });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" })).toBeEnabled();
    });
    fireEvent.click(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" }));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        canPublish
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

    await act(async () => {
      validateRequest.reject(new Error("Aurora validate failed late"));
      await validateRequest.promise.catch(() => undefined);
    });

    expect(screen.queryByText("Aurora validate failed late")).not.toBeInTheDocument();
  });

  it("uses project generation, not only project id, for an Aurora-B-Nebula-Aurora switch", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const validateRequest = createDeferred<{
      id: string;
      status: "passed";
      stage: "toolchain";
    }>();
    const validateRevision = vi.fn(() => validateRequest.promise);
    const repository = createRepository({ validateRevision });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    await waitFor(() => {
      expect(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" })).toBeEnabled();
    });
    fireEvent.click(within(screen.getByRole("region", { name: "DTS 参数工作台" })).getByRole("button", { name: "校验" }));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
        canEdit
        canPublish
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
        canPublish
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
      validateRequest.resolve({ id: "validate-aurora-stale", status: "passed", stage: "toolchain" });
      await validateRequest.promise;
    });

    expect(screen.queryByText("校验通过，修订已具备发布条件。")).not.toBeInTheDocument();
  });

  it("ignores a late successful mapping response after switching projects", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const mappingRequest = createDeferred<void>();
    const resolveMapping = vi.fn(() => mappingRequest.promise);
    const repository = createRepository({
      listMappingTasks: vi.fn(async (projectId: string) =>
        projectId === "aurora" ? [createOpenMappingTask(projectId)] : []
      ),
      resolveMapping
    });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Confirm Aurora identity" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));
    await waitFor(() => {
      expect(resolveMapping).toHaveBeenCalledWith("map-aurora", {
        decision: "resolved",
        selectedLogicalNodeId: "logical-sc8562",
        reason: "Confirm Aurora identity"
      });
    });

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
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
    const nebulaTopologyCalls = vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "nebula").length;

    await act(async () => {
      mappingRequest.resolve();
      await mappingRequest.promise;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText(/映射已确认，正在刷新拓扑/)).not.toBeInTheDocument();
    expect(vi.mocked(repository.getTopology).mock.calls.filter(([requestProjectId]) => requestProjectId === "nebula").length).toBe(nebulaTopologyCalls);
  });

  it("ignores a late failed mapping response after switching projects", async () => {
    const { act, fireEvent } = await import("@testing-library/react");
    const mappingRequest = createDeferred<never>();
    const resolveMapping = vi.fn(() => mappingRequest.promise);
    const repository = createRepository({
      listMappingTasks: vi.fn(async (projectId: string) =>
        projectId === "aurora" ? [createOpenMappingTask(projectId)] : []
      ),
      resolveMapping
    });
    const listConfigSets = vi.fn(async (projectId: string) => [
      { id: `dcs-default-${projectId}`, name: "default" }
    ]);
    const { rerender } = render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        topologyRepository={repository}
        listConfigSets={listConfigSets}
      />
    );

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Reject Aurora identity" }
    });
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));
    await waitFor(() => expect(resolveMapping).toHaveBeenCalledWith("map-aurora", expect.any(Object)));

    rerender(
      <ApiProjectTopologyWorkspace
        projectId="nebula"
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

    await act(async () => {
      mappingRequest.reject(new Error("Aurora mapping failed late"));
      await mappingRequest.promise.catch(() => undefined);
    });

    expect(screen.queryByText("Aurora mapping failed late")).not.toBeInTheDocument();
  });

  it("resolves identity mapping then reloads topology", async () => {
    const repository = createRepository({
      listMappingTasks: vi.fn().mockResolvedValue([
        {
          id: "map-1",
          projectId: "aurora",
          configRevisionId: "rev-real-1",
          previousLogicalNodeId: "logical-old",
          candidateLogicalNodeIds: ["logical-sc8562", "logical-mt5788"],
          status: "open",
          reason: "ambiguous",
          createdAt: "2026-07-16T00:00:00.000Z",
          evidence: {
            previousNodeLocator: "/amba/i2c@FDF5E000/sc8562@6E",
            evidence: ["unit-address"],
            candidates: [
              { logicalNodeId: "logical-sc8562", nodeLocator: "/amba/i2c@FDF5E000/sc8562@6E", name: "sc8562" },
              { logicalNodeId: "logical-mt5788", nodeLocator: "/amba/i2c@FDF5E000/mt5788@55", name: "mt5788" }
            ]
          }
        }
      ]),
      resolveMapping: vi.fn().mockResolvedValue(undefined)
    });
    const { fireEvent } = await import("@testing-library/react");

    render(
      <ApiProjectTopologyWorkspace
        projectId="aurora"
        canEdit
        canPublish
        topologyRepository={repository}
        listConfigSets={async () => [{ id: "dcs-default-aurora", name: "default" }]}
      />
    );

    const review = await screen.findByRole("region", { name: "映射审核" });
    fireEvent.change(within(review).getByRole("combobox", { name: "选择映射候选" }), {
      target: { value: "logical-sc8562" }
    });
    fireEvent.change(within(review).getByLabelText("映射确认原因"), {
      target: { value: "Same board instance" }
    });
    const topologyCallsBefore = vi.mocked(repository.getTopology).mock.calls.length;
    fireEvent.click(within(review).getByRole("button", { name: "确认映射" }));

    await waitFor(() => {
      expect(repository.resolveMapping).toHaveBeenCalledWith("map-1", {
        decision: "resolved",
        selectedLogicalNodeId: "logical-sc8562",
        reason: "Same board instance"
      });
    });
    await waitFor(() => {
      expect(vi.mocked(repository.getTopology).mock.calls.length).toBeGreaterThan(topologyCallsBefore);
    });
  });
});
