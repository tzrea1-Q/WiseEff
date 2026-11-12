import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/domain/prototype/types";
import type { ProjectParameterInitializationDraft } from "@/domain/parameters/types";
import type { InitializationReviewDto } from "@/domain/parameters/initializationTypes";
import type { AppRuntime } from "@/app/appRuntime";
import { ParameterReviewPage } from "./ParameterReviewPage";

afterEach(() => { cleanup(); window.history.replaceState(null, "", "/"); });

function review(state: PrototypeState, reviewChange = vi.fn()) {
  render(<TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
    <ParameterReviewPage state={{ ...state, activeRoleId: "admin" }} dispatch={vi.fn()} onNavigate={() => {}}
      parameterActions={{ reviewChange } as never} search="?project=aurora" runtimeMode="mock" />
  </TopBarActionsContext.Provider>);
}

const node = { ...initialState.changeRequests[0], id: "node-a", title: "charger", parameterId: "logical-charger",
  editSubjectKind: "node-enablement" as const, logicalNodeId: "logical-charger", projectId: "aurora",
  submissionRoundId: "node-round", status: "硬件Committer检视" as const, currentValue: '"okay"', targetValue: '"disabled"' };

function initialization(status: "pending" | "rejected") {
  const draft: ProjectParameterInitializationDraft = { id: "scope-init-draft", projectId: "aurora", projectName: "Aurora",
    projectCode: "AUR", ownerUserId: null, sourceProjectIds: ["nebula"], primarySourceProjectId: "nebula",
    supplementSourceProjectIds: [], selectedModules: [], selectedRisks: [], selectedParameterIds: [],
    notes: "提交时的初始化说明", createdBy: null, createdAt: "2026-10-16T00:00:00Z", updatedAt: "2026-10-16T00:00:00Z",
    parameterSnapshots: [{ parameterId: "frozen-parameter", sourceProjectId: "nebula", sourceRole: "primary",
      module: "充电配置", risk: "High", recommendedValue: "123\n456", currentValueState: "pending_project_confirmation",
      alternativeSourceProjectIds: ["aurora"], needsRecommendedValueConfirmation: true, notes: "两来源存在差异，请核对测试条件" }] };
  return { ...initialState, changeRequests: [], parameterSubmissionRounds: [], parameterInitializationDrafts: [draft],
    parameterInitializationReviews: [{ id: "scope-init-review", draftId: draft.id, projectId: "aurora", status,
      submittedBy: null, submittedAt: draft.createdAt }] };
}

