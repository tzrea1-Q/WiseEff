import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "./components/layout";
import { LogAdminPage } from "./LogAdminPage";
import type { LogRuntimeActions } from "./application/logs/logRuntime";
import type { KnowledgeRepository } from "./application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "./domain/knowledge/types";
import { createPrototypeState } from "./mockData";
import { WiseEffApiError } from "./infrastructure/http/apiClient";
import { createTestLogRuntimeActions as createLogActions } from "./test/harness";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function TopBarActionsHarness({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode | null>(null);
  const setStableActions = useCallback((nextActions: ReactNode | null | ((current: ReactNode | null) => ReactNode | null)) => {
    setActions(nextActions);
  }, []);
  const contextValue = useMemo(() => ({ setActions: setStableActions }), [setStableActions]);

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
  knowledgeRepository
}: { logActions?: LogRuntimeActions; stateOverrides?: Partial<ReturnType<typeof createPrototypeState>>; knowledgeRepository?: KnowledgeRepository } = {}) {
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
        knowledgeRepository={knowledgeRepository}
      />
    </TopBarActionsHarness>
  );

  return { ...utils, state, dispatch, onNavigate };
}

function getLogRow(fileName: RegExp) {
  const table = screen.getByRole("table", { name: "日志分析记录" });
  return within(table).getByText(fileName).closest("tr")!;
}

describe("LogAdminPage M3 skeleton", () => {
  it("moves page actions into the topbar instead of rendering a page header", () => {
    renderPage();

    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /导出报表/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /同步日志/ })).toBeInTheDocument();
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

    expect(within(table).getByText("报告 ID")).toBeInTheDocument();
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
    expect(within(agentRow).getByText("模型自估")).toBeInTheDocument();
    expect(within(agentRow).getByText("88%")).toBeInTheDocument();

    const rulesRow = getLogRow(/rules_fallback/);
    expect(within(rulesRow).getByText("规则评分")).toBeInTheDocument();
    expect(within(rulesRow).getByText("72%")).toBeInTheDocument();

    const legacyRow = getLogRow(/legacy_report/);
    expect(within(legacyRow).getByText("置信度")).toBeInTheDocument();
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

  it("keeps log search standalone and moves source filtering into the header", async () => {
    renderPage();

    expect(screen.getByPlaceholderText(/搜索 RPT-/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "来源模块" })).not.toBeInTheDocument();

    const table = screen.getByRole("table", { name: "日志分析记录" });
    const sourceHeader = within(table).getByRole("columnheader", { name: /来源模块/ });

    await userEvent.click(within(sourceHeader).getByRole("button", { name: "筛选来源模块" }));
    await userEvent.click(within(sourceHeader).getByRole("checkbox", { name: "Thermal Snapshot" }));

    expect(within(sourceHeader).getByRole("button", { name: "筛选来源模块" })).toHaveClass("active");
    expect(within(table).getByText(/thermal_snapshot\.bin/)).toBeInTheDocument();
  });

  it("keeps header filters only on source module and status", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "日志分析记录" });
    const checks: Array<[string, string, string]> = [
      ["来源模块", "筛选来源模块", "Battery Thermal"],
      ["状态", "筛选状态", "失败"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    expect(screen.queryByRole("button", { name: "筛选报告 ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选文件名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选分析阶段" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选置信度" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选项目" })).not.toBeInTheDocument();

    const sourceHeader = within(table).getByRole("columnheader", { name: /来源模块/ });
    await userEvent.click(within(sourceHeader).getByRole("button", { name: "筛选来源模块" }));
    await userEvent.click(within(sourceHeader).getByRole("checkbox", { name: "Battery Thermal" }));

    expect(within(table).getByText(/charging_thermal_trace_20260504\.log/)).toBeInTheDocument();
    expect(within(table).queryByText(/thermal_snapshot\.bin/)).not.toBeInTheDocument();
  });

  it("resets filters when 重置 button is clicked", async () => {
    renderPage();
    const search = screen.getByPlaceholderText(/搜索 RPT-/);

    await userEvent.type(search, "nonexistent");
    expect(screen.getByText(/未匹配任何记录/)).toBeInTheDocument();

    const reset = screen.getAllByRole("button").find((button) => button.textContent === "重置");
    expect(reset).toBeDefined();
    await userEvent.click(reset as HTMLElement);

    expect(screen.queryByText(/未匹配任何记录/)).not.toBeInTheDocument();
  });
});

