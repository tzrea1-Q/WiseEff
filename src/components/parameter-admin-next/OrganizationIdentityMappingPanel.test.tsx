import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialParameterAdminState } from "@/application/parameters/parameterAdminState";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { OrganizationIdentityMappingPanel } from "./OrganizationIdentityMappingPanel";
import { ParameterAdminProvider } from "./ParameterAdminProvider";

const stubTopology = {
  listMappingTasks: vi.fn(),
};

const stubModules = {
  getRegistry: vi.fn(),
  createModule: vi.fn(),
  updateModule: vi.fn(),
  deleteModule: vi.fn(),
  listDriverRegistry: vi.fn()
};

describe("OrganizationIdentityMappingPanel", () => {
  beforeEach(() => {
    stubTopology.listMappingTasks.mockReset();
  });

  it("announces loading and lets the user retry a failed evidence read into the shared empty state", async () => {
    const user = userEvent.setup();
    stubTopology.listMappingTasks.mockRejectedValueOnce(new Error("transport failed")).mockResolvedValue([]);
    render(<ParameterAdminProvider topology={stubTopology as never} moduleRegistry={stubModules as never}>
      <OrganizationIdentityMappingPanel />
    </ParameterAdminProvider>);
    expect(screen.getByRole("status", { name: PARAMETER_ADMIN_UI.identityMappingLoading })).toBeVisible();
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("transport failed");
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText(PARAMETER_ADMIN_UI.identityMappingEmpty)).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("新的未知或歧义证据请前往规范审核队列查看。")).toBeVisible();
  });

  it("keeps unresolved historical evidence and resolved history read-only without name inference", async () => {
    const tasks: IdentityMappingTask[] = ["open", "resolved", "dismissed", "new_identity"].map(
      (status, index) => ({
        id: `historical-task-${index}`,
        projectId: "project-1",
        configRevisionId: "revision-1",
        previousLogicalNodeId: "previous-node-1",
        candidateLogicalNodeIds: ["candidate-node-1", "candidate-node-2"],
        evidence: {
          previousNodeLocator: "/bus/same-name@0",
          evidence: status === "open" ? ["immutable continuity evidence"] : [],
          candidates: [
            { logicalNodeId: "candidate-node-1", name: "same-name" },
            { logicalNodeId: "candidate-node-2", name: "same-name" }
          ],
          selectedLogicalNodeId: status === "resolved" ? "candidate-node-1" : null
        },
        status: status as IdentityMappingTask["status"],
        reason: `Recorded ${status} evidence`,
        createdAt: "2026-07-16T00:00:00.000Z"
      })
    );
    stubTopology.listMappingTasks.mockResolvedValue(tasks);

    render(
      <ParameterAdminProvider
        topology={stubTopology as never}
        moduleRegistry={stubModules as never}
        initialState={initialParameterAdminState}
      >
        <OrganizationIdentityMappingPanel />
      </ParameterAdminProvider>
    );

    expect(await screen.findByText("immutable continuity evidence")).toBeInTheDocument();
    expect(screen.getByText(/历史节点对应证据。未决/)).toHaveTextContent("未决 2。");
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("未决任务需要在规范审核队列中作出决定");
    expect(screen.getByRole("status")).toHaveTextContent("不会自动迁移为审核项");
    expect(screen.getByRole("link", { name: "打开规范审核队列" })).toHaveAttribute(
      "href", "/parameter-admin/specs?review=open"
    );
    expect(screen.getByText("原因：Recorded dismissed evidence")).toBeInTheDocument();
    expect(screen.getByText("原因：Recorded new_identity evidence")).toBeInTheDocument();
    expect(stubTopology).not.toHaveProperty("resolveMapping");
    expect(stubTopology).not.toHaveProperty("reopenMapping");
    expect(tasks[0].status).toBe("open");
    expect(tasks[0].candidateLogicalNodeIds).toEqual(["candidate-node-1", "candidate-node-2"]);
  });

  it("maps API failures to product-language copy when task list load fails", async () => {
    const { WiseEffApiError } = await import("@/infrastructure/http/apiClient");
    stubTopology.listMappingTasks.mockRejectedValue(
      new WiseEffApiError("FORBIDDEN", "Forbidden", {}, "req-identity-mapping-list")
    );

    render(
      <ParameterAdminProvider
        topology={stubTopology as never}
        moduleRegistry={stubModules as never}
        initialState={initialParameterAdminState}
      >
        <OrganizationIdentityMappingPanel />
      </ParameterAdminProvider>
    );

    expect(await screen.findByText("没有权限执行该操作。")).toBeInTheDocument();
    expect(screen.queryByText(PARAMETER_ADMIN_UI.identityMappingEmpty)).not.toBeInTheDocument();
  });
});
