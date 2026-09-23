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
