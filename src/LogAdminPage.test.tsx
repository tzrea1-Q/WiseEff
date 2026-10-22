import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "./components/layout";
import { LogAdminPage, type LogAdminPageProps } from "./LogAdminPage";
import type { LogRuntimeActions } from "./application/logs/logRuntime";
import { createPrototypeState } from "./mockData";
import { createTestLogRuntimeActions as createLogActions } from "./test/harness";
import { mockSkillWorkspace } from "./infrastructure/mock/logSkills";
import { WiseEffApiError } from "./infrastructure/http/apiClient";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => window.history.replaceState(null, "", "/log-admin?tab=records"));

it.each(["records", "domains", "skills", "quality"])("keeps one table, aligned-list slots and one rightmost primary action on tab %s", async (tab) => {
  window.history.replaceState(null, "", `/log-admin${tab ? `?tab=${tab}` : ""}`);
  renderPage({ logActions: createLogActions() });
  const table = await screen.findByRole("table");
  const panel = screen.getByRole("tabpanel");
  const list = table.closest(".admin-list-page")!;
  const header = within(panel).getByRole("group", { name: /操作$/ });
  const filters = within(panel).getByRole("group", { name: /筛选$/ });
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(header.parentElement).toBe(list);
  expect(filters.parentElement).toBe(list);
  for (const [before, after] of [[screen.getByRole("tablist"), header], [header, filters], [filters, table]]) {
    expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(filters).not.toBeEmptyDOMElement();
  const primary = header.querySelectorAll('[data-slot="button"][data-variant="default"]');
  expect(primary).toHaveLength(1);
  expect(primary[0]).toHaveTextContent(tab === "skills" || tab === "domains" ? "新建技能" : "导出报表");
  expect(primary[0]).toBe(header.querySelector(".admin-list-page__header-actions")!.lastElementChild);
  expect(screen.getAllByRole("button", { name: "刷新" })).toHaveLength(1);
  if (tab !== "skills" && tab !== "domains") {
    expect(within(filters).getByRole("group", { name: "时间窗口" })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "刷新" })).toHaveAttribute("data-variant", "outline");
  }
});

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions, setLeadingActions: () => undefined }), [setStableActions]);

  return (
    <TopBarActionsContext.Provider value={contextValue}>
      <header className="topbar">
        <div className="topbar-page-actions" role="toolbar" aria-label="日志分析管理后台页面操作">
          {actions}
        </div>
      </header>
      {children}
    </TopBarActionsContext.Provider>
  );
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function renderPage({
  logActions,
  stateOverrides,
  skillRepository,
  apiMode
}: { logActions?: LogRuntimeActions; stateOverrides?: Partial<ReturnType<typeof createPrototypeState>>; skillRepository?: LogAdminPageProps["skillRepository"]; apiMode?: boolean } = {}) {
  const state = { ...createPrototypeState(), activeRoleId: "admin", ...stateOverrides };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();
  const utils = render(
    <TopBarActionsHarness>
      <LogAdminPage
        state={state}
        dispatch={dispatch}
        onNavigate={onNavigate}
        search=""
        logActions={logActions}
        skillRepository={skillRepository}
        apiMode={apiMode}
      />
    </TopBarActionsHarness>
  );

  return { ...utils, state, dispatch, onNavigate };
}

it("opens skill package import from the skill list toolbar and links to the imported workspace", async () => {
  window.history.replaceState(null, "", "/log-admin?tab=skills");
  const skillRepository = { importSkillPackage: vi.fn().mockResolvedValue(mockSkillWorkspace("skill-charging")) };
  const { onNavigate } = renderPage({ logActions: createLogActions(), skillRepository, apiMode: true });
  await userEvent.click(await screen.findByRole("button", { name: "导入技能包" }));
  const dialog = screen.getByRole("dialog", { name: "导入技能包" });
  await userEvent.upload(within(dialog).getByTestId("file-drop-zone-input"), new File(["zip"], "skill.zip", { type: "application/zip" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "校验并导入" }));
  await userEvent.click(await within(dialog).findByRole("link", { name: "打开技能工作区" }));
  expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/skill-charging");
});

function getLogRow(fileName: RegExp) {
  const table = screen.getByRole("table", { name: "日志分析记录" });
  return within(table).getByText(fileName).closest("tr")!;
}

