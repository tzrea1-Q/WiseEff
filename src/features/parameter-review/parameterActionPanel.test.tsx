import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appReducer } from "@/application/state/appState";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/mockData";
import { declarationFor, hasRule, parseCssRules, readStylesheet } from "@/test/cssAssertions";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { ParameterSubmissionsPage } from "./ParameterSubmissionsPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function renderReview(state: PrototypeState) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={() => {}} search="" />
    </TopBarActionsContext.Provider>
  );
}

function renderSubmissions(state: PrototypeState) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
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
  it("keeps all six review and submission actions ordered, styled, and independent of the legacy full hook", () => {
    renderReview({ ...initialState, activeRoleId: "admin" });

    const reviewDetail = screen.getByRole("complementary", { name: "审阅详情" });
    const detailAction = within(reviewDetail).getByRole("button", { name: /查看提交详情/ });
    const advanceAction = within(reviewDetail).getByRole("button", { name: "推进流程" });
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
      actionSnapshot(detailAction),
      ...reviewActions.map(actionSnapshot),
      ...initializationActions.map(actionSnapshot),
      actionSnapshot(withdrawAction)
    ]).toEqual([
      { name: "查看提交详情（1 项变更）", variant: "outline", hasFullClass: false },
      { name: "推进流程", variant: "default", hasFullClass: false },
      { name: "打回修改", variant: "destructive", hasFullClass: false },
      { name: "通过初始化", variant: "default", hasFullClass: false },
      { name: "驳回初始化", variant: "destructive", hasFullClass: false },
      { name: "撤回本轮提交", variant: "destructive", hasFullClass: false }
    ]);
  });

  it("uses one structural action column without legacy full-width selectors", () => {
    const stylesheet = readStylesheet("src/styles.css");
    const parameterReviewStylesheet = readStylesheet("src/features/parameter-review/parameter-review.css");

    expect(declarationFor(stylesheet, ".action-panel", "grid-template-columns")).toBe("1fr");
    expect(hasRule(stylesheet, ".action-panel .full")).toBe(false);
    expect(hasRule(stylesheet, ".button.full")).toBe(false);
    expect(declarationFor(parameterReviewStylesheet, ".review-merge-link", "grid-column")).toBeUndefined();
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
    expect(Array.from(actionPanel!.children)).toEqual([mergeLinkGroup, confirmMerge]);
    expect(actionPanel!.querySelector(".full")).toBeNull();
  });

  it("keeps the submission history mobile grid override after its base rule", () => {
    const rules = parseCssRules(readStylesheet("src/features/parameter-review/parameter-review.css"));
    const baseRuleIndex = rules.findIndex(
      (rule) => rule.selectors.includes(".submission-history-layout") && rule.atRules.length === 0
    );
    const mobileRuleIndex = rules.findIndex(
      (rule) =>
        rule.selectors.includes(".submission-history-layout") &&
        rule.atRules.some((atRule) => atRule.includes("@media (max-width: 900px)"))
    );

    expect(baseRuleIndex).toBeGreaterThanOrEqual(0);
    expect(mobileRuleIndex).toBeGreaterThan(baseRuleIndex);
  });

  it("gives history cards a page-scoped single-column rule that outranks the shared card grid", () => {
    const stylesheet = readStylesheet("src/features/parameter-review/parameter-review.css");

    expect(
      declarationFor(
        stylesheet,
        ".submission-diff-card.submission-diff-card--history",
        "grid-template-columns"
      )
    ).toBe("minmax(0, 1fr)");
  });
});