describe("LogAdminPage · row click + drawer actions", () => {
  it("opens drawer when row is clicked", async () => {
    renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);

    expect(screen.getByText("AI 摘要")).toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: /已归档（1）/ }));
    expect(within(screen.getByRole("table", { name: "日志分析记录" })).getByText(base.logs[1]!.fileName)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId: archivedId });
  });

  it("loads archived records through the runtime and restores via unarchive", async () => {
    const base = createPrototypeState();
    const archivedId = base.logs[1]!.id;
    const logActions = createLogActions();
    renderPage({ logActions, stateOverrides: { archivedLogIds: [archivedId] } });

    await userEvent.click(screen.getByRole("button", { name: /已归档（1）/ }));
    expect(logActions.refresh).toHaveBeenCalledWith({ includeArchived: true });

    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
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

  it("prompts mock-mode users to open 小泽 on 交给 Agent", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /交给 Agent 分析/ }));

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

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_EXPORT_REPORT", timeWindow: "today" }));
  });

  it("dispatches LOG_ADMIN_SYNC_LOGS on 同步日志 click without runtime actions", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /同步日志/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_ADMIN_SYNC_LOGS" });
  });

  it("calls runtime refresh with archived logs on 同步日志 click", async () => {
    const refresh = deferred();
    const logActions = createLogActions({ refresh: vi.fn(() => refresh.promise) });
    const { dispatch } = renderPage({ logActions });

    const syncButton = screen.getByRole("button", { name: /同步日志/ });
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

describe("LogAdminPage 业务域治理", () => {
  const chargingDomain = {
    id: "domain-charging",
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
    const table = await screen.findByRole("table", { name: "业务域列表" });
    expect(within(table).getByText("charging-power")).toBeInTheDocument();
    expect(within(table).getByText("legacy")).toBeInTheDocument();
    expect(within(table).getByText("已归档")).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: /名称/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("columnheader", { name: /状态/ })).toHaveAttribute("aria-sort", "none");
    expect(within(table).getByRole("button", { name: "筛选状态" })).toBeInTheDocument();
  });

  it("shows the DataTable empty state when no domains exist", async () => {
    const logActions = createLogActions({ listLogDomains: vi.fn().mockResolvedValue([]) });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    expect(within(table).getByText("暂无业务域；未分类域始终可用（通用分析）。")).toBeInTheDocument();
  });

  it("sorts the domain list from the 名称 column header", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([
        chargingDomain,
        { ...chargingDomain, id: "domain-old", name: "legacy", status: "archived" as const }
      ])
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
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

    const table = await screen.findByRole("table", { name: "业务域列表" });
    const statusHeader = within(table).getByRole("columnheader", { name: /状态/ });
    await userEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    await userEvent.click(within(statusHeader).getByRole("checkbox", { name: "已归档" }));

    expect(within(statusHeader).getByRole("button", { name: "筛选状态" })).toHaveClass("active");
    expect(within(table).getByText("legacy")).toBeInTheDocument();
    expect(within(table).queryByText("charging-power")).not.toBeInTheDocument();
  });

  it("creates a domain through the form with a valid profile JSON", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([]),
      createLogDomain: vi.fn().mockResolvedValue(chargingDomain)
    });
    renderPage({ logActions });

    await userEvent.click(await screen.findByRole("button", { name: "新建业务域" }));
    await userEvent.type(screen.getByLabelText(/名称/), "charging-power");
    await userEvent.type(screen.getByLabelText(/描述/), "充电域");
    const profileInput = screen.getByLabelText(/格式画像 JSON/);
    await userEvent.click(profileInput);
    await userEvent.paste('{"timestampPattern": "^x"}');
    await userEvent.click(screen.getByRole("button", { name: "创建业务域" }));

    await waitFor(() =>
      expect(logActions.createLogDomain).toHaveBeenCalledWith({
        name: "charging-power",
        description: "充电域",
        formatProfile: { timestampPattern: "^x" }
      })
    );
  });

  it("blocks submission and shows a readable error for invalid profile JSON", async () => {
    const logActions = createLogActions({ listLogDomains: vi.fn().mockResolvedValue([]) });
    renderPage({ logActions });

    await userEvent.click(await screen.findByRole("button", { name: "新建业务域" }));
    await userEvent.type(screen.getByLabelText(/名称/), "broken");
    const profileInput = screen.getByLabelText(/格式画像 JSON/);
    await userEvent.click(profileInput);
    await userEvent.paste("{not json");
    await userEvent.click(screen.getByRole("button", { name: "创建业务域" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/画像 JSON 无法解析/);
    expect(logActions.createLogDomain).not.toHaveBeenCalled();
  });

  it("shows an inline profile error when the server rejects a parseable format profile", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([]),
      createLogDomain: vi.fn().mockRejectedValue(
        new WiseEffApiError(
          "VALIDATION_FAILED",
          "Log domain format profile is invalid.",
          { issues: ["timestampPattern is not a valid regular expression: Invalid regular expression: /([/: Unterminated group"] },
          "req-profile"
        )
      )
    });
    renderPage({ logActions });

    await userEvent.click(await screen.findByRole("button", { name: "新建业务域" }));
    await userEvent.type(screen.getByLabelText(/名称/), "charging-power");
    const profileInput = screen.getByLabelText(/格式画像 JSON/);
    await userEvent.click(profileInput);
    await userEvent.paste('{"timestampPattern":"(["}');
    await userEvent.click(screen.getByRole("button", { name: "创建业务域" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("timestampPattern 不是合法正则表达式。");
    expect(screen.getByLabelText(/格式画像 JSON/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("form", { name: "新建业务域" })).toBeInTheDocument();
  });

  it("shows an inline name error when creating a duplicate domain", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([]),
      createLogDomain: vi.fn().mockRejectedValue(
        new WiseEffApiError(
          "CONFLICT",
          "A log domain with this name already exists in the organization.",
          { name: "charging-power" },
          "req-name"
        )
      )
    });
    renderPage({ logActions });

    await userEvent.click(await screen.findByRole("button", { name: "新建业务域" }));
    await userEvent.type(screen.getByLabelText(/名称/), "charging-power");
    await userEvent.click(screen.getByRole("button", { name: "创建业务域" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("该业务域名称已存在，请换一个名称。");
    expect(screen.getByLabelText(/名称/)).toHaveAttribute("aria-invalid", "true");
  });

  it("archives a domain from the list", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([chargingDomain]),
      archiveLogDomain: vi.fn().mockResolvedValue({ ...chargingDomain, status: "archived" as const })
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "归档" }));

    await waitFor(() => expect(logActions.archiveLogDomain).toHaveBeenCalledWith("domain-charging"));
  });

  it("shows the mock-mode hint without runtime actions", () => {
    renderPage();

    expect(screen.getByTestId("log-domain-governance")).toHaveTextContent(/业务域治理需在 API 模式下使用/);
  });

  it("gates governance behind the admin role", () => {
    const state = { ...createPrototypeState(), activeRoleId: "user" };
    const dispatch = vi.fn();
    render(
      <TopBarActionsHarness>
        <LogAdminPage state={state} dispatch={dispatch} onNavigate={vi.fn()} search="" logActions={createLogActions()} />
      </TopBarActionsHarness>
    );

    expect(screen.getByTestId("log-domain-governance")).toHaveTextContent(/需要 Admin 权限/);
    expect(screen.queryByRole("button", { name: "新建业务域" })).not.toBeInTheDocument();
  });
});

