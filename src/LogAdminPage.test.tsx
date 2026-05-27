import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { TopBarActionsContext } from "./components/layout";
import { LogAdminPage } from "./LogAdminPage";
import type { LogRuntimeActions } from "./application/logs/logRuntime";
import { createPrototypeState } from "./mockData";

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

function createLogActions(overrides: Partial<LogRuntimeActions> = {}): LogRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    upload: vi.fn().mockResolvedValue(undefined),
    rerun: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    unarchive: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
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

function renderPage({ logActions }: { logActions?: LogRuntimeActions } = {}) {
  const state = { ...createPrototypeState(), activeRoleId: "admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();
  const utils = render(
    <TopBarActionsHarness>
      <LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search="" logActions={logActions} />
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

    expect(within(table).getByText("Report ID")).toBeInTheDocument();
    expect(within(table).getByText(/charging_thermal_trace/)).toBeInTheDocument();
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

  it("keeps header filters only on project, source module, and status", async () => {
    renderPage();

    const table = screen.getByRole("table", { name: "日志分析记录" });
    const checks: Array<[string, string, string]> = [
      ["项目", "筛选项目", "Aurora 量产平台"],
      ["来源模块", "筛选来源模块", "Battery Thermal"],
      ["状态", "筛选状态", "失败"]
    ];

    for (const [headerName, buttonName, optionName] of checks) {
      const header = within(table).getByRole("columnheader", { name: new RegExp(headerName) });
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      await userEvent.click(within(header).getByRole("button", { name: buttonName }));
    }

    expect(screen.queryByRole("button", { name: "筛选Report ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选文件名" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选分析阶段" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选置信度" })).not.toBeInTheDocument();

    const projectHeader = within(table).getByRole("columnheader", { name: /项目/ });
    await userEvent.click(within(projectHeader).getByRole("button", { name: "筛选项目" }));
    await userEvent.click(within(projectHeader).getByRole("checkbox", { name: "Aurora 量产平台" }));

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
      expect(screen.getByText(/已归档/)).toBeInTheDocument();
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
      expect(screen.getByText(/已归档/)).toBeInTheDocument();
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

  it("dispatches OPEN_AGENT_WITH_PRESET on 交给 Agent", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /交给 Agent 分析/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "OPEN_AGENT_WITH_PRESET" }));
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