describe("LogAdminPage M3 skeleton", () => {
  it("opens the workspace from a skill name", async () => {
    window.history.replaceState(null, "", "/log-admin?tab=skills");
    const actions = createLogActions({ listLogDomains: vi.fn(async () => [{ id: "skill-charging", name: "充电诊断", status: "active" as const,
      createdAt: "2026-10-18", updatedAt: "2026-10-18" }]) });
    const { onNavigate } = renderPage({ logActions: actions });
    const link = await screen.findByRole("link", { name: "充电诊断" });
    expect(link).toHaveAttribute("href", "/log-admin/skills/skill-charging");
    await userEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/skill-charging");
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
  it("restores URL collection tabs without showing stacked collections", async () => {
    window.history.replaceState(null, "", "/log-admin?tab=quality&keep=1");
    renderPage({ logActions: createLogActions() });
    expect(await screen.findByRole("table", { name: "分析质量反馈聚合" })).toBeVisible();
    expect(screen.queryByRole("table", { name: "日志分析记录" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "日志分析记录" }));
    expect(window.location.search).toBe("?tab=records&keep=1");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("日志分析记录");
    act(() => {
      window.history.replaceState(null, "", "/log-admin?tab=domains");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("tab", { name: "分析技能" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("table")).toHaveLength(1);
  });
  it("keeps actions in the standard list header without duplicating topbar controls or the page title", () => {
    renderPage();

    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /导出报表/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "日志分析管理后台页面操作" })).toBeEmptyDOMElement();
    expect(screen.queryByRole("heading", { level: 1, name: "日志分析管理后台" })).not.toBeInTheDocument();
  });

  it("keeps dashboard metric cards out of the admin backend", () => {
    renderPage();

    expect(screen.queryByText("今日分析")).not.toBeInTheDocument();
    expect(screen.queryByText("平均置信度")).not.toBeInTheDocument();
    expect(screen.queryByText("失败文件")).not.toBeInTheDocument();
    expect(screen.queryByText("吞吐峰值")).not.toBeInTheDocument();
  });

  it("renders DataTable with log records", () => {
    renderPage();
    const table = screen.getByRole("table", { name: "日志分析记录" });

    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["文件", "技能", "状态", "置信度", "上传者", "上传时间"]);
    expect(within(table).queryByText("报告 ID")).not.toBeInTheDocument();
    expect(within(table).getByText(/charging_thermal_trace/)).toBeInTheDocument();
  });

  it("labels table confidence by analysis provenance and keeps failed rows as a dash", () => {
    const [, complete, failed] = createPrototypeState().logs;
    renderPage({
      stateOverrides: {
        logs: [
          { ...complete, id: "log-agent", fileName: "agent_analysis.log", analysisSource: "agent", confidence: 88 },
          {
            ...complete,
            id: "log-rules",
            fileName: "rules_fallback.log",
            analysisSource: "rules-fallback",
            confidence: 72
          },
          { ...complete, id: "log-legacy", fileName: "legacy_report.log", confidence: 81 },
          failed
        ]
      }
    });

    const agentRow = getLogRow(/agent_analysis/);
    expect(within(agentRow).getByText("AI")).toBeInTheDocument();
    expect(within(agentRow).getByText("88%")).toBeInTheDocument();

    const rulesRow = getLogRow(/rules_fallback/);
    expect(within(rulesRow).getByText("规则")).toBeInTheDocument();
    expect(within(rulesRow).getByText("72%")).toBeInTheDocument();

    const legacyRow = getLogRow(/legacy_report/);
    expect(within(legacyRow).getByText("规则")).toBeInTheDocument();
    expect(within(legacyRow).getByText("81%")).toBeInTheDocument();

    const failedRow = getLogRow(/thermal_snapshot/);
    expect(within(failedRow).getByText("-")).toBeInTheDocument();
    expect(within(failedRow).queryByText("模型自估")).not.toBeInTheDocument();
    expect(within(failedRow).queryByText("规则评分")).not.toBeInTheDocument();
  });

  it("renders TimeWindowSelect with three options", () => {
    renderPage();
    const group = screen.getByRole("group", { name: /时间窗口/ });

    expect(within(group).getByRole("button", { name: "今日" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "7 日" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "30 日" })).toBeInTheDocument();
  });

  it("filters table from the 状态 column header", async () => {
    renderPage();

    expect(screen.queryByRole("combobox", { name: "状态" })).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "日志分析记录" });
    const statusHeader = within(table).getByRole("columnheader", { name: /状态/ });

    await userEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    await userEvent.click(within(statusHeader).getByRole("checkbox", { name: "失败" }));

    expect(within(table).getByText(/thermal_snapshot\.bin/)).toBeInTheDocument();
  });

  it("searches by skill and keeps only the status column filter", async () => {
    const logs = createPrototypeState().logs.map((log, index) => ({ ...log, logDomainName: index === 0 ? "充电诊断" : undefined }));
    renderPage({ stateOverrides: { logs } });
    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getAllByRole("button", { name: /^筛选/ })).toHaveLength(1);
    expect(screen.queryByRole("columnheader", { name: /来源模块|分析阶段|报告 ID/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("搜索文件名、技能或结论"), "充电诊断");
    expect(within(table).getByText(logs[0].fileName)).toBeInTheDocument();
    expect(within(table).queryByText(logs[1].fileName)).not.toBeInTheDocument();
  });

  it("resets filters when 重置 button is clicked", async () => {
    renderPage();
    const search = screen.getByPlaceholderText(/搜索文件名/);

    await userEvent.type(search, "nonexistent");
    expect(screen.getByText(/未匹配任何记录/)).toBeInTheDocument();

    const reset = screen.getAllByRole("button").find((button) => button.textContent === "重置筛选");
    expect(reset).toBeDefined();
    await userEvent.click(reset as HTMLElement);

    expect(screen.queryByText(/未匹配任何记录/)).not.toBeInTheDocument();
  });
});

