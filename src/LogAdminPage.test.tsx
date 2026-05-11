import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogAdminPage } from "./LogAdminPage";
import { createPrototypeState } from "./mockData";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  const state = { ...createPrototypeState(), activeRoleId: "parameter-admin" };
  const dispatch = vi.fn();
  const onNavigate = vi.fn();
  const utils = render(<LogAdminPage state={state} dispatch={dispatch} onNavigate={onNavigate} search="" />);

  return { ...utils, state, dispatch, onNavigate };
}

function getLogRow(fileName: RegExp) {
  const table = screen.getByRole("table", { name: "日志分析记录" });
  return within(table).getByText(fileName).closest("tr")!;
}

describe("LogAdminPage M3 skeleton", () => {
  it("renders page header with breadcrumb and title", () => {
    renderPage();

    expect(screen.getByText("LOGS · ADMIN")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "日志分析管理后台" })).toBeInTheDocument();
  });

  it("renders four metric cards with labels", () => {
    renderPage();

    expect(screen.getByText("今日分析")).toBeInTheDocument();
    expect(screen.getByText("平均置信度")).toBeInTheDocument();
    expect(screen.getByText("失败文件")).toBeInTheDocument();
    expect(screen.getByText("吞吐峰值")).toBeInTheDocument();
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

  it("filters table when 失败文件 metric is clicked", async () => {
    renderPage();
    const failedCard = screen.getAllByRole("button").find((button) => button.textContent?.includes("失败文件"));

    expect(failedCard).toBeDefined();
    await userEvent.click(failedCard as HTMLElement);

    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByText(/thermal_snapshot\.bin/)).toBeInTheDocument();
  });

  it("renders AuditTimeline with filtered events", () => {
    renderPage();

    expect(screen.getByText("审计事件")).toBeInTheDocument();
    expect(screen.getByText(/生成充电温升根因证据链/)).toBeInTheDocument();
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

  it("dispatches LOG_ADMIN_REANALYZE_LOG on reanalyze", async () => {
    const { dispatch } = renderPage();
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);
    await userEvent.click(screen.getByRole("button", { name: /重新分析/ }));

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: "LOG_ADMIN_REANALYZE_LOG" }));
  });

  it("dispatches LOG_ADMIN_ARCHIVE_LOG and shows undo toast", async () => {
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

  it("disables drawer action buttons for Viewer role", async () => {
    const state = createPrototypeState();
    const viewerState = { ...state, activeRoleId: "hardware" };
    const dispatch = vi.fn();
    render(<LogAdminPage state={viewerState} dispatch={dispatch} onNavigate={vi.fn()} search="" />);
    const row = getLogRow(/charging_thermal_trace/);

    await userEvent.click(row);

    expect(screen.getByRole("button", { name: /重新分析/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /归档/ })).toBeDisabled();
  });
});

describe("LogAdminPage · access control", () => {
  it("renders 5 admin users in the panel", () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    render(<LogAdminPage state={adminState} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    expect(screen.getByText("Mike Kruger")).toBeInTheDocument();
    expect(screen.getByText("Ana Lin")).toBeInTheDocument();
    expect(screen.getByText("Rui Peng")).toBeInTheDocument();
    expect(screen.getByText("Xiao Wang")).toBeInTheDocument();
  });

  it("opens AddUserDialog on 添加 button click (Admin role)", async () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    render(<LogAdminPage state={adminState} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    await userEvent.click(screen.getByRole("button", { name: /添加/ }));

    expect(screen.getByRole("dialog", { name: /新增后台用户/ })).toBeInTheDocument();
  });

  it("dispatches LOG_ADMIN_ADD_USER on form submit", async () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    const dispatch = vi.fn();
    render(<LogAdminPage state={adminState} dispatch={dispatch} onNavigate={vi.fn()} search="" />);

    await userEvent.click(screen.getByRole("button", { name: /添加/ }));
    await userEvent.type(screen.getByLabelText("姓名"), "New Admin");
    await userEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "LOG_ADMIN_ADD_USER",
        input: expect.objectContaining({ name: "New Admin", role: "Editor" })
      })
    );
  });

  it("disables 添加 button for non-Admin role", () => {
    const state = createPrototypeState();
    const hardwareState = { ...state, activeRoleId: "hardware" };
    render(<LogAdminPage state={hardwareState} dispatch={vi.fn()} onNavigate={vi.fn()} search="" />);

    expect(screen.getByRole("button", { name: /添加/ })).toBeDisabled();
  });

  it("dispatches LOG_ADMIN_UPDATE_USER_ROLE on role change", async () => {
    const state = createPrototypeState();
    const adminState = { ...state, activeRoleId: "admin" };
    const dispatch = vi.fn();
    render(<LogAdminPage state={adminState} dispatch={dispatch} onNavigate={vi.fn()} search="" />);
    const mkRow = screen.getByText("Mike Kruger").closest("li")!;
    const select = within(mkRow).getByRole("combobox");

    await userEvent.selectOptions(select, "Admin");

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "LOG_ADMIN_UPDATE_USER_ROLE",
        userId: "mk",
        role: "Admin"
      })
    );
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

  it("dispatches LOG_ADMIN_SYNC_LOGS on 同步日志 click", async () => {
    const { dispatch } = renderPage();

    await userEvent.click(screen.getByRole("button", { name: /同步日志/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_ADMIN_SYNC_LOGS" });
  });
});