describe("legacy review evidence and action scope", () => {
  it("removes cached initialization and confirmation when API administrator permission is revoked", () => {
    const state = { ...initialization("pending"), activeRoleId: "admin" };
    const page = (permissions: string[]) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={vi.fn()} search="?project=aurora"
        runtimeMode="api" sessionPermissions={permissions} />
    </TopBarActionsContext.Provider>;
    const { rerender } = render(page(["admin:access", "parameter:review"]));
    expect(screen.getByRole("table", { name: "审阅队列" })).toHaveTextContent("Aurora 初始化");
    fireEvent.click(screen.getByRole("button", { name: "通过初始化" }));
    expect(screen.getByRole("dialog", { name: "确认通过初始化" })).toBeInTheDocument();
    rerender(page(["parameter:review"]));
    expect(screen.queryByText("Aurora 初始化")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通过初始化" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "确认通过初始化" })).not.toBeInTheDocument();
  });

  it("does not apply an initialization approval response after administrator permission is revoked", async () => {
    const state = { ...initialization("pending"), activeRoleId: "admin" };
    let finish!: (review: InitializationReviewDto) => void;
    const pending = new Promise<InitializationReviewDto>((resolve) => { finish = resolve; });
    const approve = vi.fn(() => pending);
    const dispatch = vi.fn();
    const runtime = { parameterInitializationRepository: { approve } } as unknown as AppRuntime;
    const page = (permissions: string[]) => <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="?project=aurora"
        runtime={runtime} runtimeMode="api" sessionPermissions={permissions} />
    </TopBarActionsContext.Provider>;
    const { rerender } = render(page(["admin:access", "parameter:review"]));
    fireEvent.click(screen.getByRole("button", { name: "通过初始化" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "确认通过初始化" })).getByRole("button", { name: "确认通过" }));
    expect(approve).toHaveBeenCalledOnce();
    rerender(page(["parameter:review"]));
    await act(async () => { finish({ id: "scope-init-review", draftId: "scope-init-draft", organizationId: "org-chargelab", projectId: "aurora",
      status: "approved", submittedByUserId: null, submittedAt: "2026-10-16T00:00:00Z" }); await pending; });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "APPROVE_PARAMETER_INITIALIZATION" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_PROJECT_INITIALIZATION_STATUS" }));
  });

  it("keeps cached initialization reviews in the selected project on the legacy page", () => {
    const state = initialization("pending");
    const draft = state.parameterInitializationDrafts[0];
    const initReview = state.parameterInitializationReviews[0];
    review({ ...state, parameterInitializationDrafts: [draft, { ...draft, id: "other-draft", projectId: "nebula", projectName: "Nebula" }],
      parameterInitializationReviews: [initReview, { ...initReview, id: "other-review", draftId: "other-draft", projectId: "nebula" }] });
    const table = screen.getByRole("table", { name: "审阅队列" });
    expect(table).toHaveTextContent("Aurora 初始化");
    expect(table).not.toHaveTextContent("Nebula 初始化");
  });
  it("retains node semantics without a round and does not invent frozen risk or units", () => {
    review({ ...initialState, parameters: [], changeRequests: [{ ...node, submissionRoundId: undefined }],
      parameterSubmissionRounds: [], parameterInitializationReviews: [] });
    const detail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(screen.getByRole("table", { name: "审阅队列" })).getByText("节点状态")).toBeInTheDocument();
    expect(within(detail).queryByText("数值配置")).not.toBeInTheDocument();
    expect(detail).toHaveTextContent('"okay"');
    expect(detail).toHaveTextContent('"disabled"');
    expect(detail).toHaveTextContent("未记录冻结的单位与风险信息");
    expect(detail.querySelector(".submission-diff-card__head")).not.toHaveTextContent("中风险");
    expect(within(detail).queryByRole("button", { name: /展开完整对比|查看本轮其他/ })).not.toBeInTheDocument();
  });

  it("compares only the selected item and approves only its fixed request while other round items remain available", async () => {
    const first = { ...initialState.parameterSubmissionRounds[0].items[0], requestId: node.id, parameterId: node.parameterId,
      editSubjectKind: node.editSubjectKind, name: node.title, currentValue: node.currentValue, targetValue: node.targetValue };
    const other = { ...first, requestId: "node-b", parameterId: "logical-other", name: "other-node", currentValue: "other-before", targetValue: "other-after" };
    const reviewChange = vi.fn().mockResolvedValue(undefined);
    review({ ...initialState, changeRequests: [node], parameterInitializationReviews: [], parameterSubmissionRounds: [{
      ...initialState.parameterSubmissionRounds[0], id: node.submissionRoundId, projectId: "aurora", items: [first, other]
    }] }, reviewChange);
    const detail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(detail).toHaveTextContent("本轮共 2 项，本次仅审阅这一项");
    expect(detail).not.toHaveTextContent("other-before");
    fireEvent.click(within(detail).getByRole("button", { name: "查看本轮其他 1 项" }));
    const round = screen.getByRole("dialog", { name: "本轮变更" });
    expect(round).toHaveTextContent("other-before");
    expect(round).toHaveTextContent('"disabled"');
    fireEvent.click(within(round).getByRole("button", { name: "关闭" }));
    fireEvent.click(within(detail).getByRole("button", { name: "通过检视" }));
    const confirm = screen.getByRole("dialog", { name: "确认通过检视" });
    expect(confirm).toHaveTextContent("仅处理“charger”这一条变更");
    fireEvent.click(within(confirm).getByRole("button", { name: "确认通过" }));
    await waitFor(() => expect(reviewChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requestId: node.id, decision: "advance" })));
  });

  it("exposes each initialization question beside its frozen source, recommended value and notes", () => {
    review(initialization("pending"));
    const section = screen.getByRole("region", { name: "将建立的参数" });
    expect(section).toHaveTextContent("需核对推荐值");
    expect(section).toHaveTextContent("主来源");
    expect(section).toHaveTextContent("高风险");
    expect(section).toHaveTextContent("两来源存在差异，请核对测试条件");
    expect(within(section).getByLabelText("冻结推荐值").textContent).toBe("123\n456");
    expect(section).toHaveTextContent("frozen-parameter");
    expect(section).toHaveTextContent("nebula");
    expect(within(screen.getByRole("complementary", { name: "审阅详情" })).getByRole("button", { name: "通过初始化" })).toBeEnabled();
  });

  it("does not claim initialization succeeded when a rejected archive has no recorded reason", async () => {
    review(initialization("rejected"));
    await userEvent.click(screen.getByRole("tab", { name: "已处理" }));
    const detail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(detail).toHaveTextContent("未记录驳回原因");
    expect(detail).toHaveTextContent("本次初始化未通过");
    expect(detail).not.toHaveTextContent("初始化参数已建立");
    expect(within(detail).queryByRole("button", { name: "通过初始化" })).not.toBeInTheDocument();
  });

  it("keeps an unsent rejection reason when closing to inspect evidence and reopening the same target", () => {
    review({ ...initialState, changeRequests: [node], parameterSubmissionRounds: [], parameterInitializationReviews: [] });
    fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
    fireEvent.change(screen.getByLabelText("打回原因"), { target: { value: "补充节点状态的测试依据" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
    expect(screen.getByLabelText("打回原因")).toHaveValue("补充节点状态的测试依据");
  });
});
