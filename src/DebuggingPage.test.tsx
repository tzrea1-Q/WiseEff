import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { type AppAction } from "./App";
import type { DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import { TopBarActionsContext } from "./components/layout";
import { DebuggingPage } from "./DebuggingPage";
import { createDebuggingAdminClient } from "./infrastructure/http/debuggingAdminClient";
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

function createResolvedAdminAuthClient() {
  return {
    getCurrentAuthContext: vi.fn().mockResolvedValue({
      user: {
        id: "admin-api",
        organizationId: "org-api",
        name: "API Admin",
        username: "api.admin",
        title: "Admin",
        isActive: true
      },
      organization: { id: "org-api", name: "API Org" },
      roles: [{ projectId: null, roleId: "admin" }],
      permissions: ["debugging:view", "debugging:admin", "admin:access"]
    })
  };
}

function createDebuggingAdminApiMock() {
  const seedParameter = {
    id: "param-1",
    projectId: null,
    name: "Fast charge current",
    key: "debug.fast_charge.current",
    description: "Parameter",
    module: "Charging",
    nodePath: "/sys/current",
    accessMode: "RW",
    unit: "mA",
    range: "0-5000",
    risk: "High",
    currentValue: "3000",
    targetValue: "3000",
    sortOrder: 10,
    enabled: true,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    bindings: [
      { protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true },
      { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true }
    ]
  };

  return {
    seedParameter,
    get: vi.fn().mockResolvedValue({ items: [seedParameter] }),
    post: vi.fn().mockResolvedValue({ item: seedParameter }),
    patch: vi.fn().mockImplementation((_path, body) => Promise.resolve({ item: { ...seedParameter, ...body } })),
    put: vi.fn()
  };
}

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

    const main = screen.getByRole("main");
    expect(within(main).queryByLabelText("参数筛选")).not.toBeInTheDocument();
    expect(within(main).queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
    expect(main.querySelector(".workbench-one-col")).toBeInTheDocument();
    expect(main.querySelector(".workbench-grid")).not.toBeInTheDocument();
  });

  it("保留主表格和现有下发按钮能跑通的基本功能", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

    const parameterKey = "charger.charge_pump.enable";
    changeTargetFromDetail("充电泵使能", "0");
    expect(document.body).toHaveTextContent("1 项参数等待应用");

    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    fireEvent.click(screen.getByRole("button", { name: "下发调试值" }));

    const row = getDebugRow(parameterKey);
    expect(row).toHaveTextContent("0");
  });

  it("目标设定值在表格中只读显示，只允许在详情弹窗中多行编辑", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    const pendingConnect = createDeferred<{ session: Awaited<ReturnType<DebuggingRuntimeActions["detectAndStartSession"]>>["session"]; target: Awaited<ReturnType<DebuggingRuntimeActions["detectAndStartSession"]>>["target"] }>();
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

describe("/debugging-admin API mode", () => {
  it("loads API catalog parameters, edits a draft, and saves through PATCH", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledWith("/api/v1/debugging/admin/parameters?includeArchived=true");
    expect(screen.getByText("双协议")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Fast charge current edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存参数" }));

    await waitFor(() => expect(apiClient.patch).toHaveBeenCalled());
    expect(apiClient.patch.mock.calls[0][0]).toBe("/api/v1/debugging/admin/parameters/param-1");
    expect(apiClient.patch.mock.calls[0][1]).toEqual(expect.objectContaining({ name: "Fast charge current edited" }));
    expect(apiClient.patch.mock.calls[0][1].bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/current", accessMode: "RW", enabled: true }),
        expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: true })
      ])
    );
  });

  it("creates a new API catalog parameter without archiving the existing selection", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ 新增" }));

    expect(screen.queryByRole("button", { name: "归档 Fast charge current" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Thermal throttle limit" } });
    fireEvent.change(screen.getByLabelText("参数 key"), { target: { value: "debug.thermal.throttle_limit" } });
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/sys/hdc/thermal_limit" } });
    fireEvent.change(screen.getByLabelText("ADB 节点路径"), { target: { value: "/sys/adb/thermal_limit" } });
    fireEvent.click(screen.getByRole("button", { name: "保存参数" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters",
      expect.objectContaining({
        key: "debug.thermal.throttle_limit",
        name: "Thermal throttle limit",
        bindings: expect.arrayContaining([
          expect.objectContaining({ protocol: "hdc", nodePath: "/sys/hdc/thermal_limit" }),
          expect.objectContaining({ protocol: "adb", nodePath: "/sys/adb/thermal_limit" })
        ])
      })
    ));
    expect(apiClient.post.mock.calls.some(([path]) => path === "/api/v1/debugging/admin/parameters/param-1/archive")).toBe(false);
  });

  it("treats disabled API parameters as inactive instead of archived", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.get.mockResolvedValue({
      items: [{
        ...apiClient.seedParameter,
        enabled: false,
        archivedAt: null
      }]
    });

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();
    expect(screen.queryByText("已归档")).not.toBeInTheDocument();
    expect(screen.getByText("已停用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档 Fast charge current" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "恢复参数" })).not.toBeInTheDocument();
  });

  it("keeps unsaved parameter metadata while saving and archiving protocol bindings", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.put.mockResolvedValue({
      item: { protocol: "hdc", nodePath: "/sys/hdc/current_edited", accessMode: "RW", enabled: true, notes: "saved" }
    });
    apiClient.post.mockResolvedValue({
      item: { protocol: "adb", nodePath: "/sys/adb/current", accessMode: "RO", enabled: false, notes: "archived" }
    });

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
      />
    );

    expect(await screen.findByText("Fast charge current")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("参数名称"), { target: { value: "Fast charge current draft" } });
    fireEvent.change(screen.getByLabelText("HDC 节点路径"), { target: { value: "/sys/hdc/current_edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 HDC binding" }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters/param-1/bindings/hdc",
      expect.objectContaining({ nodePath: "/sys/hdc/current_edited", accessMode: "RW", enabled: true })
    ));
    expect(screen.getByLabelText("参数名称")).toHaveValue("Fast charge current draft");

    fireEvent.click(screen.getByRole("button", { name: "归档 ADB binding" }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/debugging/admin/parameters/param-1/bindings/adb/archive",
      {}
    ));
    expect(screen.getByLabelText("参数名称")).toHaveValue("Fast charge current draft");
  });

  it("archives parameters instead of hard deleting in API mode", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    const apiClient = createDebuggingAdminApiMock();
    apiClient.post.mockResolvedValue({
      item: {
        ...apiClient.seedParameter,
        enabled: false,
        archivedAt: "2026-06-22T12:00:00.000Z",
        archivedBy: "admin-api",
        archiveReason: "Archived from debugging admin."
      }
    });

    render(
      <App
        authClient={createResolvedAdminAuthClient()}
        debuggingAdminClient={createDebuggingAdminClient(apiClient as never)}
        initialAppState={adminState}
        runtimeMode="api"
      />
    );

    await screen.findByText("Fast charge current");
    fireEvent.click(screen.getByRole("button", { name: "归档 Fast charge current" }));

    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith(
        "/api/v1/debugging/admin/parameters/param-1/archive",
        { reason: "Archived from debugging admin." }
      )
    );
  });
});

