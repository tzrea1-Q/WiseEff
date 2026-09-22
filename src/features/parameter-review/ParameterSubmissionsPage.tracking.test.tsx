import { cleanup, render, screen, within } from "@testing-library/react";
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
  it("loads a stable-ID personal legacy archive separately and keeps it read-only", async () => {
    const personalRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "legacy-personal-round",
      submitterUserId: initialState.currentUserId
    };
    const otherUserRound = {
      ...personalRound,
      id: "legacy-other-user-round",
      submitterUserId: "other-user"
    };
    const listSubmissionRounds = vi.fn().mockResolvedValue([personalRound, otherUserRound]);
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
    expect(within(archive).getByText("提交人 ID：u-xu-yun")).toBeInTheDocument();
    expect(within(archive).getAllByRole("button")).toHaveLength(1);
    expect(within(archive).queryByRole("button", { name: "撤回本轮提交" })).not.toBeInTheDocument();
  });
});
