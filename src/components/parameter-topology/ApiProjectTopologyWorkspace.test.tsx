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
    const { fireEvent } = await import("@testing-library/react");

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
    fireEvent.click(within(detail).getByRole("button", { name: /校验|应用诊断/i }));

    await waitFor(() => {
      expect(repository.createBindingDraft).toHaveBeenCalledWith(
        "aurora",
        "binding-sc8562-gpio-int",
        expect.objectContaining({
          baseRevisionId: "rev-real-1",
          reason: expect.any(String)
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