describe("LogAdminPage · row click + drawer actions", () => {
  it("fetches only the opened record's detail through the existing repository and refetches on reopening", async () => {
    const original = createPrototypeState().logs[0];
    const summary = { ...original, evidence: [] };
    const detail = { ...original, conclusion: "来自单条详情的结论", evidence: Array.from({ length: 6 }, (_, index) => ({ ...original.evidence[0], id: `detail-${index}`, inference: `详情证据 ${index + 1}` })) };
    const loading = deferred<typeof detail>();
    const getLog = vi.fn().mockReturnValueOnce(loading.promise).mockResolvedValue(detail);
    const { onNavigate } = renderPage({ stateOverrides: { logs: [summary] }, logActions: createLogActions(), skillRepository: { getLog }, apiMode: true });
    expect(getLog).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(getLog).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: summary.fileName }));
    expect(getLog).toHaveBeenCalledExactlyOnceWith(summary.id);
    expect(screen.getByRole("status")).toHaveTextContent("正在加载详情…");
    expect(screen.queryByText("证据链（0）")).not.toBeInTheDocument();
    await act(async () => { loading.resolve(detail); });
    expect(await screen.findByText("证据链（6）")).toBeInTheDocument();
    expect(screen.getByText(detail.conclusion)).toBeInTheDocument();
    for (const item of detail.evidence) expect(screen.getByText(item.inference)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "打开报告" }));
    expect(onNavigate).toHaveBeenCalledWith(`/logs?id=${detail.reportId}`);
    await userEvent.click(screen.getByRole("button", { name: summary.fileName }));
    await waitFor(() => expect(getLog).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("证据链（6）")).toBeInTheDocument();
  });

  it("opens drawer when row is clicked", async () => {
    renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);

    expect(screen.getByText("结论")).toBeInTheDocument();
    expect(screen.queryByText("AI 摘要")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /证据链/ })).toBeInTheDocument();
  });

  it("dispatches LOG_ADMIN_REANALYZE_LOG on reanalyze without runtime actions", async () => {
    const { dispatch } = renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /重新分析/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_REANALYZE_LOG" }));
  });

  it("calls runtime rerun on reanalyze when logActions are provided", async () => {
    const logActions = createLogActions();
    const { dispatch } = renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /重新分析/ }));

    expect(logActions.rerun).toHaveBeenCalledWith({ logId: "log-active" });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_REANALYZE_LOG" }));
  });

  it("dispatches LOG_ADMIN_ARCHIVE_LOG and shows undo toast without runtime actions", async () => {
    const { dispatch } = renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /归档/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_ARCHIVE_LOG" }));
    await waitFor(() => {
      expect(screen.getByText(/可随时在「已归档」视图恢复/)).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_UNARCHIVE_LOG" }));
  });

  it("calls runtime archive and disables archive while it is pending", async () => {
    const archive = deferred();
    const logActions = createLogActions({ archive: vi.fn(() => archive.promise) });
    const { dispatch } = renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    const archiveButton = screen.getByRole("button", { name: /归档/ });
    await userEvent.click(archiveButton);

    expect(logActions.archive).toHaveBeenCalledWith("log-active");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_ARCHIVE_LOG" }));
    expect(archiveButton).toBeDisabled();
    expect(archiveButton).toHaveAttribute("aria-busy", "true");

    archive.resolve();
    await waitFor(() => {
      expect(screen.getByText(/可随时在「已归档」视图恢复/)).toBeInTheDocument();
    });
  });

  it("keeps the drawer open and skips undo toast when runtime archive rejects", async () => {
    const archive = deferred();
    const logActions = createLogActions({ archive: vi.fn(() => archive.promise) });
    const { dispatch } = renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    const archiveButton = screen.getByRole("button", { name: /归档/ });
    await userEvent.click(archiveButton);

    await act(async () => {
      archive.reject(Object.assign(new Error("archive failed"), { alreadyNotified: true as const }));
      await archive.promise.catch(() => undefined);
    });

    expect(archiveButton).toBeInTheDocument();
    expect(archiveButton).not.toBeDisabled();
    expect(archiveButton).not.toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_ARCHIVE_LOG" }));
  });

  it("keeps the drawer open when runtime rerun rejects", async () => {
    const rerun = deferred();
    const logActions = createLogActions({ rerun: vi.fn(() => rerun.promise) });
    renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    const rerunButton = screen.getByRole("button", { name: /重新分析/ });
    await userEvent.click(rerunButton);

    await act(async () => {
      rerun.reject(Object.assign(new Error("rerun failed"), { alreadyNotified: true as const }));
      await rerun.promise.catch(() => undefined);
    });

    expect(rerunButton).toBeInTheDocument();
    expect(rerunButton).not.toBeDisabled();
    expect(rerunButton).not.toHaveAttribute("aria-busy", "true");
  });

  it("calls runtime unarchive from undo toast and prevents duplicate undo clicks while pending", async () => {
    const unarchive = deferred();
    const logActions = createLogActions({ unarchive: vi.fn(() => unarchive.promise) });
    renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /归档/ }));
    const undoButton = await screen.findByRole("button", { name: "撤销" });

    await userEvent.click(undoButton);

    expect(logActions.unarchive).toHaveBeenCalledWith("log-active");
    expect(undoButton).toBeDisabled();
    expect(undoButton).toHaveAttribute("aria-busy", "true");

    await userEvent.click(undoButton);
    expect(logActions.unarchive).toHaveBeenCalledTimes(1);

    unarchive.resolve();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "撤销" })).not.toBeInTheDocument();
    });
  });

  it("keeps the undo toast when runtime unarchive rejects", async () => {
    const unarchive = deferred();
    const logActions = createLogActions({ unarchive: vi.fn(() => unarchive.promise) });
    renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /归档/ }));
    const undoButton = await screen.findByRole("button", { name: "撤销" });

    await userEvent.click(undoButton);
    await act(async () => {
      unarchive.reject(Object.assign(new Error("unarchive failed"), { alreadyNotified: true as const }));
      await unarchive.promise.catch(() => undefined);
    });

    expect(screen.getByRole("button", { name: "撤销" })).toBeInTheDocument();
    expect(undoButton).not.toBeDisabled();
    expect(undoButton).not.toHaveAttribute("aria-busy", "true");
  });

  it("calls runtime feedback from the drawer", async () => {
    const logActions = createLogActions();
    renderPage({ logActions });
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /有帮助/ }));

    expect(logActions.submitFeedback).toHaveBeenCalledWith({ logId: "log-active", rating: "helpful" });
  });

  it("dispatches a feedback notification from the drawer without runtime actions", async () => {
    const { dispatch } = renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: "有帮助" }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_NOTIFICATION" }));
  });

  it("disables drawer action buttons for non-admin roles", async () => {
    const state = createPrototypeState();
    const viewerState = { ...state, activeRoleId: "hardware" };
    const dispatch = vi.fn();
    render(
      <TopBarActionsHarness>
        <LogAdminPage state={viewerState} dispatch={dispatch} onNavigate={vi.fn()} search="" />
      </TopBarActionsHarness>
    );
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);

    expect(screen.getByRole("button", { name: /重新分析/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /归档/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /有帮助/ })).toBeDisabled();
  });
});

