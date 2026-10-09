import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRuntime } from "@/app/appRuntime";
import { TopBarActionsContext } from "@/components/layout";
import { initialState, type PrototypeState } from "@/mockData";
import { ParameterReviewPage } from "./ParameterReviewPage";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

const historicalRequest = {
  ...initialState.changeRequests[0],
  id: "historical-request",
  parameterId: "old-parameter-reference",
  projectId: "historical-project",
  submissionRoundId: undefined,
  title: "历史修改",
  status: "已合入" as const
};
const canonicalParameter = {
  ...initialState.parameters[0],
  id: "pbind:canonical-binding",
  projectId: "canonical-project",
  name: "历史修改"
};

function archiveState(): PrototypeState {
  return {
    ...initialState,
    activeRoleId: "hardware-committer",
    activeProjectId: "historical-project",
    parameters: [canonicalParameter],
    changeRequests: [],
    parameterSubmissionRounds: [],
    parameterInitializationReviews: [],
    configDraft: {
      ...initialState.configDraft,
      projects: [
        { ...initialState.configDraft.projects[0], id: "historical-project", name: "历史项目" },
        { ...initialState.configDraft.projects[0], id: "canonical-project", name: "新版项目" }
      ]
    }
  };
}

function renderArchive(state: PrototypeState, runtime?: AppRuntime) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={() => {}}
        search="?project=historical-project&legacyRequest=historical-request"
        runtime={runtime} runtimeMode={runtime ? "api" : "mock"} />
    </TopBarActionsContext.Provider>
  );
}

