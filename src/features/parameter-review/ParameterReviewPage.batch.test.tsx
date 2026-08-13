import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/mockData";
import type { ParameterPageActions } from "@/app/routes";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function hardwareCommitterState(): PrototypeState {
  return { ...initialState, activeRoleId: "hardware-committer" };
}

function renderReview(state: PrototypeState, parameterActions?: ParameterPageActions) {
  const dispatch = vi.fn();
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage
        state={state}
        dispatch={dispatch}
        onNavigate={() => {}}
        search=""
        {...(parameterActions ? { parameterActions } : {})}
      />
    </TopBarActionsContext.Provider>
  );
  return { dispatch };
}

function pendingHardwareReviewIds(state: PrototypeState) {
  return state.changeRequests
    .filter((request) => request.status === "硬件Committer检视" || request.status === "待审阅")
    .map((request) => request.id);
}

describe("ParameterReviewPage deep link", () => {
  it("restores the selected request from ?request= and keeps the URL shareable", async () => {
    const state = hardwareCommitterState();
    const target = state.changeRequests.find((request) => request.status === "硬件Committer检视");
    expect(target).toBeTruthy();
    window.history.replaceState(null, "", `/parameter-review?request=${target!.id}`);

    const dispatch = vi.fn();
    render(
      <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
        <ParameterReviewPage
          state={state}
          dispatch={dispatch}
          onNavigate={() => {}}
          search={`?request=${target!.id}`}
        />
      </TopBarActionsContext.Provider>
    );

    const selectedRow = document.querySelector("tr.selected-row");
    expect(selectedRow?.textContent ?? "").toContain(target!.title);
    await waitFor(() => {
      expect(new URLSearchParams(window.location.search).get("request")).toBe(target!.id);
    });
  });
});

describe("ParameterReviewPage batch advance", () => {
  it("offers checkboxes only for actionable review-stage rows and arms the batch button", () => {
    const state = hardwareCommitterState();
    renderReview(state);

    expect(screen.getByRole("toolbar", { name: "批量审阅操作" })).toBeInTheDocument();
    const batchButton = screen.getByRole("button", { name: /批量通过（0 项）/ });
    expect(batchButton).toBeDisabled();

    const selectAll = screen.getByRole("checkbox", { name: "全选可批量通过的变更" });
    fireEvent.click(selectAll);

    const armed = screen.getByRole("button", { name: /批量通过（\d+ 项）/ });
    expect(armed).toBeEnabled();
    expect(armed.textContent).not.toContain("（0 项）");
  });

  it("advances every selected request through the confirm dialog in mock mode", async () => {
    const state = hardwareCommitterState();
    const expectedIds = pendingHardwareReviewIds(state);
    expect(expectedIds.length).toBeGreaterThan(0);
    const { dispatch } = renderReview(state);

    fireEvent.click(screen.getByRole("checkbox", { name: "全选可批量通过的变更" }));
    fireEvent.click(screen.getByRole("button", { name: /批量通过（\d+ 项）/ }));

    const confirm = screen.getByRole("dialog", { name: "确认批量通过" });
    expect(confirm).toHaveTextContent(/合入阶段的请求不在批量范围内/);
    fireEvent.click(within(confirm).getByRole("button", { name: /通过 \d+ 项/ }));

    await waitFor(() => {
      const advanced = dispatch.mock.calls.filter(([action]) => action.type === "ADVANCE_REVIEW");
      expect(advanced.length).toBeGreaterThan(0);
    });
    const advancedIds = dispatch.mock.calls
      .filter(([action]) => action.type === "ADVANCE_REVIEW")
      .map(([action]) => action.requestId);
    for (const id of advancedIds) {
      expect(expectedIds).toContain(id);
    }
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_NOTIFICATION",
      message: expect.stringMatching(/^已批量通过 \d+ 项变更$/)
    });
  });

  it("summarizes API failures once, keeps failed rows selected, and suppresses per-item toasts", async () => {
    const state = hardwareCommitterState();
    const expectedIds = pendingHardwareReviewIds(state);
    expect(expectedIds.length).toBeGreaterThanOrEqual(2);

    const reviewChange = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ notification: "数据已被其他人修改，请刷新后基于最新状态重试。" });
    const parameterActions = { reviewChange } as unknown as ParameterPageActions;
    const { dispatch } = renderReview(state, parameterActions);

    fireEvent.click(screen.getByRole("checkbox", { name: "全选可批量通过的变更" }));
    fireEvent.click(screen.getByRole("button", { name: /批量通过（\d+ 项）/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认批量通过" })).getByRole("button", { name: /通过 \d+ 项/ }));

    await waitFor(() => expect(reviewChange).toHaveBeenCalledTimes(expectedIds.length));
    // Every call opts out of per-item failure toasts; the summary owns messaging.
    for (const call of reviewChange.mock.calls) {
      expect(call[1]).toEqual({ notifyOnFailure: false });
    }

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith({
        type: "ADD_NOTIFICATION",
        message: expect.stringContaining("已批量通过 1 项变更")
      });
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_NOTIFICATION",
      message: expect.stringMatching(/^批量通过失败 \d+ 项（.+：数据已被其他人修改/)
    });

    // Failed rows stay selected for retry.
    const checked = screen
      .getAllByRole("checkbox")
      .filter((box) => (box as HTMLInputElement).checked && box.getAttribute("aria-label")?.startsWith("选择"));
    expect(checked.length).toBe(expectedIds.length - 1);
  });
});
