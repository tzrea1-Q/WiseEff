import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { IdentityMappingTask } from "@/domain/parameter-topology/types";
import { OrganizationSpecsArea } from "./OrganizationSpecsArea";
import { ParameterAdminProvider } from "./ParameterAdminProvider";

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
        catalogLibrary={<div>Canonical Catalog</div>}
      />
    </ParameterAdminProvider>
  );
  return { onNavigate, topology };
}

describe("OrganizationSpecsArea identity-mapping entry", () => {
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