describe("LogAdminPage · archived view", () => {
  it("shows archived logs in a dedicated view with an inline restore action", async () => {
    const base = createPrototypeState();
    const archivedId = base.logs[1]!.id;
    const { dispatch } = renderPage({
      stateOverrides: { archivedLogIds: [archivedId] }
    });

    // Active view hides archived records.
    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).queryByText(base.logs[1]!.fileName)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: /已归档（1）/ }));
    expect(within(screen.getByRole("table", { name: "日志分析记录" })).getByText(base.logs[1]!.fileName)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "恢复" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId: archivedId });
  });

  it("loads archived records through the runtime and restores via unarchive", async () => {
    const base = createPrototypeState();
    const archivedId = base.logs[1]!.id;
    const logActions = createLogActions();
    renderPage({ logActions, stateOverrides: { archivedLogIds: [archivedId] } });

    await userEvent.click(screen.getByRole("radio", { name: /已归档（1）/ }));
    expect(logActions.refresh).toHaveBeenCalledWith({ includeArchived: true });

    await userEvent.click(screen.getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "恢复" }));
    await waitFor(() => expect(logActions.unarchive).toHaveBeenCalledWith(archivedId));
  });
});

describe("LogAdminPage · access control", () => {
  it("does not render the shared user permissions entry", () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    const onNavigate = vi.fn();
    render(
      <TopBarActionsHarness>
        <LogAdminPage state={adminState} dispatch={vi.fn()} onNavigate={onNavigate} search="" />
      </TopBarActionsHarness>
    );

    expect(screen.queryByText("Jane Smith")).not.toBeInTheDocument();

    expect(screen.queryByText("Shared user permissions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage user permissions" })).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("LogAdminPage · insight bar", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem("log-admin-insight-dismissed");
    } catch {
      // ignore jsdom storage setup
    }
  });

  it("renders insight bar when failed log exists", () => {
    renderPage();

    expect(screen.getByText(/日志解析失败/)).toBeInTheDocument();
  });

  it("triggers locate filter when 定位失败记录 clicked", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /定位失败记录/ }));

    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByText(/thermal_snapshot\.bin/)).toBeInTheDocument();
  });

  it("prompts mock-mode users to open 小泽 on 交给小泽", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /交给小泽分析/ }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "PUSH_NOTIFICATION",
        message: expect.stringMatching(/小泽/)
      })
    );
  });

  it("hides insight bar after dismiss + persists in localStorage", async () => {
    renderPage();

    await userEvent.click(screen.getByRole("button", { name: /关闭今日提示/ }));

    expect(screen.queryByText(/日志解析失败/)).not.toBeInTheDocument();
    expect(localStorage.getItem("log-admin-insight-dismissed")).toBeTruthy();
  });
});

