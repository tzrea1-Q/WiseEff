import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParameterReviewPage } from "./ParameterReviewPage";
import { TopBarActionsContext } from "@/components/layout";
import { initialState } from "@/mockData";
import type { PrototypeState } from "@/domain/prototype/types";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function hardwareCommitterState(): PrototypeState {
  return { ...initialState, activeRoleId: "hardware-committer" };
}

function renderReview(state: PrototypeState = hardwareCommitterState()) {
  render(
    <TopBarActionsContext.Provider value={{ setActions: () => {}, setLeadingActions: () => {} }}>
      <ParameterReviewPage state={state} dispatch={vi.fn()} onNavigate={() => {}} search="" />
    </TopBarActionsContext.Provider>
  );
}

describe("ParameterReviewPage landmarks and keyboard", () => {
  it("activates history manually and keeps both queue tab panels addressable", async () => {
    const user = userEvent.setup();
    renderReview();
    const tabs = screen.getByRole("tablist", { name: "审阅视角" });
    const pending = within(tabs).getByRole("tab", { name: "待处理" });
    const history = within(tabs).getByRole("tab", { name: "已处理" });
    pending.focus();
    await user.keyboard("{ArrowRight}");
    expect(history).toHaveFocus();
    expect(pending).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    expect(history).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel", { name: "已处理" });
    expect(panel.id).toBe(history.getAttribute("aria-controls"));
    expect(within(panel).getByRole("table", { name: "审阅队列" })).toBeVisible();
    expect(document.getElementById(pending.getAttribute("aria-controls")!)).not.toBeVisible();
  });

  it("exposes queue/detail headings and Chinese status labels without Committer/User leaks", () => {
    renderReview();

    expect(screen.getByRole("heading", { level: 2, name: "审阅队列" })).toBeInTheDocument();
    const detail = screen.getByRole("complementary", { name: "审阅详情" });
    expect(within(detail).getByRole("heading", { level: 2, name: "审阅详情" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "审阅队列" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("未记录冻结的单位与风险信息");
    expect(screen.queryByText(/快捷键/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Committer/)).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "审阅队列" })).not.toHaveTextContent("User");
  });

  it("lets keyboard users move the selected queue row without ⌘/Ctrl", () => {
    renderReview();

    const table = screen.getByRole("table", { name: "审阅队列" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    rows[0].focus();
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveAttribute("aria-selected", "false");

    fireEvent.keyDown(rows[1], { key: "k" });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(rows[0], { key: "j", metaKey: true });
    fireEvent.keyDown(rows[0], { key: "j", ctrlKey: true });
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
  });

  it("focuses review detail with Enter and reads a scalar comparison without a redundant modal", () => {
    renderReview();

    const row = screen.getByRole("button", { name: /查看 快充输入电流调整 提交详情/ }).closest("tr")!;
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByRole("complementary", { name: "审阅详情" })).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "提交详情" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /查看提交详情（/ })).not.toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "审阅详情" })).getByRole("region", { name: "本条变更" })).toBeInTheDocument();
  });

  it("opens complex evidence explicitly and returns focus to its trigger on Escape", async () => {
    const user = userEvent.setup();
    renderReview({ ...hardwareCommitterState(), activeRoleId: "admin", parameterSubmissionRounds: [], parameterInitializationReviews: [],
      changeRequests: [{ ...initialState.changeRequests[0], valueKind: "complex", currentValue: "mode = 1;\nlimit = 3850;", targetValue: "mode = 1;\nlimit = 3200;" }] });
    const trigger = screen.getByRole("button", { name: "展开完整对比" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "完整对比" });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("limit = 3850;");
    expect(dialog).toHaveTextContent("limit = 3200;");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("exposes the module filter as a collapsed hierarchy with ancestor selection", () => {
    const state = hardwareCommitterState();
    renderReview({ ...state, changeRequests: [...state.changeRequests, { ...state.changeRequests[0], id: "module-a11y-other",
      module: "Battery Safety", status: "硬件Committer检视" }] });

    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    const menu = screen.getByRole("group", { name: "模块筛选" });
    const tree = within(menu).getByRole("tree");
    expect(within(tree).getByRole("treeitem", { name: "Power" })).toBeInTheDocument();
    expect(within(tree).queryByRole("treeitem", { name: "Charging" })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole("checkbox", { name: "Power" }));
    const selectedPower = within(menu).getByRole("treeitem", { name: "Power" });
    expect(selectedPower).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(selectedPower).getByRole("button", { name: "展开" }));
    expect(within(menu).getByRole("treeitem", { name: "Charging" })).toHaveAttribute("aria-checked", "true");
  });

  it("labels a retained initialization review whose submitter account was deleted", () => {
    const state = hardwareCommitterState();
    const project = state.configDraft.projects[0];
    const draft = {
      id: "init-deleted-user",
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      ownerUserId: null,
      sourceProjectIds: [],
      primarySourceProjectId: "",
      supplementSourceProjectIds: [],
      selectedModules: [],
      selectedRisks: [],
      selectedParameterIds: [],
      parameterSnapshots: [],
      notes: "",
      createdBy: null,
      createdAt: "2026-08-28T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z"
    };
    renderReview({
      ...state,
      parameterInitializationDrafts: [draft],
      parameterInitializationReviews: [{
        id: "review-deleted-user",
        draftId: draft.id,
        projectId: draft.projectId,
        status: "pending",
        submittedBy: null,
        submittedAt: "2026-08-28T00:00:00.000Z"
      }]
    });

    expect(screen.getAllByText(/已注销用户/).length).toBeGreaterThan(0);
  });
});