describe("LogAdminPage 业务域知识条目关联", () => {
  const chargingDomain = {
    id: "domain-charging",
    name: "charging-power",
    description: "充电/电源子系统内核日志",
    status: "active" as const,
    formatProfile: undefined,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  };

  function makePublishedEntry(overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
    return {
      id: "entry-1",
      title: "E_THERMAL_FOLDBACK handbook",
      contentForm: "markdown",
      status: "published",
      tags: ["charging"],
      sourceType: "human",
      sourceSessionId: null,
      sourceLogId: null,
      createdByUserId: "u-1",
      headRevisionNumber: 1,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
      publishedAt: "2026-08-12T00:00:00.000Z",
      archivedAt: null,
      contentMarkdown: "docs",
      file: null,
      ...overrides
    };
  }

  function makeKnowledgeRepository(entries: KnowledgeEntry[]): KnowledgeRepository {
    return {
      list: vi.fn().mockResolvedValue({ items: entries })
    } as unknown as KnowledgeRepository;
  }

  it("opens the editor, offers only published entries, and saves the selected link set", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([chargingDomain]),
      listLogDomainKnowledgeLinks: vi.fn().mockResolvedValue([]),
      setLogDomainKnowledgeLinks: vi.fn().mockResolvedValue([
        {
          id: "link-1",
          logDomainId: "domain-charging",
          knowledgeEntryId: "entry-1",
          entryTitle: "E_THERMAL_FOLDBACK handbook",
          entryStatus: "published" as const,
          entryTags: ["charging"],
          linkedAt: "2026-08-13T00:00:00.000Z"
        }
      ])
    });
    const knowledgeRepository = makeKnowledgeRepository([makePublishedEntry()]);
    renderPage({ logActions, knowledgeRepository });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "知识条目" }));

    const editor = await screen.findByTestId("domain-knowledge-links-editor");
    await waitFor(() => expect(logActions.listLogDomainKnowledgeLinks).toHaveBeenCalledWith("domain-charging"));
    expect(knowledgeRepository.list).toHaveBeenCalledWith({ status: "published" });

    await userEvent.click(await within(editor).findByRole("checkbox", { name: /E_THERMAL_FOLDBACK handbook/ }));
    await userEvent.click(within(editor).getByRole("button", { name: "保存关联" }));

    await waitFor(() =>
      expect(logActions.setLogDomainKnowledgeLinks).toHaveBeenCalledWith({
        domainId: "domain-charging",
        knowledgeEntryIds: ["entry-1"]
      })
    );
    expect(await within(editor).findByRole("status")).toHaveTextContent("已保存");
  });

  it("marks stale non-published links and drops them from the saved set", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([chargingDomain]),
      listLogDomainKnowledgeLinks: vi.fn().mockResolvedValue([
        {
          id: "link-live",
          logDomainId: "domain-charging",
          knowledgeEntryId: "entry-1",
          entryTitle: "E_THERMAL_FOLDBACK handbook",
          entryStatus: "published" as const,
          entryTags: [],
          linkedAt: "2026-08-13T00:00:00.000Z"
        },
        {
          id: "link-stale",
          logDomainId: "domain-charging",
          knowledgeEntryId: "entry-archived",
          entryTitle: "Archived charging note",
          entryStatus: "archived" as const,
          entryTags: [],
          linkedAt: "2026-08-13T00:00:00.000Z"
        }
      ]),
      setLogDomainKnowledgeLinks: vi.fn().mockResolvedValue([])
    });
    renderPage({ logActions, knowledgeRepository: makeKnowledgeRepository([makePublishedEntry()]) });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "知识条目" }));
    const editor = await screen.findByTestId("domain-knowledge-links-editor");

    expect(await within(editor).findByRole("note")).toHaveTextContent(/Archived charging note/);

    await userEvent.click(within(editor).getByRole("button", { name: "保存关联" }));
    await waitFor(() =>
      expect(logActions.setLogDomainKnowledgeLinks).toHaveBeenCalledWith({
        domainId: "domain-charging",
        knowledgeEntryIds: ["entry-1"]
      })
    );
  });
});