describe("LogAdminPage · page header actions", () => {
  it("dispatches LOG_ADMIN_EXPORT_REPORT on 导出报表 click", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /导出报表/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_EXPORT_REPORT", timeWindow: "all" }));
  });

  it("dispatches LOG_ADMIN_SYNC_LOGS on 刷新 click without runtime actions", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_ADMIN_SYNC_LOGS" });
  });

  it("calls runtime refresh with archived logs on 刷新 click", async () => {
    const refresh = deferred();
    const logActions = createLogActions({ refresh: vi.fn(() => refresh.promise) });
    const { dispatch } = renderPage({ logActions });

    const syncButton = screen.getByRole("button", { name: "刷新" });
    await userEvent.click(syncButton);

    expect(logActions.refresh).toHaveBeenCalledWith({ includeArchived: true });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "LOG_ADMIN_SYNC_LOGS" });
    expect(syncButton).toBeDisabled();
    expect(syncButton).toHaveAttribute("aria-busy", "true");

    refresh.resolve();
    await waitFor(() => {
      expect(syncButton).not.toBeDisabled();
    });
  });
});

describe("LogAdminPage 分析技能治理", () => {
  beforeEach(() => window.history.replaceState(null, "", "/log-admin?tab=domains"));

  it("renames in place, retains failed input and links to the actual name occupier", async () => {
    let domain = { ...chargingDomain };
    const logActions = createLogActions({ listLogDomains: vi.fn(async () => [domain]), updateLogDomain: vi.fn()
      .mockRejectedValueOnce(new WiseEffApiError("CONFLICT", "此名称已被归档技能占用，请使用其他名称。", {
        conflictingSkill: { id: "occupied-skill", name: "已占用名称", status: "archived" },
      }, "rename-conflict"))
      .mockImplementation(async input => { domain = { ...domain, name: input.name }; return domain; }) });
    renderPage({ logActions, apiMode: true });
    await userEvent.click(await screen.findByRole("button", { name: "charging-power：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "改名" }));
    const dialog = screen.getByRole("dialog", { name: "修改技能名称" });
    const name = within(dialog).getByLabelText("名称", { exact: true });
    expect(name).toHaveValue(chargingDomain.name);
    await userEvent.clear(name); await userEvent.type(name, "已占用名称{Enter}");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("归档技能占用");
    expect(name).toHaveValue("已占用名称");
    expect(within(dialog).getByRole("link", { name: "查看占用技能「已占用名称」" })).toHaveAttribute("href", "/log-admin/skills/occupied-skill");
    await userEvent.clear(name); await userEvent.type(name, "修改后的技能{Enter}");
    expect(await screen.findByRole("link", { name: "修改后的技能" })).toHaveAttribute("href", `/log-admin/skills/${chargingDomain.id}`);
    expect(logActions.updateLogDomain).toHaveBeenLastCalledWith({ domainId: chargingDomain.id, name: "修改后的技能" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("restores an archived skill after explicit confirmation and keeps failure retryable", async () => {
    let domain = { ...chargingDomain, status: "archived" as "active" | "archived" };
    const logActions = createLogActions({ listLogDomains: vi.fn(async () => [domain]), updateLogDomain: vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(async input => { domain = { ...domain, status: input.status }; return domain; }) });
    renderPage({ logActions, apiMode: true });
    await userEvent.click(await screen.findByRole("button", { name: "charging-power：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "恢复" }));
    const dialog = screen.getByRole("dialog", { name: "恢复技能" });
    expect(dialog).toHaveTextContent("已吊销的集成凭据不会重新启用");
    expect(logActions.updateLogDomain).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "恢复技能" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("请重试");
    expect(within(dialog).getByLabelText("名称")).toHaveValue(chargingDomain.name);
    await userEvent.click(within(dialog).getByRole("button", { name: "恢复技能" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(logActions.updateLogDomain).toHaveBeenLastCalledWith({ domainId: chargingDomain.id, name: chargingDomain.name, status: "active" });
  });

  it("confirms domain archival from overflow before writing", async () => {
    const logActions = createLogActions({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain]) });
    renderPage({ logActions });
    const table = await screen.findByRole("table", { name: "分析技能列表" });
    await userEvent.click(within(table).getByRole("button", { name: "charging-power：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    expect(logActions.archiveLogDomain).not.toHaveBeenCalled();
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "归档技能" }));
    await waitFor(() => expect(logActions.archiveLogDomain).toHaveBeenCalledWith("domain-charging"));
  });

  it("removes legacy editing after visiting another collection", async () => {
    renderPage({ logActions: createLogActions({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain]) }) });
    await userEvent.click(await screen.findByRole("button", { name: "新建技能" }));
    await userEvent.type(screen.getByLabelText("名称"), "未保存技能");
    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    await userEvent.click(screen.getByRole("tab", { name: "日志分析记录" }));
    await userEvent.click(screen.getByRole("tab", { name: "分析技能" }));
    expect(screen.queryByRole("form", { name: "编辑分析技能" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });
  const chargingDomain = {
    id: "domain-charging",
    currentRevision: { id: "revision-2", number: 2, publishedAt: "2026-10-18T00:00:00.000Z" },
    helpfulRate7d: 0.75,
    name: "charging-power",
    description: "充电/电源子系统内核日志",
    status: "active" as const,
    formatProfile: { timestampPattern: "^\\[" },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  };

  it("lists governed domains including archived ones", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([chargingDomain, { ...chargingDomain, id: "domain-old", name: "legacy", status: "archived" as const }])
    });
    renderPage({ logActions });

    await waitFor(() => expect(logActions.listLogDomains).toHaveBeenCalledWith({ includeArchived: true }));
    const table = await screen.findByRole("table", { name: "分析技能列表" });
    const toolbar = screen.getByRole("group", { name: "分析技能治理操作" });
    expect(toolbar.querySelector(".admin-list-page__header-content")).toBeEmptyDOMElement();
    expect(screen.queryByText("分析技能", { selector: ".admin-list-page__header-content" })).not.toBeInTheDocument();
    expect(within(table).getByText("charging-power")).toBeInTheDocument();
    expect(within(table).getAllByText("已发布 v2")).toHaveLength(1);
    expect(within(table).getAllByText("75%")).toHaveLength(2);
    expect(within(table).getByRole("columnheader", { name: /更新时间/ })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /有帮助率/ })).toBeInTheDocument();
    expect(within(table).getByText("legacy")).toBeInTheDocument();
    expect(within(table).getByText("已归档")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /名称/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("columnheader", { name: /状态/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("button", { name: "筛选状态" })).toBeInTheDocument();
  });

  it("keeps a single create control in the toolbar when no skills exist", async () => {
    const { onNavigate } = renderPage({ logActions: createLogActions({ listLogDomains: vi.fn().mockResolvedValue([]) }) });
    const table = await screen.findByRole("table", { name: "分析技能列表" });
    expect(within(table).getByText("还没有分析技能")).toBeInTheDocument();
    expect(table.querySelectorAll(".section-empty button")).toHaveLength(1);
    await userEvent.click(within(table).getByRole("button", { name: "前往日志分析" }));
    expect(onNavigate).toHaveBeenCalledWith("/logs");
    expect(screen.getAllByRole("button", { name: "新建技能" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "新建技能" }));
    expect(screen.getByRole("dialog", { name: "新建技能" })).toBeInTheDocument();
  });

  it("keeps the skills table mounted while loading with no empty-state action", async () => {
    const loading = deferred<[]>();
    renderPage({ logActions: createLogActions({ listLogDomains: vi.fn().mockReturnValue(loading.promise) }) });
    const table = screen.getByRole("table", { name: "分析技能列表" });
    expect(within(table).getByRole("status", { name: "正在加载分析技能" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建技能" })).toBeDisabled();
    await act(async () => { loading.resolve([]); });
    expect(await within(table).findByText("还没有分析技能")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "分析技能列表" })).toBe(table);
    expect(screen.getByRole("button", { name: "新建技能" })).toBeEnabled();
  });

  it("sorts the domain list from the 名称 column header", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([
        chargingDomain,
        { ...chargingDomain, id: "domain-old", name: "legacy", status: "archived" as const }
      ])
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "分析技能列表" });
    const nameHeader = within(table).getByRole("columnheader", { name: /名称/ });
    await userEvent.click(within(nameHeader).getByRole("button", { name: /名称/ }));

    expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(within(bodyRows[0]).getByText("charging-power")).toBeInTheDocument();
    expect(within(bodyRows[1]).getByText("legacy")).toBeInTheDocument();
  });

  it("filters the domain list from the 状态 column header", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([
        chargingDomain,
        { ...chargingDomain, id: "domain-old", name: "legacy", status: "archived" as const }
      ])
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "分析技能列表" });
    const statusHeader = within(table).getByRole("columnheader", { name: /状态/ });
    await userEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    await userEvent.click(within(statusHeader).getByRole("checkbox", { name: "已归档" }));

    expect(within(statusHeader).getByRole("button", { name: "筛选状态" })).toHaveClass("active");
    expect(within(table).getByText("legacy")).toBeInTheDocument();
    expect(within(table).queryByText("charging-power")).not.toBeInTheDocument();
  });

  it("replaces inline editing with workspace navigation and a compact operations menu", async () => {
    const logActions = createLogActions({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain]) });
    const { onNavigate } = renderPage({ logActions });
    const table = await screen.findByRole("table", { name: "分析技能列表" });
    const row = within(table).getByText(chargingDomain.name).closest("tr")!;
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["名称", "状态", "近 7 天分析", "有帮助率", "更新时间", "操作"]);
    expect(within(row).getByTitle(chargingDomain.description)).toHaveClass("truncate");
    expect(screen.getByText("上传日志时会自动推荐匹配的技能；没有匹配时按通用分析处理。")).toBeInTheDocument();
    expect(screen.queryByText(/格式画像|未分类域|分析侧重/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    await userEvent.click(row);
    expect(onNavigate).toHaveBeenCalledWith("/log-admin/skills/domain-charging");
    await userEvent.click(within(row).getByRole("button", { name: /：更多$/ }));
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["改名", "导出技能包", "删除实验技能", "归档"]);
    expect(screen.getByRole("menuitem", { name: "删除实验技能" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "改名" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: "知识条目" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "集成与结果回调" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("domain-knowledge-links-editor")).not.toBeInTheDocument();
    expect(logActions.listLogDomainKnowledgeLinks).not.toHaveBeenCalled();
    expect(logActions.updateLogDomain).not.toHaveBeenCalled();
  });

  it("shows published, unpublished and archived statuses with analysis counts", async () => {
    renderPage({ logActions: createLogActions({ listLogDomains: vi.fn().mockResolvedValue([
      { ...chargingDomain, analyses7d: 23 }, { ...chargingDomain, id: "draft", name: "草稿技能", hasDraft: true },
      { ...chargingDomain, id: "archived", name: "旧技能", hasDraft: true, status: "archived" }
    ]) }) });
    const table = await screen.findByRole("table", { name: "分析技能列表" });
    expect(within(table).getByText("23")).toBeInTheDocument();
    expect(within(table).getByText("有未发布更改")).toBeInTheDocument();
    expect(within(table).getByText("已发布 v2")).toBeInTheDocument();
    expect(within(table).getByText("已归档")).toBeInTheDocument();
    expect(within(table).getAllByText(/^2026\/08\/\d{2} \d{2}:\d{2}$/)).toHaveLength(3);
  });

  it("opens the existing export dialog from the row menu without opening the workspace", async () => {
    const skill = mockSkillWorkspace("skill-charging")!;
    const skillRepository = { getLogSkill: vi.fn().mockResolvedValue(skill), exportSkillPackage: vi.fn() };
    const { onNavigate } = renderPage({ logActions: createLogActions({ listLogDomains: vi.fn().mockResolvedValue([chargingDomain]) }), skillRepository });
    await userEvent.click(await screen.findByRole("button", { name: "charging-power：更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "导出技能包" }));
    expect(await screen.findByRole("dialog", { name: "导出技能包" })).toBeInTheDocument();
    expect(skillRepository.getLogSkill).toHaveBeenCalledWith(chargingDomain.id);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("archives a domain from the list", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([chargingDomain]),
      archiveLogDomain: vi.fn().mockResolvedValue({ ...chargingDomain, status: "archived" as const })
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "分析技能列表" });
    await userEvent.click(within(table).getByRole("button", { name: /：更多$/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "归档" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "归档技能" }));

    await waitFor(() => expect(logActions.archiveLogDomain).toHaveBeenCalledWith("domain-charging"));
  });

  it("shows the mock-mode hint without runtime actions", () => {
    renderPage();

    expect(screen.getByTestId("log-domain-governance")).toHaveTextContent(/请连接服务后管理分析技能/);
  });

  it("gates governance behind the admin role", () => {
    const state = { ...createPrototypeState(), activeRoleId: "user" };
    const dispatch = vi.fn();
    render(
      <TopBarActionsHarness>
        <LogAdminPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="" logActions={createLogActions()} />
      </TopBarActionsHarness>
    );

    expect(screen.getByTestId("log-domain-governance")).toHaveTextContent(/需要管理员权限/);
    expect(screen.queryByRole("button", { name: "新建技能" })).not.toBeInTheDocument();
  });
});

describe("LogAdminPage 分析质量洞察", () => {
  beforeEach(() => window.history.replaceState(null, "", "/log-admin?tab=quality"));
  const agentInsight = {
    logDomainId: "domain-charging",
    logDomainName: "charging-power",
    analysisSource: "agent" as const,
    promptVersion: "log-analysis/v2",
    totalCount: 4,
    helpfulCount: 3,
    helpfulRate: 0.75,
    lastFeedbackAt: "2026-08-13T02:00:00.000Z"
  };
  const uncategorizedInsight = {
    logDomainId: null,
    logDomainName: null,
    analysisSource: "rules-fallback" as const,
    promptVersion: null,
    totalCount: 2,
    helpfulCount: 0,
    helpfulRate: 0,
    lastFeedbackAt: "2026-08-12T02:00:00.000Z"
  };

  it("renders aggregated helpful rates per domain, source, and prompt version", async () => {
    const logActions = createLogActions({
      listFeedbackInsights: vi.fn().mockResolvedValue([agentInsight, uncategorizedInsight])
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "分析质量反馈聚合" });
    await waitFor(() => expect(logActions.listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "7d" }));
    expect(within(table).getByText("charging-power")).toBeInTheDocument();
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["技能", "分析来源", "反馈数", "有帮助率"]);
    expect(within(table).queryByText("log-analysis/v2")).not.toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /版本/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Prompt|跟随右上角时间窗口/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "分析质量操作" }).querySelector(".admin-list-page__header-content")).toBeEmptyDOMElement();
    expect(within(table).getByText("75%（3/4）")).toBeInTheDocument();
    expect(within(table).getByText("通用分析")).toBeInTheDocument();
    expect(within(table).getByText("降级 · 规则回退")).toBeInTheDocument();
    expect(within(table).getByText("0%（0/2）")).toBeInTheDocument();
  });

  it("refetches insights when the time window changes", async () => {
    const listFeedbackInsights = vi.fn().mockResolvedValue([agentInsight]);
    renderPage({ logActions: createLogActions({ listFeedbackInsights }) });

    await waitFor(() => expect(listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "7d" }));
    await userEvent.click(screen.getByRole("button", { name: "7 日" }));
    await waitFor(() => expect(listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "7d" }));
  });

  it("exports quality data from the quality tab rather than record rows", async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return "blob:quality"; }), revokeObjectURL: vi.fn() }));
    renderPage({ logActions: createLogActions({ listFeedbackInsights: vi.fn().mockResolvedValue([agentInsight]) }) });
    await screen.findByText("75%（3/4）");
    await userEvent.click(screen.getByRole("button", { name: "导出报表" }));
    expect(blobs).toHaveLength(1);
    const exported = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); });
    expect(JSON.parse(exported)).toMatchObject({ timeWindow: "7d", rows: [agentInsight] });
    expect(JSON.parse(exported)).not.toHaveProperty("metrics");
  });

  it("shows the honest empty state when no feedback exists", async () => {
    renderPage({ logActions: createLogActions() });

    const section = screen.getByTestId("feedback-quality-insights");
    expect(await within(section).findByText("暂无反馈")).toBeInTheDocument();
    const table = within(section).getByRole("table");
    expect(table.querySelectorAll(".section-empty button")).toHaveLength(1);
    await userEvent.click(within(table).getByRole("button", { name: "查看分析记录" }));
    expect(screen.getByRole("tab", { name: "日志分析记录" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("table", { name: "日志分析记录" })).toBeVisible();
  });

  it("shows the mock-mode hint without runtime actions", () => {
    renderPage();

    expect(screen.getByTestId("feedback-quality-insights")).toHaveTextContent(/请连接服务后查看分析质量/);
  });
});

