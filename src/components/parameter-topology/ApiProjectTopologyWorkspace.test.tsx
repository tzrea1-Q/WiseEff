import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
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
    getSpec: vi.fn(),
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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(workspace).toHaveAttribute("data-revision-id", "rev-real-1");
    expect(workspace.getAttribute("data-config-set-id")).not.toMatch(/-default-config$/);
    expect(workspace.getAttribute("data-revision-id")).not.toMatch(/-head$/);

    expect(listConfigSets).toHaveBeenCalledWith("aurora");
    expect(repository.getTopology).toHaveBeenCalledWith("aurora", "dcs-default-aurora", "current", "effective");
    expect(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ })).toBeVisible();
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
      await screen.findByText(/尚未创建 Config Set/i)
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
      expect(within(screen.getByRole("region", { name: "项目拓扑工作区" })).getByRole("treeitem", { name: /sc8562@6E/ })).toBeVisible();
    });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    const detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Create a typed binding draft" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/i }));

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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    const auroraWorkspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(auroraWorkspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(auroraWorkspace).getByRole("cell", { name: "gpio_int" }));
    const detail = within(auroraWorkspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Create Aurora candidate before switching projects" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/i }));

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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    const detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Aurora request must not leak" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/i }));
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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-revision-id",
        "rev-real-1"
      );
    });
    expect(screen.queryByText(/映射已确认/)).not.toBeInTheDocument();
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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    const detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 30 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Raise gpio line for typed workflow" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));

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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    const detail = within(workspace).getByRole("region", { name: "绑定详情" });

    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 30 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "First typed change" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(workspace).toHaveAttribute("data-revision-id", "candidate-first"));

    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 31 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Replacement typed change" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-revision-id",
        "candidate-replacement"
      );
    });

    const tray = await screen.findByRole("region", { name: "绑定变更提交" });
    const diff = within(tray).getByLabelText("gpio_int 值变更");
    expect(within(diff).getByText("<&gpio13 29 0>")).toBeVisible();
    expect(within(diff).getByText("<&gpio13 31 0>")).toBeVisible();
    expect(within(tray).queryByText("candidate-first")).not.toBeInTheDocument();
    expect(within(tray).getByText("candidate-replacement")).toBeVisible();
    expect(within(tray).getByText("1 项")).toBeVisible();
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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    let workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    let detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 30 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Lock Aurora while submitting" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));

    const tray = await screen.findByRole("region", { name: "绑定变更提交" });
    const submit = within(tray).getByRole("button", { name: "提交审核" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    expect(submitBindingChanges).toHaveBeenCalledTimes(1);
    expect(within(tray).getByRole("button", { name: "移出本轮修改" })).toBeDisabled();
    expect(within(tray).getByLabelText("硬件 MDE")).toBeDisabled();

    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    detail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(within(detail).getByLabelText("目标值 raw")).toBeDisabled();
    expect(within(detail).getByRole("button", { name: /创建草稿/ })).toBeDisabled();
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getAllByRole("cell", { name: "gpio_int" })[0]);
    const nebulaDetail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(within(nebulaDetail).getByLabelText("目标值 raw")).toBeEnabled();

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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getAllByRole("cell", { name: "gpio_int" })[0]);
    const lockedAuroraDetail = within(workspace).getByRole("region", { name: "绑定详情" });
    expect(within(lockedAuroraDetail).getByLabelText("目标值 raw")).toBeDisabled();

    await act(async () => {
      resolveSubmit();
      await pendingSubmit;
    });
    await waitFor(() => {
      expect(within(lockedAuroraDetail).getByLabelText("目标值 raw")).toBeEnabled();
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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    let workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    let detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 30 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Create first draft" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-revision-id",
        "candidate-first"
      );
    });
    await screen.findByRole("region", { name: "绑定变更提交" });

    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 31 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Delayed replacement" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));

    let tray = screen.getByRole("region", { name: "绑定变更提交" });
    const blockedSubmit = within(tray).getByRole("button", { name: "提交审核" });
    expect(blockedSubmit).toBeDisabled();
    expect(within(tray).getByRole("alert")).toHaveTextContent(/正在创建 typed draft/);
    fireEvent.click(blockedSubmit);
    expect(submitBindingChanges).not.toHaveBeenCalled();
    expect(within(detail).getByRole("button", { name: /创建中/ })).toBeDisabled();
    fireEvent.click(within(detail).getByRole("button", { name: /创建中/ }));
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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-nebula"
      );
    });
    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getAllByRole("cell", { name: "gpio_int" })[0]);
    expect(within(workspace).getByLabelText("目标值 raw")).toBeEnabled();

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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-config-set-id",
        "dcs-default-aurora"
      );
    });
    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getAllByRole("cell", { name: "gpio_int" })[0]);
    expect(within(workspace).getByLabelText("目标值 raw")).toBeDisabled();

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
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-revision-id",
        "candidate-replacement"
      );
    });
    tray = await screen.findByRole("region", { name: "绑定变更提交" });
    expect(within(tray).getByText("candidate-replacement")).toBeVisible();
    const replacementSubmit = within(tray).getByRole("button", { name: "提交审核" });
    await waitFor(() => expect(replacementSubmit).toBeEnabled());
    fireEvent.click(replacementSubmit);
    await waitFor(() => expect(submitBindingChanges).toHaveBeenCalledTimes(1));
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

    await screen.findByRole("treeitem", { name: /sc8562@6E/ });
    let workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    fireEvent.click(within(workspace).getByRole("treeitem", { name: /sc8562@6E/ }));
    fireEvent.click(within(workspace).getByRole("cell", { name: "gpio_int" }));
    let detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Create existing draft" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await screen.findByRole("region", { name: "绑定变更提交" });
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "项目拓扑工作区" })).toHaveAttribute(
        "data-revision-id",
        "candidate-existing"
      );
    });

    workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    detail = within(workspace).getByRole("region", { name: "绑定详情" });
    fireEvent.change(within(detail).getByLabelText("目标值 raw"), {
      target: { value: "<&gpio13 31 0>" }
    });
    fireEvent.change(within(detail).getByLabelText("修改原因"), {
      target: { value: "Replacement must reject" }
    });
    fireEvent.click(within(detail).getByRole("button", { name: /创建草稿/ }));
    await waitFor(() => expect(createBindingDraft).toHaveBeenCalledTimes(2));
    let tray = screen.getByRole("region", { name: "绑定变更提交" });
    expect(within(tray).getByRole("button", { name: "提交审核" })).toBeDisabled();

    await act(async () => {
      rejectReplacement(new Error("replacement rejected"));
      await replacementRequest.catch(() => undefined);
    });
    tray = screen.getByRole("region", { name: "绑定变更提交" });
    const submit = within(tray).getByRole("button", { name: "提交审核" });
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
      expect(within(screen.getByRole("region", { name: "项目拓扑工作区" })).getByRole("button", { name: "校验" })).toBeEnabled();
    });
    const workspace = screen.getByRole("region", { name: "项目拓扑工作区" });
    expect(within(workspace).queryByRole("button", { name: "发布" })).not.toBeInTheDocument();
    fireEvent.click(within(workspace).getByRole("button", { name: "校验" }));

    await waitFor(() => {
      expect(repository.validateRevision).toHaveBeenCalledWith("aurora", "rev-real-1");
    });
    expect(await screen.findByText(/校验通过|发布条件/)).toBeVisible();
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