describe("LogAdminPage 业务域结果回调与模型覆盖", () => {
  const webhookDomain = {
    id: "domain-charging",
    name: "charging-power",
    description: "充电/电源子系统内核日志",
    status: "active" as const,
    formatProfile: undefined,
    modelOverride: "gpt-4o",
    webhook: {
      enabled: true,
      url: "https://hooks.example.com/wiseeff",
      secretConfigured: true,
      secretLastFour: "cdef"
    },
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z"
  };

  it("shows the model override and webhook state columns", async () => {
    const logActions = createLogActions({ listLogDomains: vi.fn().mockResolvedValue([webhookDomain]) });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    expect(within(table).getByTestId("domain-model-domain-charging")).toHaveTextContent("gpt-4o");
    expect(within(table).getByTestId("domain-webhook-state-domain-charging")).toHaveTextContent("已启用");
  });

  it("saves the model override through the edit form (blank clears back to the global model)", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([webhookDomain]),
      updateLogDomain: vi.fn().mockResolvedValue(webhookDomain)
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "编辑" }));
    const overrideInput = screen.getByLabelText(/模型覆盖/);
    expect(overrideInput).toHaveValue("gpt-4o");
    expect(overrideInput).toHaveAttribute("placeholder", "留空使用全局模型");
    await userEvent.clear(overrideInput);
    await userEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(logActions.updateLogDomain).toHaveBeenCalledWith(
        expect.objectContaining({ domainId: "domain-charging", modelOverride: null })
      )
    );
  });

  it("opens the webhook editor, saves config without echoing the secret, and lists recent deliveries", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([webhookDomain]),
      setLogDomainWebhook: vi.fn().mockResolvedValue(webhookDomain),
      listLogDomainWebhookDeliveries: vi.fn().mockResolvedValue([
        {
          id: "delivery-1",
          logDomainId: "domain-charging",
          logRecordId: "log-1",
          runId: "run-1",
          kind: "result" as const,
          attempt: 1,
          status: "delivered" as const,
          httpStatus: 200,
          createdAt: "2026-08-13T02:00:00.000Z"
        },
        {
          id: "delivery-2",
          logDomainId: "domain-charging",
          kind: "test" as const,
          attempt: 1,
          status: "failed" as const,
          error: "Receiver responded with HTTP 500.",
          createdAt: "2026-08-13T01:00:00.000Z"
        }
      ])
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "结果回调" }));

    const editor = await screen.findByTestId("domain-webhook-editor");
    await waitFor(() => expect(logActions.listLogDomainWebhookDeliveries).toHaveBeenCalledWith("domain-charging", 10));
    // The secret never renders; only configured-state + last four characters do.
    expect(editor).toHaveTextContent("已配置 · 末四位 cdef");
    const deliveries = within(editor).getByTestId("domain-webhook-deliveries");
    expect(deliveries).toHaveTextContent("已送达");
    expect(deliveries).toHaveTextContent("HTTP 200");
    expect(deliveries).toHaveTextContent("投递失败");

    const urlInput = within(editor).getByLabelText(/Webhook URL/);
    await userEvent.clear(urlInput);
    await userEvent.click(urlInput);
    await userEvent.paste("https://hooks.example.com/updated");
    await userEvent.click(within(editor).getByRole("button", { name: "保存配置" }));

    await waitFor(() =>
      expect(logActions.setLogDomainWebhook).toHaveBeenCalledWith({
        domainId: "domain-charging",
        url: "https://hooks.example.com/updated",
        enabled: true
      })
    );
    expect(await within(editor).findByRole("status")).toHaveTextContent("配置已保存");
  });

  it("sends a test delivery and reports the outcome inline", async () => {
    const logActions = createLogActions({
      listLogDomains: vi.fn().mockResolvedValue([webhookDomain]),
      sendLogDomainWebhookTest: vi.fn().mockResolvedValue({ status: "delivered", attempts: 1, httpStatus: 200 })
    });
    renderPage({ logActions });

    const table = await screen.findByRole("table", { name: "业务域列表" });
    await userEvent.click(within(table).getByRole("button", { name: "结果回调" }));
    const editor = await screen.findByTestId("domain-webhook-editor");
    await userEvent.click(within(editor).getByRole("button", { name: "发送测试投递" }));

    await waitFor(() => expect(logActions.sendLogDomainWebhookTest).toHaveBeenCalledWith("domain-charging"));
    expect(await within(editor).findByRole("status")).toHaveTextContent("测试投递成功（HTTP 200）");
    // The list refreshes after a test delivery (initial load + refresh).
    expect(logActions.listLogDomainWebhookDeliveries).toHaveBeenCalledTimes(2);
  });
});

