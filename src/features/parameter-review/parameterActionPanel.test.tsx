import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appReducer } from "@/application/state/appState";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/domain/prototype/types";
import { declarationFor, hasRule, readStylesheet } from "@/test/cssAssertions";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { ParameterSubmissionsPage } from "./ParameterSubmissionsPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function renderReview(state: PrototypeState) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={() => {}} search="" />
    </TopBarActionsContext.Provider>
  );
}

function renderSubmissions(state: PrototypeState) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterSubmissionsPage state={state} dispatch={vi.fn()} onNavigate={() => {}} search="" />
    </TopBarActionsContext.Provider>
  );
}

function actionSnapshot(button: HTMLElement) {
  return {
    name: button.textContent?.trim(),
    variant: button.getAttribute("data-variant"),
    hasFullClass: button.classList.contains("full")
  };
}

describe("parameter action panels", () => {
  it("keeps the five meaningful review and submission actions styled without a duplicate scalar modal", () => {
    renderReview({ ...initialState, activeRoleId: "admin" });
    fireEvent.click(screen.getByRole("button", { name: `查看 ${initialState.changeRequests[0].title} 提交详情` }));

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(reviewDetail).queryByRole("button", { name: /查看提交详情/ })).not.toBeInTheDocument();
    const advanceAction = within(reviewDetail).getByRole("button", { name: "通过检视" });
    const reviewActionPanel = advanceAction.closest(".action-panel");
    expect(reviewActionPanel).not.toBeNull();
    const reviewActions = within(reviewActionPanel as HTMLElement).getAllByRole("button");

    cleanup();
    const initializationState = appReducer(initialState, {
      type: "SUBMIT_PARAMETER_INITIALIZATION",
      draft: {
        projectName: "Zephyr",
        projectCode: "ZEP",
        ownerUserId: "u-xu-yun",
        sourceProjectIds: ["aurora", "nebula"],
        primarySourceProjectId: "aurora",
        supplementSourceProjectIds: ["nebula"],
        selectedModules: ["Battery Safety"],
        selectedRisks: ["Medium"],
        selectedParameterIds: ["battery-temp-target"],
        notes: "Initialize from Aurora"
      }
    });
    renderReview({ ...initializationState, activeRoleId: "admin" });
    fireEvent.click(screen.getByRole("button", { name: "查看 Zephyr 初始化 提交详情" }));

    const initializationDetail = screen.getByRole("complementary", { name: "审阅详情" });
    const approveInitialization = within(initializationDetail).getByRole("button", { name: "通过初始化" });
    const initializationActionPanel = approveInitialization.closest(".action-panel");
    expect(initializationActionPanel).not.toBeNull();
    const initializationActions = within(initializationActionPanel as HTMLElement).getAllByRole("button");

    cleanup();
    const submissionRound = {
      ...initialState.parameterSubmissionRounds[0],
      id: "action-panel-submission-round",
      submitter: "Xu Yun",
      status: "硬件Committer检视" as const
    };
    renderSubmissions({
      ...initialState,
      activeRoleId: "hardware-user",
      parameterSubmissionRounds: [submissionRound]
    });

    const submissionDetail = screen.getByRole("region", { name: "提交轮次详情" });
    const withdrawAction = within(submissionDetail).getByRole("button", { name: "撤回本轮提交" });

    expect([
      ...reviewActions.map(actionSnapshot),
      ...initializationActions.map(actionSnapshot),
      actionSnapshot(withdrawAction)
    ]).toEqual([
      { name: "通过检视", variant: "default", hasFullClass: false },
      { name: "打回修改", variant: "destructive", hasFullClass: false },
      { name: "通过初始化", variant: "default", hasFullClass: false },
      { name: "驳回初始化", variant: "destructive", hasFullClass: false },
      { name: "撤回本轮提交", variant: "destructive", hasFullClass: false }
    ]);
  });

  it("uses one structural action column without legacy full-width selectors", () => {
    const stylesheet = readStylesheet("src/styles.css");
    expect(hasRule(stylesheet, ".action-panel .full")).toBe(false);
    expect(hasRule(stylesheet, ".button.full")).toBe(false);
  });

  it("bounds the unified inbox table and keeps inspector actions out of sticky code overlays", () => {
    const stylesheet = readStylesheet("src/features/parameter-review/parameter-review.css");
    expect(hasRule(stylesheet, ".review-inbox .review-detail footer.dialog-actions")).toBe(false);
    expect(declarationFor(stylesheet, ".review-inbox .review-inspector__meta dt", "color")).toBe("var(--text-muted)");
  });

  it("keeps the software merge field and confirmation in the same hook-free action panel", () => {
    const mergeRequest = initialState.changeRequests.find((request) => request.status === "软件User合入");
    expect(mergeRequest).toBeDefined();

    renderReview({
      ...initialState,
      activeRoleId: "software-user",
      changeRequests: [{ ...mergeRequest!, id: "action-panel-merge-request" }]
    });

    const mergeLink = screen.getByLabelText("合入链接");
    const confirmMerge = screen.getByRole("button", { name: "确认合入" });
    const actionPanel = mergeLink.closest(".action-panel");
    const mergeLinkGroup = mergeLink.closest(".review-merge-link");

    expect(actionPanel).not.toBeNull();
    expect(mergeLinkGroup).not.toBeNull();
    expect(confirmMerge.closest(".action-panel")).toBe(actionPanel);
    const consequence = within(actionPanel as HTMLElement).getByText("确认后将本条修改记为已合入，并保存填写的合入链接。");
    expect(Array.from(actionPanel!.children)).toEqual([consequence, mergeLinkGroup, confirmMerge]);
    expect(actionPanel!.querySelector(".full")).toBeNull();
    expect(confirmMerge).toBeDisabled();
    fireEvent.change(mergeLink, { target: { value: "https://example.com/merge/123" } });
    fireEvent.click(confirmMerge);
    const dialog = screen.getByRole("dialog", { name: "确认合入" });
    expect(dialog).toHaveTextContent("https://example.com/merge/123");
    expect(within(dialog).getByRole("button", { name: "确认合入" })).toBeEnabled();
  });

});