describe("LogAdminPage polish tab controls", () => {
  it("has one refresh that only refreshes the active collection", async () => {
    const logActions = createLogActions();
    renderPage({ logActions });
    await waitFor(() => expect(logActions.listLogDomains).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(logActions.listFeedbackInsights).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole("button", { name: "刷新" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(logActions.refresh).toHaveBeenCalledTimes(1);
    expect(logActions.listLogDomains).toHaveBeenCalledTimes(1);
    expect(logActions.listFeedbackInsights).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("tab", { name: "分析技能" }));
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(logActions.listLogDomains).toHaveBeenCalledTimes(2));
    expect(logActions.refresh).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("tab", { name: "分析质量" }));
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(logActions.listFeedbackInsights).toHaveBeenCalledTimes(2));
    expect(logActions.listLogDomains).toHaveBeenCalledTimes(2);
    expect(logActions.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "刷新" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "刷新反馈" })).not.toBeInTheDocument();
  });

  it("shows time and export on records and quality, and failure insights only on records", async () => {
    localStorage.removeItem("log-admin-insight-dismissed");
    renderPage({ logActions: createLogActions() });
    expect(screen.getByText(/日志解析失败/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "分析技能" }));
    expect(screen.queryByRole("group", { name: "时间窗口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "导出报表" })).not.toBeInTheDocument();
    expect(screen.queryByText(/日志解析失败/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "分析质量" }));
    expect(screen.getByRole("group", { name: "时间窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出报表" })).toBeInTheDocument();
    expect(screen.queryByText(/日志解析失败/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "日志分析记录" }));
    expect(screen.getByText(/日志解析失败/)).toBeInTheDocument();
  });

  it("offers one empty-state next step, replacing navigation with reset after filtering", async () => {
    const { onNavigate } = renderPage({ stateOverrides: { logs: [] } });
    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(table.querySelectorAll(".section-empty button")).toHaveLength(1);
    await userEvent.click(within(table).getByRole("button", { name: "前往日志分析" }));
    expect(onNavigate).toHaveBeenCalledWith("/logs");
    expect(screen.getAllByRole("button", { name: "刷新" })).toHaveLength(1);
    await userEvent.type(screen.getByRole("searchbox"), "无结果");
    expect(table.querySelectorAll(".section-empty button")).toHaveLength(1);
    expect(within(table).queryByRole("button", { name: "前往日志分析" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "重置筛选" })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.queryByRole("button", { name: "重置筛选" })).not.toBeInTheDocument();
    expect(table.querySelectorAll(".section-empty button")).toHaveLength(1);
    expect(within(table).getByRole("button", { name: "前往日志分析" })).toBeInTheDocument();
  });

  it("opens the drawer from the file and shows the uploader, upload time and general-analysis fallback", async () => {
    const log = { ...createPrototypeState().logs[0], capturedAt: "2026-10-19T12:34:00", submittedBy: "王管理员", logDomainName: undefined };
    renderPage({ stateOverrides: { logs: [log] } });
    const row = getLogRow(/charging_thermal_trace/);
    expect(within(row).getByText("通用分析")).toBeInTheDocument();
    expect(within(row).getByText("王管理员")).toBeInTheDocument();
    expect(within(row).getByText("2026/10/19 12:34")).toBeInTheDocument();
    expect(within(row).queryByText(log.reportId)).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: log.fileName }));
    expect(screen.getByText(`报告 ID：${log.reportId}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开报告" })).toBeInTheDocument();
  });
});