describe("LogAdminPage 分析质量洞察", () => {
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
    await waitFor(() => expect(logActions.listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "today" }));
    expect(within(table).getByText("charging-power")).toBeInTheDocument();
    expect(within(table).getByText("log-analysis/v2")).toBeInTheDocument();
    expect(within(table).getByText("75%（3/4）")).toBeInTheDocument();
    expect(within(table).getByText("未分类")).toBeInTheDocument();
    expect(within(table).getByText("降级 · 规则回退")).toBeInTheDocument();
    expect(within(table).getByText("0%（0/2）")).toBeInTheDocument();
  });

  it("refetches insights when the time window changes", async () => {
    const listFeedbackInsights = vi.fn().mockResolvedValue([agentInsight]);
    renderPage({ logActions: createLogActions({ listFeedbackInsights }) });

    await waitFor(() => expect(listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "today" }));
    await userEvent.click(screen.getByRole("button", { name: "7 日" }));
    await waitFor(() => expect(listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "7d" }));
  });

  it("shows the honest empty state when no feedback exists", async () => {
    renderPage({ logActions: createLogActions() });

    const section = screen.getByTestId("feedback-quality-insights");
    expect(await within(section).findByText("暂无反馈")).toBeInTheDocument();
  });

  it("shows the mock-mode hint without runtime actions", () => {
    renderPage();

    expect(screen.getByTestId("feedback-quality-insights")).toHaveTextContent(/分析质量监控需在 API 模式下使用/);
  });
});
