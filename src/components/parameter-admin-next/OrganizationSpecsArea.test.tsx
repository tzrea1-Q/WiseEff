import { act, render, screen, waitFor, within } from "@testing-library/react";
import { createMockCatalogPorts } from "@/application/parameter-catalog/mockAdapter";
import { CatalogPage } from "@/features/parameter-catalog/CatalogPage";
import { describe, expect, it, vi } from "vitest";

import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { OrganizationSpecsArea } from "./OrganizationSpecsArea";
import { ParameterAdminProvider } from "./ParameterAdminProvider";
import { ToastProvider } from "@/components/common/toast/ToastProvider";

const historicalTask: IdentityMappingTask = {
  id: "historical-task-1",
  projectId: "project-1",
  configRevisionId: "revision-1",
  previousLogicalNodeId: "previous-node-1",
  candidateLogicalNodeIds: ["candidate-node-1"],
  status: "resolved",
  createdAt: "2026-07-16T00:00:00.000Z"
};

function renderIdentityEntry(tasks: IdentityMappingTask[] | Error) {
  const onNavigate = vi.fn();
  const topology = {
    listMappingTasks: tasks instanceof Error
      ? vi.fn().mockRejectedValue(tasks)
      : vi.fn().mockResolvedValue(tasks)
  };
  render(
    <ParameterAdminProvider topology={topology as never} moduleRegistry={{} as never}>
      <OrganizationSpecsArea
        pathname="/parameter-admin/specs/identity-mapping"
        search="?projectId=project-1"
        onNavigate={onNavigate}
        renderCatalogLibrary={(taskContent) => taskContent ?? <div>Canonical Catalog</div>}
      />
    </ParameterAdminProvider>
  );
  return { onNavigate, topology };
}

describe("OrganizationSpecsArea identity-mapping entry", () => {
  it("does not report settled readiness until the empty identity task redirects to the review queue", async () => {
    let resolveTasks!: (tasks: IdentityMappingTask[]) => void;
    const tasks = new Promise<IdentityMappingTask[]>((resolve) => { resolveTasks = resolve; });
    const topology = { listMappingTasks: vi.fn(() => tasks) };
    const onNavigate = vi.fn();
    const entry = (pathname: string, search: string) => (
      <ParameterAdminProvider topology={topology as never} moduleRegistry={{} as never}>
        <OrganizationSpecsArea pathname={pathname} search={search} onNavigate={onNavigate}
          renderCatalogLibrary={() => <div>Canonical Catalog</div>} />
      </ParameterAdminProvider>
    );
    const view = render(entry("/parameter-admin/specs/identity-mapping", ""));
    expect(screen.getByTestId("organization-specs-readiness")).toHaveAttribute("data-state", "loading");
    expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => { resolveTasks([]); await tasks; });
    expect(screen.getByTestId("organization-specs-readiness")).toHaveAttribute("data-state", "redirecting");
    expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs?review=open");
    view.rerender(entry("/parameter-admin/specs", "?review=open"));
    await waitFor(() => expect(screen.getByTestId("organization-specs-readiness")).toHaveAttribute("data-state", "ready"));
  });

  it("shows unresolved identity evidence inside the Catalog task area without changing its review link", async () => {
    const ports = createMockCatalogPorts({ scenario: "ready" });
    const topology = { listMappingTasks: vi.fn().mockResolvedValue([
      { ...historicalTask, status: "open", evidence: { evidence: ["Unresolved continuity evidence"] } }
    ]) };
    const onNavigate = vi.fn();
    render(<ParameterAdminProvider topology={topology as never} moduleRegistry={{} as never}>
      <OrganizationSpecsArea pathname="/parameter-admin/specs/identity-mapping" search="?projectId=project-1"
        onNavigate={onNavigate}
        renderCatalogLibrary={(taskContent) => <CatalogPage repository={ports.catalog} actor="org-admin"
          search="?projectId=project-1" taskContent={taskContent} />} />
    </ParameterAdminProvider>);
    const evidence = await screen.findByText("Unresolved continuity evidence");
    expect(screen.getByRole("region", { name: "目录列表" })).toContainElement(evidence);
    expect(within(screen.getByRole("region", { name: "模块导航" })).getByRole("button", { name: "收起模块导航" })).toBeVisible();
    expect(screen.getByRole("link", { name: "打开规范审核队列" })).toHaveAttribute("href", "/parameter-admin/specs?review=open");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not fall back to retired Spec governance when Catalog is unavailable", async () => {
    const topology = {
      listMappingTasks: vi.fn().mockResolvedValue([]),
    };
    render(
      <ToastProvider>
        <ParameterAdminProvider topology={topology as never} moduleRegistry={{} as never}>
          <OrganizationSpecsArea
            pathname="/parameter-admin/specs"
            search=""
            onNavigate={vi.fn()}
            renderCatalogLibrary={() => null}
          />
        </ParameterAdminProvider>
      </ToastProvider>
    );

    await waitFor(() => expect(topology.listMappingTasks).toHaveBeenCalled());
    expect(topology).not.toHaveProperty("listSpecs");
    expect(topology).not.toHaveProperty("listSpecReviewTasks");
    expect(screen.queryByRole("button", { name: /新建/ })).not.toBeInTheDocument();
  });

  it("redirects resolved history alone to the canonical Review Queue", async () => {
    const { onNavigate } = renderIdentityEntry([historicalTask]);

    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs?projectId=project-1&review=open");
    });
    expect(screen.getByText("Canonical Catalog")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "节点对应确认" })).not.toBeInTheDocument();
  });

  it.each([
    { name: "no tasks", tasks: [] },
    { name: "new-identity history", tasks: [{ ...historicalTask, status: "new_identity" as const }] }
  ])("redirects $name without fabricating a review item identity", async ({ tasks }) => {
    const { onNavigate } = renderIdentityEntry(tasks);
    await waitFor(() => {
      expect(onNavigate).toHaveBeenCalledWith("/parameter-admin/specs?projectId=project-1&review=open");
    });
    expect(screen.queryByRole("button", { name: "节点对应确认" })).not.toBeInTheDocument();
  });

  it("keeps unresolved historical continuity evidence visible without redirecting", async () => {
    const { onNavigate } = renderIdentityEntry([
      historicalTask,
      {
        ...historicalTask,
        id: "unresolved-historical-task",
        status: "open",
        historicalOnly: true,
        needsCanonicalDecision: true,
        successor: "/api/v2/organizations/org-1/parameter-review-items",
        evidence: { evidence: ["unresolved continuity evidence"] }
      }
    ]);

    expect(await screen.findByText("unresolved continuity evidence")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("只读证据");
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("retains dismissed-only unresolved history as read-only evidence needing a canonical decision", async () => {
    const { onNavigate } = renderIdentityEntry([
      {
        ...historicalTask,
        status: "dismissed",
        historicalOnly: true,
        needsCanonicalDecision: true,
        reason: "Rejected candidates; continuity remains unresolved"
      }
    ]);

    expect(await screen.findByText("原因：Rejected candidates; continuity remains unresolved")).toBeInTheDocument();
    expect(screen.getByText(/历史节点对应证据。未决/)).toHaveTextContent("未决 1。");
    expect(screen.getByRole("status")).toHaveTextContent("需要在规范审核队列中作出决定");
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "重新打开" })).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("does not redirect on a task read failure or mistake it for an empty queue", async () => {
    const { onNavigate } = renderIdentityEntry(new Error("private transport diagnostic"));

    expect(await screen.findByRole("alert")).not.toHaveTextContent("private transport diagnostic");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "节点对应确认" })).toBeInTheDocument();
  });
});
