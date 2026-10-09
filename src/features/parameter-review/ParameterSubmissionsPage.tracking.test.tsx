import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRuntime } from "@/app/appRuntime";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import { ParameterSubmissionsPage } from "./ParameterSubmissionsPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ParameterSubmissionsPage canonical and legacy tracking", () => {
  it("tracks a node-enablement round as active work with its items and withdrawal action", async () => {
    const nodeRound = { ...initialState.parameterSubmissionRounds[0], id: "node-round", status: "硬件Committer检视" as const,
      items: [{ ...initialState.parameterSubmissionRounds[0].items[0], requestId: "node-request",
        editSubjectKind: "node-enablement" as const, logicalNodeId: "node-charger", parameterId: "node-charger",
        name: "charger", module: "节点启用", currentValue: '"okay"', targetValue: '"disabled"' }] };
    const listSubmissionRounds = vi.fn().mockResolvedValue([nodeRound]);
    const withdrawSubmissionRound = vi.fn().mockImplementation(async () => {
      listSubmissionRounds.mockResolvedValue([{ ...nodeRound, status: "已撤回" }]);
    });
    const runtime = { parameterRepository: { listSubmissionRounds }, parameterCatalogRepository: {
      listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] })
    } } as unknown as AppRuntime;
    render(<TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterSubmissionsPage state={initialState} dispatch={vi.fn()} onNavigate={() => {}} search="?project=aurora"
        runtime={runtime} runtimeMode="api" parameterActions={{ withdrawSubmissionRound } as never} />
    </TopBarActionsContext.Provider>);
    const tracking = await screen.findByRole("region", { name: "节点启用提交" });
    expect(tracking).toHaveTextContent("charger");
    expect(tracking).toHaveTextContent("1 项");
    expect(tracking).toHaveTextContent("硬件MDE检视");
    expect(tracking).toHaveTextContent('"disabled"');
    expect(screen.queryByText("旧版提交归档")).not.toBeInTheDocument();
    fireEvent.click(within(tracking).getByRole("button", { name: "撤回本轮提交" }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤回" }));
    await waitFor(() => expect(withdrawSubmissionRound).toHaveBeenCalledWith("node-round"));
    await waitFor(() => expect(within(tracking).getByRole("button", { name: "撤回本轮提交" })).toBeDisabled());
    expect(listSubmissionRounds).toHaveBeenCalledTimes(2);
  });

  it("trusts the server-filtered API personal legacy archive when the DTO omits submitter ID", async () => {
    const personalRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "legacy-personal-round"
    };
    const listSubmissionRounds = vi.fn().mockResolvedValue([personalRound]);
    const runtime = {
      parameterRepository: { listSubmissionRounds },
      parameterCatalogRepository: {
        listProjectValueChangeRequests: vi.fn().mockResolvedValue({ items: [] })
      }
    } as unknown as AppRuntime;

    render(
      <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
        <ParameterSubmissionsPage
          state={initialState}
          dispatch={vi.fn()}
          onNavigate={() => {}}
          search="?project=aurora"
          runtime={runtime}
          runtimeMode="api"
        />
      </TopBarActionsContext.Provider>
    );

    const archive = await screen.findByRole("region", { name: "旧版提交归档" });
    expect(listSubmissionRounds).toHaveBeenCalledWith({ projectId: "aurora", mine: true });
    expect(within(archive).getByRole("button", { name: /legacy-personal-round|Aurora/ })).toBeInTheDocument();
    expect(within(archive).queryByText(/提交人 ID/)).not.toBeInTheDocument();
    expect(within(archive).getAllByRole("button")).toHaveLength(1);
    expect(within(archive).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
  });
});
