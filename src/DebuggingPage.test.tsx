import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { type AppAction } from "./App";
import type { DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import { TopBarActionsContext } from "./components/layout";
import { DebuggingPage } from "./DebuggingPage";
import { initialState, type PrototypeState } from "./mockData";
import { useMemo, useState, type ReactNode } from "react";

const userState = { ...initialState, activeRoleId: "user" };
const adminState = { ...initialState, activeRoleId: "admin" };
const connectedStatus = initialState.devices.find((device) => device.id === "device-n07")?.status ?? initialState.devices[1]?.status ?? initialState.devices[0].status;
const connectedUserState = {
  ...userState,
  debuggingSessionStartedAt: "2026-05-27T09:00:00.000Z",
  devices: userState.devices.map((device, index) => index === 0 ? { ...device, status: connectedStatus } : device)
};
const runtimePendingUserState = {
  ...connectedUserState,
  debugParameters: connectedUserState.debugParameters.map((parameter, index) =>
    index === 0
      ? { ...parameter, status: "待下发" as const, targetValue: parameter.currentValue === "999" ? "998" : "999" }
      : { ...parameter, status: "已同步" as const, targetValue: parameter.currentValue }
  )
};
const apiSnapshot = {
  ...(initialState.lastDebugSnapshot ?? { createdAt: "2026-05-27T09:05:00.000Z", risk: "High" as const }),
  id: "api-snapshot-1",
  entries: [
    {
      parameterId: initialState.debugParameters[0].id,
      previousValue: initialState.debugParameters[0].currentValue,
      nextValue: initialState.debugParameters[0].targetValue
    }
  ]
};

function createDebuggingActions(overrides: Partial<DebuggingRuntimeActions> = {}): DebuggingRuntimeActions {
  return {
    refresh: vi.fn(),
    detectAndStartSession: vi.fn().mockResolvedValue({
      session: {
        id: "api-session-1",
        projectId: userState.activeProjectId,
        deviceId: userState.devices[0].id,
        targetId: "api-target-1",
        status: "active",
        startedAt: "2026-05-27T09:00:00.000Z",
        endedAt: null
      },
      target: { id: "api-target-1", deviceId: userState.devices[0].id, label: "API Target" }
    }),
    readNode: vi.fn(),
    writeNode: vi.fn(),
    pushValues: vi.fn().mockResolvedValue(undefined),
    rollbackSnapshot: vi.fn().mockResolvedValue(undefined),
    rollbackLastSnapshot: vi.fn(),
    connectDevice: vi.fn(),
    ...overrides
  };
}

function renderDebuggingPage({
  state = userState,
  debuggingActions,
  dispatch = vi.fn()
}: {
  state?: typeof userState;
  debuggingActions?: DebuggingRuntimeActions;
  dispatch?: (action: AppAction) => void;
} = {}) {
  function DebuggingHarness() {
    const [topBarActions, setTopBarActions] = useState<ReactNode | null>(null);
    const context = useMemo(() => ({ setActions: setTopBarActions }), []);
    return (
      <TopBarActionsContext.Provider value={context}>
        <div className="topbar-page-actions">{topBarActions}</div>
        <DebuggingPage state={state} dispatch={dispatch} debuggingActions={debuggingActions} />
      </TopBarActionsContext.Provider>
    );
  }

  render(<DebuggingHarness />);
  return { dispatch };
}

function getTopbarConnectButton() {
  const button = document.querySelector<HTMLButtonElement>(".device-pill .link-button");
  if (!button) throw new Error("Cannot find topbar connect button.");
  return button;
}

function getPushButton() {
  const button = document.querySelector<HTMLButtonElement>(".debugging-deploy-button");
  if (!button) throw new Error("Cannot find push button.");
  return button;
}

function getRollbackButton() {
  const button = document.querySelector<HTMLButtonElement>(".session-summary-card button");
  if (!button) throw new Error("Cannot find rollback button.");
  return button;
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function getRollbackConfirmButton() {
  const button = document.querySelector<HTMLButtonElement>(".rollback-confirm-dialog .button.danger");
  if (!button) throw new Error("Cannot find rollback confirm button.");
  return button;
}

function getPendingDebugParameters(state = runtimePendingUserState) {
  return state.debugParameters.filter((parameter) => parameter.status === "待下发");
}

function withSnapshot<T extends PrototypeState>(state: T): T {
  return { ...state, lastDebugSnapshot: apiSnapshot };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

function getDebugRow(parameterKey: string) {
  const row = Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr")).find((item) =>
    item.textContent?.includes(parameterKey)
  );
  if (!row) {
    throw new Error(`找不到参数行：${parameterKey}`);
  }
  return row;
}

function changeTargetFromDetail(parameterName: string, nextValue: string) {
  fireEvent.click(screen.getByRole("button", { name: `编辑 ${parameterName}` }));
  const detailEditor = screen.getByLabelText("目标设定值");
  fireEvent.change(detailEditor, { target: { value: nextValue } });
  fireEvent.click(screen.getByRole("button", { name: "关闭草稿" }));
}

describe("/debugging 单栏骨架", () => {
  it("渲染为单栏布局，不再出现筛选侧栏或右侧调试时间轴", () => {
    renderDebuggingPage();

    const layout = document.querySelector(".workbench-one-col");
    expect(layout).toBeInTheDocument();
    expect(screen.queryByLabelText("参数筛选")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
    expect(layout).toBeInTheDocument();
    expect(document.querySelector(".workbench-grid")).not.toBeInTheDocument();
  });

  it("保留主表格和现有下发按钮能跑通的基本功能", () => {
    renderDebuggingPage();

    expect(screen.getByText("实时可调参数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下发调试值/ })).toBeInTheDocument();
  });

  it("没有可用调试设备时显示空态而不是白屏", () => {
    renderDebuggingPage({
      state: {
        ...userState,
        devices: [],
        debugParameters: [],
        debugEvents: []
      }
    });

    expect(screen.getByRole("region", { name: "调试设备空态" })).toHaveTextContent("暂无可用调试设备");
    expect(screen.queryByRole("region", { name: "调试会话摘要" })).not.toBeInTheDocument();
  });

  it("将风险和状态筛选合并到表头，搜索框仍独立存在", () => {
    renderDebuggingPage();

    expect(screen.getByRole("searchbox", { name: "按名称 / Key 搜索" })).toBeInTheDocument();
    expect(document.querySelector(".parameters-table-filters")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "筛选模块" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选风险" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "高" }));

    expect(screen.getByRole("button", { name: "筛选风险" })).toHaveClass("active");
    expect(getDebugRow("charger.input_current_limit_ma")).toBeInTheDocument();
    expect(() => getDebugRow("charger.charge_pump.enable")).toThrow();
  });

  it("仅支持从风险和状态表头筛选调试参数", () => {
    renderDebuggingPage();

    const headers: Array<[string, string, string]> = [
      ["风险", "筛选风险", "高"],
      ["状态", "筛选状态", "下发成功"]
    ];

    for (const [headerName, buttonName, optionName] of headers) {
      const header = screen.getByRole("columnheader", { name: new RegExp(headerName) });
      const button = within(header).getByRole("button", { name: buttonName });
      fireEvent.click(button);
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(button);
    }

    expect(screen.queryByRole("button", { name: "筛选参数名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选当前值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选目标设定值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选范围" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选模块" })).not.toBeInTheDocument();

    const statusHeader = screen.getByRole("columnheader", { name: /状态/ });
    fireEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    fireEvent.click(within(statusHeader).getByRole("checkbox", { name: "下发成功" }));

    expect(getDebugRow("charger.input_current_limit_ma")).toBeInTheDocument();
    expect(() => getDebugRow("battery.cell_temp_limit_c")).toThrow();
  });

  it("连接、修改 target、下发的基本链路仍能工作", () => {
    renderDebuggingPage();

    const parameterKey = "charger.charge_pump.enable";
    changeTargetFromDetail("充电泵使能", "0");
    expect(document.body).toHaveTextContent("1 项参数等待应用");

    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    fireEvent.click(screen.getByRole("button", { name: "下发调试值" }));

    const row = getDebugRow(parameterKey);
    expect(row).toHaveTextContent("0");
  });

  it("目标设定值在表格中只读显示，只允许在详情弹窗中多行编辑", () => {
    renderDebuggingPage();

    const parameterKey = "charger.charge_pump.enable";
    const multilineValue = "mode=diagnostic\nenable=0";
    const row = getDebugRow(parameterKey);
    const targetCell = row.querySelector<HTMLElement>("td[data-label='目标设定值']");

    expect(screen.queryByLabelText(`${parameterKey} 目标设定值`)).not.toBeInTheDocument();
    expect(targetCell).toHaveTextContent("1");

    fireEvent.click(screen.getByRole("button", { name: "编辑 充电泵使能" }));

    const detailEditor = screen.getByLabelText("目标设定值");
    expect(detailEditor.tagName).toBe("TEXTAREA");
    fireEvent.change(detailEditor, { target: { value: multilineValue } });
    expect(detailEditor).toHaveValue(multilineValue);
    expect(targetCell).toHaveTextContent("mode=diagnostic");
    expect(targetCell).toHaveTextContent("enable=0");
  });

  it("不再渲染硬编码的示例时间条目（10:45:02 / 10:50:11 / 10:52:30）", () => {
    renderDebuggingPage();

    expect(screen.queryByText(/10:45:02/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10:50:11/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10:52:30/)).not.toBeInTheDocument();
    expect(screen.queryByText(/读取全量充电参数快照/)).not.toBeInTheDocument();
  });
});

describe("/debugging runtime wiring", () => {
  it("API mode connect button starts a runtime debugging session for the active project", async () => {
    const actions = createDebuggingActions();

    renderDebuggingPage({ debuggingActions: actions });

    fireEvent.click(getTopbarConnectButton());

    await waitFor(() => expect(actions.detectAndStartSession).toHaveBeenCalledWith(userState.activeProjectId));
    expect(actions.detectAndStartSession).toHaveBeenCalledTimes(1);
  });

  it("API mode pushes pending values through runtime actions instead of direct dispatch", async () => {
    const actions = createDebuggingActions();
    const dispatch = vi.fn();
    const pendingParameters = getPendingDebugParameters();
    const pendingIds = pendingParameters.map((parameter) => parameter.id);
    if (pendingIds.length === 0) {
      throw new Error("Expected at least one pending debug parameter in fixture data.");
    }

    renderDebuggingPage({ state: runtimePendingUserState, debuggingActions: actions, dispatch });

    expect(getPushButton()).not.toBeDisabled();
    fireEvent.click(getPushButton());

    await waitFor(() => expect(actions.pushValues).toHaveBeenCalledWith(pendingIds));
    expect(dispatch).not.toHaveBeenCalledWith({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingIds });
  });

  it("API mode rollback confirmation calls the runtime rollback action with the fixed confirmation token", async () => {
    const actions = createDebuggingActions();
    const state = withSnapshot(connectedUserState);
    const dispatch = vi.fn();

    renderDebuggingPage({ state, debuggingActions: actions, dispatch });

    fireEvent.click(getRollbackButton());
    fireEvent.click(getRollbackConfirmButton());

    await waitFor(() =>
      expect(actions.rollbackSnapshot).toHaveBeenCalledWith({
        snapshotId: apiSnapshot.id,
        confirmationToken: "confirm-rollback"
      })
    );
    expect(dispatch).not.toHaveBeenCalledWith({ type: "ROLLBACK_LAST_SNAPSHOT" });
  });

  it("failed API push shows a user-facing notice and leaves pending rows untouched", async () => {
    const actions = createDebuggingActions({
      pushValues: vi.fn().mockRejectedValue(new Error("Gateway write failed"))
    });
    const dispatch = vi.fn();
    const pendingParameters = getPendingDebugParameters();
    const pendingIds = pendingParameters.map((parameter) => parameter.id);
    if (pendingIds.length === 0) {
      throw new Error("Expected at least one pending debug parameter in fixture data.");
    }

    renderDebuggingPage({ state: runtimePendingUserState, debuggingActions: actions, dispatch });

    fireEvent.click(getPushButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("Gateway write failed");
    expect(dispatch).not.toHaveBeenCalledWith({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingIds });
    for (const parameter of pendingParameters) {
      expect(getDebugRow(parameter.key)).toHaveTextContent(parameter.status);
    }
  });

  it("API mode disables push while a runtime write is in flight", async () => {
    const pendingPush = createDeferred();
    const actions = createDebuggingActions({
      pushValues: vi.fn().mockReturnValue(pendingPush.promise)
    });
    const pendingIds = getPendingDebugParameters().map((parameter) => parameter.id);

    renderDebuggingPage({ state: runtimePendingUserState, debuggingActions: actions });

    const pushButton = getPushButton();
    fireEvent.click(pushButton);
    fireEvent.click(pushButton);

    expect(actions.pushValues).toHaveBeenCalledTimes(1);
    expect(actions.pushValues).toHaveBeenCalledWith(pendingIds);
    expect(pushButton).toBeDisabled();

    pendingPush.resolve();
    await waitFor(() => expect(pushButton).not.toBeDisabled());
  });

  it("keeps push disabled while connect starts during an in-flight runtime write", async () => {
    const pendingPush = createDeferred();
    const pendingConnect = createDeferred<{
      session: {
        id: string;
        projectId: string;
        deviceId: string;
        targetId: string;
        status: "active" | "closed";
        startedAt: string;
        endedAt: string | null;
      };
      target: { id: string; deviceId: string; label: string };
    }>();
    const actions = createDebuggingActions({
      detectAndStartSession: vi.fn().mockReturnValue(pendingConnect.promise),
      pushValues: vi.fn().mockReturnValue(pendingPush.promise)
    });

    renderDebuggingPage({ state: runtimePendingUserState, debuggingActions: actions });

    const pushButton = getPushButton();
    fireEvent.click(pushButton);
    fireEvent.click(getTopbarConnectButton());
    fireEvent.click(pushButton);

    expect(actions.pushValues).toHaveBeenCalledTimes(1);
    expect(pushButton).toBeDisabled();

    pendingConnect.resolve({
      session: {
        id: "api-session-1",
        projectId: userState.activeProjectId,
        deviceId: userState.devices[0].id,
        targetId: "api-target-1",
        status: "active",
        startedAt: "2026-05-27T09:00:00.000Z",
        endedAt: null
      },
      target: { id: "api-target-1", deviceId: userState.devices[0].id, label: "API Target" }
    });
    pendingPush.resolve();
    await waitFor(() => expect(pushButton).not.toBeDisabled());
  });

  it("mock mode still dispatches connect, push, and rollback actions", () => {
    const dispatch = vi.fn();
    const state = withSnapshot(runtimePendingUserState);
    const pendingIds = getPendingDebugParameters(state).map((parameter) => parameter.id);
    if (pendingIds.length === 0) {
      throw new Error("Expected at least one pending debug parameter in fixture data.");
    }

    renderDebuggingPage({ state, dispatch });

    fireEvent.click(getTopbarConnectButton());
    fireEvent.click(getPushButton());
    fireEvent.click(getRollbackButton());
    fireEvent.click(getRollbackConfirmButton());

    expect(dispatch).toHaveBeenCalledWith({ type: "CONNECT_DEVICE", deviceId: state.devices[0].id });
    expect(dispatch).toHaveBeenCalledWith({ type: "PUSH_DEBUG_VALUES", parameterIds: pendingIds });
    expect(dispatch).toHaveBeenCalledWith({ type: "ROLLBACK_LAST_SNAPSHOT" });
  });
});

describe("离线提示条", () => {
  it("参数调试页不再渲染离线 banner", () => {
    renderDebuggingPage();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/设备离线/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SessionSummaryCard 集成", () => {
  it("未连接默认设备时按钮 disabled 且提示连接设备", () => {
    renderDebuggingPage();
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/连接/));
  });

  it("连接后按钮仍 disabled（尚无快照）但 title 文案改变", () => {
    renderDebuggingPage();
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/尚无快照/));
  });
});

describe("回滚链路端到端", () => {
  it("下发 → 回滚 → 快照清空、currentValue 恢复", () => {
    renderDebuggingPage();

    fireEvent.click(screen.getByRole("button", { name: "连接" }));

    const firstRow = screen.getByRole("table").querySelector<HTMLElement>("tbody tr:first-child");
    if (!firstRow) {
      throw new Error("找不到第一行");
    }
    const originalCurrentText = firstRow.querySelector("td.mono")?.textContent ?? "";
    const firstParameterName = firstRow.querySelector("td[data-label='参数名称'] strong")?.textContent ?? "";
    changeTargetFromDetail(firstParameterName, "999");
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));

    expect(screen.getByText(/snap-/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /回滚到上次快照/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认回滚/ }));

    expect(screen.queryByText(/snap-/)).not.toBeInTheDocument();

    const restoredCurrent = firstRow.querySelector("td.mono")?.textContent ?? "";
    expect(restoredCurrent).toBe(originalCurrentText);
  });

  it("点击取消保留快照", () => {
    renderDebuggingPage();
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    const firstRow = screen.getByRole("table").querySelector<HTMLElement>("tbody tr:first-child");
    const firstParameterName = firstRow?.querySelector("td[data-label='参数名称'] strong")?.textContent ?? "";
    if (!firstParameterName) {
      throw new Error("找不到第一行参数名称");
    }
    changeTargetFromDetail(firstParameterName, "999");
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));
    fireEvent.click(screen.getByRole("button", { name: /回滚到上次快照/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText(/snap-/)).toBeInTheDocument();
  });
});

describe("OperationHistoryPanel 集成", () => {
  it("页面底部出现折叠式操作记录面板（默认折叠）", () => {
    renderDebuggingPage();
    expect(screen.getByRole("button", { name: /调试操作记录/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
  });

  it("下发后展开面板能看到 push 事件", () => {
    renderDebuggingPage();
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    const firstRow = screen.getByRole("table").querySelector<HTMLElement>("tbody tr:first-child");
    const firstParameterName = firstRow?.querySelector("td[data-label='参数名称'] strong")?.textContent ?? "";
    if (!firstParameterName) {
      throw new Error("找不到第一行参数名称");
    }
    changeTargetFromDetail(firstParameterName, "999");
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));
    fireEvent.click(screen.getByRole("button", { name: /调试操作记录/ }));
    expect(screen.getByText(/下发 1 项/)).toBeInTheDocument();
  });

  it("table-actionbar 中不再出现断掉的一键回滚按钮", () => {
    renderDebuggingPage();
    expect(screen.queryByRole("button", { name: /一键回滚充电策略/ })).not.toBeInTheDocument();
  });
});

describe("/debugging-admin 节点元数据", () => {
  it("在调试管理页通过路径绑定弹窗保存节点路径与访问模式字段", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    render(<App initialAppState={adminState} runtimeMode="mock" />);

    const firstRow = screen.getByRole("row", { name: /charger\.input_current_limit_ma/ });
    fireEvent.click(within(firstRow).getByRole("button", { name: "路径绑定" }));
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), {
      target: { value: "/sys/class/power_supply/battery/test_node" }
    });
    await userEvent.click(screen.getByLabelText("HDC 访问模式"));
    await userEvent.click(screen.getByRole("option", { name: "WO · 只写" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    fireEvent.click(screen.getByRole("button", { name: /配置源预览/ }));

    expect(document.body).toHaveTextContent("/sys/class/power_supply/battery/test_node");
    expect(document.body).toHaveTextContent('"accessMode": "WO"');
  });
});