describe("ParameterReviewPage archive project identity", () => {
  it("reports an active review projection read failure as review records rather than an archive", async () => {
    const dispatch = vi.fn();
    const runtime = { parameterRepository: {
      listChangeRequests: vi.fn().mockRejectedValue(new Error("Read unavailable")),
      listSubmissionRounds: vi.fn().mockResolvedValue([])
    } } as unknown as AppRuntime;
    render(<TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage state={archiveState()} dispatch={dispatch} search="?project=historical-project"
        onNavigate={() => {}} runtime={runtime} runtimeMode="api" />
    </TopBarActionsContext.Provider>);
    await waitFor(() => expect(dispatch).toHaveBeenCalledWith({
      type: "ADD_NOTIFICATION", message: "审阅记录加载失败，请稍后重试。"
    }));
  });

  it.each(["advance", "reject"] as const)("lists assigned node work and refreshes after %s without reviving binding review", async (decision) => {
    const node = { ...initialState.changeRequests[0], id: "node-review", projectId: "aurora", parameterId: "logical-charger",
      submissionRoundId: undefined, editSubjectKind: "node-enablement" as const, logicalNodeId: "logical-charger",
      title: "charger", module: "节点启用", status: "硬件Committer检视" as const, assignedTo: "assigned-reviewer" };
    const listChangeRequests = vi.fn().mockResolvedValue([node, { ...node, id: "other-node", title: "other node", assignedTo: "other-reviewer" },
      { ...node, id: "old-binding", title: "retired binding", editSubjectKind: "binding" }]);
    const reviewChange = vi.fn().mockImplementation(async () => {
      listChangeRequests.mockResolvedValue([{ ...node, status: decision === "advance" ? "软件Committer检视" : "已打回", assignedTo: "next-reviewer" }]);
    });
    const runtime = { parameterRepository: { listChangeRequests, listSubmissionRounds: vi.fn().mockResolvedValue([]) } } as unknown as AppRuntime;
    const user = { ...initialState.users[0], id: "assigned-reviewer", isActive: true,
      roles: [{ projectId: "aurora", roleId: "hardware-committer" as const }] };
    render(<TopBarActionsContext.Provider value={{ setActions: () => {} }}>
      <ParameterReviewPage state={{ ...initialState, currentUserId: user.id, users: [user], activeRoleId: "hardware-committer",
        changeRequests: [], parameterSubmissionRounds: [], parameterInitializationReviews: [] }} dispatch={vi.fn()}
        onNavigate={() => {}} search="?project=aurora" runtime={runtime} runtimeMode="api" parameterActions={{ reviewChange } as never} />
    </TopBarActionsContext.Provider>);
    const queue = screen.getByRole("table", { name: "审阅队列" });
    fireEvent.click(await within(queue).findByRole("button", { name: "查看 charger 提交详情" }));
    expect(queue).not.toHaveTextContent("other node");
    expect(queue).not.toHaveTextContent("retired binding");
    if (decision === "advance") fireEvent.click(screen.getByRole("button", { name: "推进流程" }));
    else {
      fireEvent.click(screen.getByRole("button", { name: "打回修改" }));
      fireEvent.change(screen.getByLabelText("打回原因"), { target: { value: "Keep this node enabled" } });
      fireEvent.click(screen.getByRole("button", { name: "提交打回" }));
    }
    await waitFor(() => expect(reviewChange).toHaveBeenCalledWith(expect.objectContaining({ requestId: node.id, decision })));
    await waitFor(() => expect(listChangeRequests).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("tab", { name: "待审阅" })).toHaveTextContent("0");
  });

  it("keeps the archive DTO project filter when the shell has only canonical Bindings", async () => {
    const runtime = {
      parameterRepository: {
        listChangeRequests: vi.fn().mockResolvedValue([historicalRequest]),
        listSubmissionRounds: vi.fn().mockResolvedValue([])
      }
    } as unknown as AppRuntime;
    renderArchive(archiveState(), runtime);

    const table = screen.getByRole("table", { name: "审阅队列" });
    await within(table).findByRole("button", { name: "查看 历史修改 提交详情" });
    expect(table).toHaveTextContent("历史项目");
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    const filter = screen.getByRole("group", { name: "项目筛选" });
    fireEvent.click(within(filter).getByRole("checkbox", { name: "历史项目" }));
    expect(table).toHaveTextContent("历史修改");
    expect(table).not.toHaveTextContent("新版项目");
  });

  it("shows a historical notice instead of guessing metadata from a canonical parameter with the same name", () => {
    const state = archiveState();
    renderArchive({ ...state, changeRequests: [{ ...historicalRequest, projectId: undefined }] });

    const table = screen.getByRole("table", { name: "审阅队列" });
    expect(table).not.toHaveTextContent("新版项目");
    expect(screen.getByRole("complementary", { name: "审阅详情" })).toHaveTextContent(
      "历史参数引用缺少精确的显示元数据，仅展示归档记录，不推测当前参数。"
    );
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    expect(within(screen.getByRole("group", { name: "项目筛选" })).queryByRole("checkbox")).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole("button", { name: "查看 历史修改 提交详情" }));
    expect(screen.getByRole("dialog", { name: "提交详情" })).toHaveTextContent(
      "历史参数引用缺少精确的显示元数据，仅展示归档记录，不推测当前参数。"
    );
  });

  it("uses an exact submission-round snapshot for a historical project no longer in the shell", async () => {
    const request = { ...historicalRequest, projectId: undefined, submissionRoundId: "historical-round" };
    const runtime = {
      parameterRepository: {
        listChangeRequests: vi.fn().mockResolvedValue([request]),
        listSubmissionRounds: vi.fn().mockResolvedValue([{
          id: "historical-round", projectId: "retained-project", projectName: "归档项目",
          submitter: request.submitter, createdAt: request.createdAt, status: request.status,
          summary: "归档提交", items: [{
            requestId: request.id, parameterId: request.parameterId, name: "归档参数",
            module: request.module, currentValue: request.currentValue, targetValue: request.targetValue,
            unit: "mA", risk: "Medium", reason: request.aiSummary
          }]
        }])
      }
    } as unknown as AppRuntime;
    renderArchive(archiveState(), runtime);

    const table = screen.getByRole("table", { name: "审阅队列" });
    await within(table).findByRole("button", { name: "查看 历史修改 提交详情" });
    expect(table).toHaveTextContent("归档项目");
    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(within(screen.getByRole("group", { name: "项目筛选" })).getByRole("checkbox", { name: "归档项目" }));
    expect(table).toHaveTextContent("历史修改");
    expect(screen.getByRole("complementary", { name: "审阅详情" })).not.toHaveTextContent("历史参数引用缺少精确的显示元数据");
    fireEvent.click(within(table).getByRole("button", { name: "查看 历史修改 提交详情" }));
    expect(screen.getByRole("dialog", { name: "提交详情" })).toHaveTextContent("归档参数");
  });

  it("keeps same-named historical and canonical projects distinct by ID", () => {
    const state = archiveState();
    renderArchive({
      ...state,
      changeRequests: [historicalRequest, {
        ...historicalRequest, id: "canonical-request", parameterId: canonicalParameter.id,
        projectId: "canonical-project", title: "新版修改"
      }],
      configDraft: { ...state.configDraft, projects: state.configDraft.projects.map((project) => ({
        ...project, name: "同名项目"
      })) }
    });

    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    const filter = screen.getByRole("group", { name: "项目筛选" });
    const historicalOption = within(filter).getByRole("checkbox", { name: "同名项目（historical-project）" });
    const canonicalOption = within(filter).getByRole("checkbox", { name: "同名项目（canonical-project）" });
    const table = screen.getByRole("table", { name: "审阅队列" });
    fireEvent.click(historicalOption);
    expect(table).toHaveTextContent("历史修改");
    expect(table).not.toHaveTextContent("新版修改");
    fireEvent.click(historicalOption);
    fireEvent.click(canonicalOption);
    expect(table).toHaveTextContent("新版修改");
    expect(table).not.toHaveTextContent("历史修改");
  });

  it("keeps a request's exact project ID filterable without current project metadata", () => {
    renderArchive({ ...archiveState(), changeRequests: [{ ...historicalRequest, projectId: "retained-project" }] });

    fireEvent.click(screen.getByRole("button", { name: "筛选项目" }));
    fireEvent.click(within(screen.getByRole("group", { name: "项目筛选" })).getByRole("checkbox", { name: "retained-project" }));
    const table = screen.getByRole("table", { name: "审阅队列" });
    expect(table).toHaveTextContent("retained-project");
    expect(table).toHaveTextContent("历史修改");
    fireEvent.click(within(table).getByRole("button", { name: "查看 历史修改 提交详情" }));
    expect(screen.getByRole("dialog", { name: "提交详情" })).toHaveTextContent("retained-project");
  });

  it.each([
    { mismatch: "project", projectId: "canonical-project", requestId: historicalRequest.id, parameterId: historicalRequest.parameterId },
    { mismatch: "request", projectId: historicalRequest.projectId, requestId: "other-request", parameterId: historicalRequest.parameterId },
    { mismatch: "parameter", projectId: historicalRequest.projectId, requestId: historicalRequest.id, parameterId: canonicalParameter.id }
  ])("does not borrow archive metadata from a mismatched $mismatch identity", ({ projectId, requestId, parameterId }) => {
    renderArchive({ ...archiveState(),
      changeRequests: [{ ...historicalRequest, submissionRoundId: "other-round" }],
      parameterSubmissionRounds: [{
        id: "other-round", projectId, projectName: "错误归档项目", submitter: historicalRequest.submitter,
        createdAt: historicalRequest.createdAt, status: historicalRequest.status, summary: "错误提交",
        items: [{ requestId, parameterId, name: "错误归档参数", module: historicalRequest.module,
          currentValue: "1", targetValue: "2", unit: "", risk: "Medium", reason: "" }]
      }]
    });

    expect(screen.getByRole("table", { name: "审阅队列" })).toHaveTextContent("历史项目");
    expect(screen.getByRole("complementary", { name: "审阅详情" })).toHaveTextContent("历史参数引用缺少精确的显示元数据");
    fireEvent.click(screen.getByRole("button", { name: "查看 历史修改 提交详情" }));
    const dialog = screen.getByRole("dialog", { name: "提交详情" });
    expect(dialog).not.toHaveTextContent("错误归档项目");
    expect(dialog).not.toHaveTextContent("错误归档参数");
  });
});