describe("离线提示条", () => {
  it("参数调试页不再渲染离线 banner", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByText(/设备离线/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SessionSummaryCard 集成", () => {
  it("未连接默认设备时按钮 disabled 且提示连接设备", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/连接/));
  });

  it("连接后按钮仍 disabled（尚无快照）但 title 文案改变", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/尚无快照/));
  });
});

describe("回滚链路端到端", () => {
  it("下发 → 回滚 → 快照清空、currentValue 恢复", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
    expect(screen.getByRole("button", { name: /调试操作记录/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
  });

  it("下发后展开面板能看到 push 事件", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
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
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);
    expect(screen.queryByRole("button", { name: /一键回滚充电策略/ })).not.toBeInTheDocument();
  });
});

describe("/debugging-admin 节点元数据", () => {
  it("在调试管理页暴露并保存节点路径与访问模式字段", async () => {
    window.history.replaceState(null, "", "/debugging-admin");
    render(<App initialAppState={adminState} runtimeMode="mock" />);

    fireEvent.change(screen.getByLabelText("节点路径"), {
      target: { value: "/sys/class/power_supply/battery/test_node" }
    });
    await userEvent.click(screen.getByLabelText("访问模式"));
    await userEvent.click(screen.getByRole("option", { name: "WO · 只写" }));

    fireEvent.click(screen.getByRole("button", { name: /配置源预览/ }));

    expect(document.body).toHaveTextContent('"nodePath": "/sys/class/power_supply/battery/test_node"');
    expect(document.body).toHaveTextContent('"accessMode": "WO"');
  });
});
