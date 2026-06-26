import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { debuggingRuntimeFailureNotification } from "./application/debugging/debuggingRuntime";
import type { DebuggingRuntimeActions } from "./application/debugging/debuggingRuntime";
import { NodeDebuggingPage } from "./NodeDebuggingPage";
import { initialState } from "./mockData";
import { resolveLocalBridgeHealthUrl } from "./infrastructure/http/localBridgeHttpUrl";

const userState = { ...initialState, activeRoleId: "user" };
const apiSession = {
  id: "api-session-1",
  projectId: userState.activeProjectId,
  deviceId: "api-device-1",
  targetId: "api-target-1",
  protocol: "hdc" as const,
  status: "active" as const,
  startedAt: "2026-05-27T09:00:00.000Z",
  endedAt: null
};
const apiTarget = { id: "api-target-1", deviceId: "api-device-1", protocol: "hdc" as const, label: "API Gateway Target" };

const complexJsonAutoRead = {
  ok: true,
  value: '{"inputLimitMa": 3600',
  returncode: 0,
  stdout: '{"inputLimitMa": 3600,\n',
  stderr: ""
};

const complexDtsAutoRead = {
  ok: true,
  value: "/ {",
  returncode: 0,
  stdout: "/ {\n",
  stderr: ""
};

function withComplexDebugAutoReads(responses: unknown[]) {
  return [...responses, complexJsonAutoRead, complexDtsAutoRead];
}

function createDebuggingActions(overrides: Partial<DebuggingRuntimeActions> = {}): DebuggingRuntimeActions {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    detectAndStartSession: vi.fn().mockResolvedValue({ session: apiSession, target: apiTarget }),
    readNode: vi.fn(async (input) => ({
      ok: true,
      value: input.parameterId === "dbg-charge-input-current" ? "3651" : "12",
      stdout: `${input.parameterId === "dbg-charge-input-current" ? "3651" : "12"}\n`,
      durationMs: 7,
      operation: {
        id: `op-read-${input.parameterId}`,
        sessionId: apiSession.id,
        parameterId: input.parameterId,
        nodePath: input.nodePath,
        operationType: "read",
        status: "succeeded",
        readValue: input.parameterId === "dbg-charge-input-current" ? "3651" : "12",
        verified: true,
        durationMs: 7,
        createdAt: "2026-05-27T09:00:01.000Z"
      }
    })),
    writeNode: vi.fn().mockResolvedValue({
      ok: true,
      value: "3700",
      verified: true,
      writeResult: { ok: true, stdout: "write ok\n", durationMs: 8 },
      readResult: { ok: true, value: "3700", stdout: "3700\n", durationMs: 9 },
      operation: {
        id: "op-write-1",
        sessionId: apiSession.id,
        parameterId: "dbg-charge-input-current",
        nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
        operationType: "write",
        status: "succeeded",
        requestedValue: "3700",
        readbackValue: "3700",
        verified: true,
        durationMs: 17,
        createdAt: "2026-05-27T09:00:02.000Z"
      }
    }),
    pushValues: vi.fn(),
    rollbackSnapshot: vi.fn(),
    rollbackLastSnapshot: vi.fn(),
    connectDevice: vi.fn(),
    ...overrides
  };
}

function mockFetchSequence(responses: unknown[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async () => {
    const next = responses.shift();
    return new Response(JSON.stringify(next ?? { ok: true }));
  }) as typeof fetch);
}

function findRowByText(text: string) {
  const row = Array.from(screen.getByRole("table").querySelectorAll("tbody tr")).find((item) =>
    item.textContent?.includes(text)
  );
  if (!row) {
    throw new Error(`Cannot find row containing ${text}`);
  }
  return row as HTMLElement;
}

function currentValueCell(row: HTMLElement) {
  const cell = row.querySelector('[data-label="当前值"]');
  if (!cell) {
    throw new Error("Cannot find current value cell");
  }
  return cell as HTMLElement;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/node-debugging");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("/node-debugging", () => {
  it("uses API gateway actions to auto-detect and shows the returned target label", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenCalledWith(userState.activeProjectId, { protocol: "hdc" }));
    expect(await screen.findByText(/在线 · API Gateway Target/)).toBeInTheDocument();
  });

  it("passes the selected protocol to API target detection", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/在线 · API Gateway Target/);
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenLastCalledWith(
      userState.activeProjectId,
      { protocol: "adb" }
    ));
  });

  it("refreshes runtime parameters for the selected protocol when switching protocols", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/在线 · API Gateway Target/);
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    await waitFor(() => expect(debuggingActions.refresh).toHaveBeenCalledWith({
      projectId: userState.activeProjectId,
      protocol: "adb"
    }));
  });

  it("clears the active session and auto-detects when switching protocol", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    expect(await screen.findByText(/在线 · API Gateway Target/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenLastCalledWith(
      userState.activeProjectId,
      { protocol: "adb" }
    ));
    expect(debuggingActions.detectAndStartSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/切换协议后需要重新检测设备/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/在线 · API Gateway Target/)).toBeInTheDocument());
  });

  it("disables rows that are missing a binding for the selected protocol", () => {
    const missingBindingState = {
      ...userState,
      debugParameters: [{
        ...userState.debugParameters[0],
        nodePath: "",
        bindingStatus: "missing" as const,
        selectedProtocol: "adb" as const
      }]
    };
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });

    render(<NodeDebuggingPage state={missingBindingState} debuggingActions={debuggingActions} />);

    expect(screen.getByText("未配置该协议节点")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /选择/ })).toBeDisabled();
  });

  it("clears runtime read state when switching protocols", async () => {
    let detectCallCount = 0;
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => {
        detectCallCount += 1;
        if (detectCallCount === 1) {
          return Promise.resolve({ session: apiSession, target: apiTarget });
        }
        return new Promise<never>(() => undefined);
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await waitFor(() => expect(debuggingActions.readNode).toHaveBeenCalled());
    expect(await within(findRowByText("charger.input_current_limit_ma")).findByText("3651")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    await waitFor(() => {
      expect(within(findRowByText("charger.input_current_limit_ma")).queryByText("3651")).not.toBeInTheDocument();
    });
    expect(within(findRowByText("charger.input_current_limit_ma")).getByText("等待读取")).toBeInTheDocument();
  });

  it("recomputes row binding availability when switching protocols", async () => {
    const hdcOnlyParameter = {
      ...userState.debugParameters[0],
      nodePath: "/sys/hdc/input_current_limit",
      accessMode: "RW" as const,
      selectedProtocol: "hdc" as const,
      bindingStatus: "configured" as const,
      bindings: [{
        protocol: "hdc" as const,
        nodePath: "/sys/hdc/input_current_limit",
        accessMode: "RW" as const,
        enabled: true
      }]
    };
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });

    render(<NodeDebuggingPage state={{ ...userState, debugParameters: [hdcOnlyParameter] }} debuggingActions={debuggingActions} />);

    expect(screen.getByRole("checkbox", { name: /选择/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    expect(await screen.findByText("未配置该协议节点")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /选择/ })).toBeDisabled();
  });

  it("does not reuse a selected binding from another protocol when full bindings are absent", async () => {
    const hdcSelectedParameter = {
      ...userState.debugParameters[0],
      nodePath: "/sys/hdc/input_current_limit",
      accessMode: "RW" as const,
      selectedProtocol: "hdc" as const,
      bindingStatus: "configured" as const
    };
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });

    render(<NodeDebuggingPage state={{ ...userState, debugParameters: [hdcSelectedParameter] }} debuggingActions={debuggingActions} />);

    expect(screen.getByRole("checkbox", { name: /选择/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    expect(await screen.findByText("未配置该协议节点")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /选择/ })).toBeDisabled();
  });

  it("ignores stale detect results after switching protocols", async () => {
    const hdcDetect = createDeferred<{ session: typeof apiSession; target: typeof apiTarget }>();
    const adbDetect = createDeferred<{ session: typeof apiSession; target: typeof apiTarget }>();
    let detectCallCount = 0;
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => {
        detectCallCount += 1;
        return detectCallCount === 1 ? hdcDetect.promise : adbDetect.promise;
      }),
      readNode: vi.fn()
    });

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenCalledWith(
      userState.activeProjectId,
      { protocol: "hdc" }
    ));

    fireEvent.click(screen.getByRole("button", { name: "ADB" }));
    await waitFor(() => expect(debuggingActions.detectAndStartSession).toHaveBeenLastCalledWith(
      userState.activeProjectId,
      { protocol: "adb" }
    ));

    await act(async () => {
      hdcDetect.resolve({ session: apiSession, target: apiTarget });
      await hdcDetect.promise;
    });

    expect(screen.queryByText(/在线 · API Gateway Target/)).not.toBeInTheDocument();
    expect(screen.queryByText(/切换协议后需要重新检测设备/)).not.toBeInTheDocument();
    expect(debuggingActions.readNode).not.toHaveBeenCalled();
  });

  it("keeps protocol switching usable when protocol storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    expect(screen.getByRole("button", { name: "HDC" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    expect(screen.getByRole("button", { name: "ADB" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/检测中 · ADB 设备/)).toBeInTheDocument();
  });

  it("uses API gateway actions to read initial readable node rows", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await waitFor(() => expect(debuggingActions.readNode).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: apiSession.id,
      parameterId: "dbg-charge-input-current",
      nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma"
    })));
    expect(debuggingActions.readNode).not.toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-trickle-start"
    }));
    expect(await within(findRowByText("charger.input_current_limit_ma")).findByText("3651")).toBeInTheDocument();
  });

  it("shows read failure instead of staying on reading when API read rejects", async () => {
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn().mockRejectedValue(new Error("Node read failed."))
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/API Gateway Target/);
    const row = findRowByText("charger.input_current_limit_ma");
    await within(row).findByText("Node read failed.");
    expect(within(row).getByText(/^失败$/)).toBeInTheDocument();
    expect(currentValueCell(row)).not.toHaveTextContent("读取中...");
  });

  it("shows read failure when API read returns a failed result", async () => {
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn().mockResolvedValue({
        ok: false,
        error: "node missing",
        stderr: "No such file"
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/API Gateway Target/);
    const row = findRowByText("charger.input_current_limit_ma");
    await within(row).findByText("node missing");
    expect(within(row).getByText(/^失败$/)).toBeInTheDocument();
    expect(currentValueCell(row)).not.toHaveTextContent("读取中...");
    expect(currentValueCell(row)).not.toHaveTextContent("等待读取");
  });

  it("shows the API error reason when read rejects with a runtime failure", async () => {
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn().mockRejectedValue(
        Object.assign(new Error("ADB command failed: No such file or directory", { cause: new Error("adb read failed") }), {
          alreadyNotified: true,
          cause: new Error("adb read failed")
        })
      )
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/API Gateway Target/);
    const row = findRowByText("charger.input_current_limit_ma");
    await within(currentValueCell(row)).findByText("ADB command failed: No such file or directory");
    expect(within(row).getByText(/^失败$/)).toBeInTheDocument();
    expect(currentValueCell(row)).not.toHaveTextContent(debuggingRuntimeFailureNotification);
  });

  it("syncs visible node rows when API hydration replaces debug parameters", () => {
    const apiParameter = {
      ...userState.debugParameters[0],
      id: "dbg-api-fast-charge-current",
      name: "Fast charge current",
      key: "fast_charge_current",
      currentValue: "3000",
      targetValue: "3100"
    };
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });
    const { rerender } = render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    expect(findRowByText("charger.input_current_limit_ma")).toBeInTheDocument();

    rerender(
      <NodeDebuggingPage
        state={{ ...userState, debugParameters: [apiParameter] }}
        debuggingActions={debuggingActions}
      />
    );

    expect(findRowByText("fast_charge_current")).toBeInTheDocument();
    expect(screen.queryByText("charger.input_current_limit_ma")).not.toBeInTheDocument();
  });

  it("reads hydrated API rows when auto-detect resolves after parameter hydration", async () => {
    const apiParameter = {
      ...userState.debugParameters[0],
      id: "dbg-api-fast-charge-current",
      name: "Fast charge current",
      key: "fast_charge_current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current",
      currentValue: "3000",
      targetValue: "3100"
    };
    const detect = createDeferred<{ session: typeof apiSession; target: typeof apiTarget }>();
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => detect.promise)
    });
    const { rerender } = render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    rerender(
      <NodeDebuggingPage
        state={{ ...userState, debugParameters: [apiParameter] }}
        debuggingActions={debuggingActions}
      />
    );
    detect.resolve({ session: apiSession, target: apiTarget });

    await waitFor(() => expect(debuggingActions.readNode).toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-api-fast-charge-current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current"
    })));
    expect(debuggingActions.readNode).not.toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-charge-input-current"
    }));
  });

  it("keeps the detected API target while replacing stale pre-hydration reads", async () => {
    const apiParameter = {
      ...userState.debugParameters[0],
      id: "dbg-api-fast-charge-current",
      name: "Fast charge current",
      key: "fast_charge_current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current",
      currentValue: "3000",
      targetValue: "3100"
    };
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn(async (input) => {
        if (input.parameterId === "dbg-api-fast-charge-current") {
          return {
            ok: true,
            value: "3000",
            stdout: "3000\n"
          };
        }

        throw new Error("Debug parameter was not found.");
      })
    });
    const { rerender } = render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await waitFor(() => expect(debuggingActions.readNode).toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-charge-input-current"
    })));
    rerender(
      <NodeDebuggingPage
        state={{ ...userState, debugParameters: [apiParameter] }}
        debuggingActions={debuggingActions}
      />
    );

    expect(await screen.findByText(/API Gateway Target/)).toBeInTheDocument();
    await waitFor(() => expect(debuggingActions.readNode).toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-api-fast-charge-current",
      nodePath: "/sys/class/power_supply/battery/constant_charge_current"
    })));
    expect(await within(findRowByText("fast_charge_current")).findByText("3000")).toBeInTheDocument();
  });

  it("writes edited writable rows through API gateway actions with session and readback context", async () => {
    const debuggingActions = createDebuggingActions();
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/在线 · API Gateway Target/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await waitFor(() => expect(debuggingActions.writeNode).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: apiSession.id,
      parameterId: "dbg-charge-input-current",
      nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
      value: "3700",
      readBack: true
    })));
  });

  it("shows write failure instead of staying on reading when API write rejects", async () => {
    const debuggingActions = createDebuggingActions({
      writeNode: vi.fn().mockRejectedValue(new Error("Debug parameter is not configured for the selected protocol."))
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/在线 · API Gateway Target/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^写入失败$/);
    expect(currentValueCell(row)).toHaveTextContent("该节点不支持");
    expect(currentValueCell(row)).not.toHaveTextContent("读取中...");
    expect(currentValueCell(row)).not.toHaveTextContent("写入中...");
  });

  it("shows write failure instead of staying on reading when API write returns a failed result", async () => {
    const debuggingActions = createDebuggingActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: false,
        error: "Debug parameter is not configured for the selected protocol.",
        writeResult: { ok: false, stderr: "Debug parameter is not configured for the selected protocol." }
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/在线 · API Gateway Target/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^写入失败$/);
    expect(currentValueCell(row)).toHaveTextContent("该节点不支持");
    expect(currentValueCell(row)).not.toHaveTextContent("读取中...");
  });

  it("shows API readback mismatches as failed row status with the returned error", async () => {
    const debuggingActions = createDebuggingActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: true,
        value: "3600",
        verified: false,
        error: "readback mismatch: expected 3700, got 3600",
        writeResult: { ok: true, stdout: "write ok\n" },
        readResult: { ok: true, value: "3600", stdout: "3600\n" },
        operation: {
          id: "op-write-mismatch",
          sessionId: apiSession.id,
          parameterId: "dbg-charge-input-current",
          nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
          operationType: "write",
          status: "readback_mismatch",
          requestedValue: "3700",
          readbackValue: "3600",
          verified: false,
          failureReason: "readback mismatch: expected 3700, got 3600",
          durationMs: 18,
          createdAt: "2026-05-27T09:00:02.000Z"
        }
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/在线 · API Gateway Target/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^失败$/);
    expect(row).toHaveTextContent("readback mismatch: expected 3700, got 3600");
  });

  it("keeps a failed write state when a stale API auto-read resolves later", async () => {
    const delayedRead = createDeferred<Awaited<ReturnType<DebuggingRuntimeActions["readNode"]>> & { operation?: unknown }>();
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn((input) => {
        if (input.parameterId === "dbg-charge-input-current") {
          return delayedRead.promise;
        }
        return Promise.resolve({
          ok: true,
          value: "12",
          stdout: "12\n"
        });
      }),
      writeNode: vi.fn().mockResolvedValue({
        ok: true,
        value: "3600",
        verified: false,
        error: "readback mismatch: expected 3700, got 3600",
        writeResult: { ok: true, stdout: "write ok\n" },
        readResult: { ok: true, value: "3600", stdout: "3600\n" },
        operation: {
          id: "op-write-mismatch",
          sessionId: apiSession.id,
          parameterId: "dbg-charge-input-current",
          nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
          operationType: "write",
          status: "readback_mismatch",
          requestedValue: "3700",
          readbackValue: "3600",
          verified: false,
          failureReason: "readback mismatch: expected 3700, got 3600",
          durationMs: 18,
          createdAt: "2026-05-27T09:00:02.000Z"
        }
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/API Gateway Target/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getAllByRole("button").at(-1) as HTMLElement);

    await within(row).findByText(/^失败$/);
    expect(row).toHaveTextContent("readback mismatch: expected 3700, got 3600");

    delayedRead.resolve({
      ok: true,
      value: "3651",
      stdout: "3651\n",
      operation: {
        id: "op-read-stale",
        sessionId: apiSession.id,
        parameterId: "dbg-charge-input-current",
        nodePath: "/data/local/tmp/wiseeff_nodes/charger/input_current_limit_ma",
        operationType: "read",
        status: "succeeded",
        readValue: "3651",
        verified: true,
        durationMs: 7,
        createdAt: "2026-05-27T09:00:03.000Z"
      }
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /节点操作记录/ })).toHaveTextContent("10 条"));
    expect(row).toHaveTextContent("readback mismatch: expected 3700, got 3600");
    expect(within(row).getByText(/^失败$/)).toBeInTheDocument();
    expect(within(row).queryByText(/^成功$/)).not.toBeInTheDocument();
  });

  it("records a diagnostic event when API detect rejects", async () => {
    const detectError = Object.assign(new Error("gateway session create failed"), {
      stderr: "ECONNRESET from debugging gateway",
      returncode: 52
    });
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn().mockRejectedValue(detectError)
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText("检测失败，请检查 HDC 环境");
    expect(screen.queryByText(/gateway session create failed/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /节点操作记录/ }));

    const events = await screen.findByRole("list", { name: "节点操作事件列表" });
    expect(events).toHaveTextContent("检测失败");
    expect(events).toHaveTextContent("返回码 52");
    expect(events).toHaveTextContent("ECONNRESET from debugging gateway");
  });

  it("sends only pending writable rows during API bulk write", async () => {
    const debuggingActions = createDebuggingActions({
      writeNode: vi.fn(async (input) => ({
        ok: true,
        value: input.value,
        verified: true,
        operation: {
          id: `op-write-${input.parameterId}`,
          sessionId: apiSession.id,
          parameterId: input.parameterId,
          nodePath: input.nodePath,
          operationType: "write",
          status: "succeeded",
          requestedValue: input.value,
          verified: true,
          durationMs: 11,
          createdAt: "2026-05-27T09:00:02.000Z"
        }
      }))
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/在线 · API Gateway Target/);

    const pendingWoRow = findRowByText("charger.trickle_switch_soc");
    const syncedRwRow = findRowByText("battery.thermal_foldback_pct");
    fireEvent.click(within(pendingWoRow).getByRole("checkbox", { name: /选择 涓流切换电量点/ }));
    fireEvent.click(within(syncedRwRow).getByRole("checkbox", { name: /选择 热降额触发点/ }));
    fireEvent.click(screen.getByRole("button", { name: /下发选中 \(1\)/ }));

    await waitFor(() => expect(debuggingActions.writeNode).toHaveBeenCalledTimes(1));
    expect(debuggingActions.writeNode).toHaveBeenCalledWith(expect.objectContaining({
      parameterId: "dbg-trickle-start",
      value: "95",
      readBack: false
    }));
  });

  it("shows a Windows install CTA when the local bridge is missing", async () => {
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === resolveLocalBridgeHealthUrl()) {
        throw new Error("bridge offline");
      }
      if (url.endsWith("/api/v1/device-bridges/mine")) {
        return new Response(JSON.stringify({ items: [] }));
      }
      if (url.endsWith("/api/v1/device-bridges/releases")) {
        return new Response(JSON.stringify({
          recommendedVersion: "0.1.0",
          minCompatibleVersion: "0.1.0",
          items: [
            {
              platform: "windows",
              arch: "amd64",
              version: "0.1.0",
              artifactKind: "installer",
              downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe"
            },
            {
              platform: "windows",
              arch: "amd64",
              version: "0.1.0",
              artifactKind: "portable",
              downloadUrl: "/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
            }
          ]
        }));
      }
      if (url.endsWith("/api/v1/device-bridges/pairing-codes") && method === "POST") {
        return new Response(JSON.stringify({ code: "123456", expiresAt: "2026-06-24T12:00:00.000Z" }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch);

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    const downloadLink = await screen.findByRole("link", { name: "安装 Bridge（Windows）" });
    expect(downloadLink).toHaveAttribute(
      "href",
      "http://127.0.0.1:8787/downloads/device-bridge/0.1.0/windows/amd64/WiseEffBridgeSetup_0.1.0.exe"
    );
    expect(screen.getByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByText("本机推荐")).toBeInTheDocument();
    expect(screen.getByText(/已识别当前环境/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("便携压缩包（zip / tar.gz）"));
    expect(screen.getByRole("link", { name: "下载 Windows Bridge（x64）" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:8787/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip"
    );
  });

  it("shows tools install CTA when bridge is connected but adb is missing", async () => {
    // @acceptance BRIDGE-TOOLS-001
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === resolveLocalBridgeHealthUrl()) {
        return new Response(JSON.stringify({
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-25T00:00:00.000Z",
          tools: {
            adb: { available: false, reason: "adb not found" },
            hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
          }
        }));
      }
      if (url.endsWith("/api/v1/device-bridges/mine")) {
        return new Response(JSON.stringify({ items: [{ id: "br-1", machineLabel: "Desk", platform: "darwin", arch: "arm64" }] }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch);

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    expect(await screen.findByText(/缺少 ADB 调试工具/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /安装调试工具/i })).toBeInTheDocument();
    expect(screen.queryByText(/未检测到本地 Bridge/)).not.toBeInTheDocument();
  });

  it("lets users return to step 1 to download bridge installers when bridge is already online", async () => {
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn(() => new Promise<never>(() => undefined))
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === resolveLocalBridgeHealthUrl()) {
        return new Response(JSON.stringify({
          ok: true,
          paired: true,
          connected: true,
          updatedAt: "2026-06-26T00:00:00.000Z",
          tools: {
            adb: { available: true, version: "adb version", source: "system" },
            hdc: { available: true, version: "hdc version 2.0.0", source: "system" }
          }
        }));
      }
      if (url.endsWith("/api/v1/device-bridges/mine")) {
        return new Response(JSON.stringify({ items: [{ id: "br-1", machineLabel: "Desk", platform: "darwin", arch: "arm64" }] }));
      }
      if (url.endsWith("/api/v1/device-bridges/releases")) {
        return new Response(JSON.stringify({
          recommendedVersion: "0.1.0",
          minCompatibleVersion: "0.1.0",
          items: [
            {
              platform: "darwin",
              arch: "arm64",
              version: "0.1.0",
              artifactKind: "installer",
              downloadUrl: "/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg"
            }
          ]
        }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch);

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    expect(await screen.findByRole("button", { name: "安装 Bridge" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "下载安装包" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "安装 Bridge" }));

    expect(await screen.findByText("图形安装包（推荐）")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "安装 Bridge（macOS Apple Silicon）" })).toHaveAttribute(
      "href",
      "http://127.0.0.1:8787/downloads/device-bridge/0.1.0/darwin/arm64/WiseEffBridge_0.1.0_darwin_arm64.pkg"
    );
  });

  it("shows bridge target selection when adb detect returns multiple bridge-backed targets", async () => {
    const bridgeTargets = [
      {
        id: "bridge:br-1:adb:serial-123",
        deviceId: "bridge:br-1",
        protocol: "adb" as const,
        bridgeId: "br-1",
        bridgeMachineLabel: "MacBook",
        targetRef: "serial-123",
        label: "ADB serial-123"
      },
      {
        id: "bridge:br-2:adb:serial-456",
        deviceId: "bridge:br-2",
        protocol: "adb" as const,
        bridgeId: "br-2",
        bridgeMachineLabel: "Office-PC",
        targetRef: "serial-456",
        label: "ADB serial-456"
      }
    ];
    const adbSession = {
      ...apiSession,
      id: "api-session-adb-1",
      protocol: "adb" as const,
      targetId: bridgeTargets[0].id,
      deviceId: bridgeTargets[0].deviceId
    };
    const detectAndStartSession = vi.fn()
      .mockResolvedValueOnce({ session: apiSession, target: apiTarget })
      .mockResolvedValueOnce({ candidates: bridgeTargets })
      .mockResolvedValueOnce({ session: adbSession, target: bridgeTargets[0] });
    const debuggingActions = createDebuggingActions({
      detectAndStartSession
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);

    await screen.findByText(/在线 · API Gateway Target/);
    fireEvent.click(screen.getByRole("button", { name: "ADB" }));

    const picker = await screen.findByRole("region", { name: "设备代理目标选择" });
    const selectTargetButton = within(picker).getByRole("button", { name: "连接 MacBook · serial-123" });
    fireEvent.click(selectTargetButton);

    await waitFor(() => expect(detectAndStartSession).toHaveBeenLastCalledWith(
      userState.activeProjectId,
      {
        protocol: "adb",
        targetId: "bridge:br-1:adb:serial-123",
        bridgeId: "br-1"
      }
    ));
    expect(await screen.findByText(/在线 · MacBook · serial-123/)).toBeInTheDocument();
  });

  it("supports inline bridge rename and revoke in adb bridge management", async () => {
    const debuggingActions = createDebuggingActions({
      detectAndStartSession: vi.fn()
        .mockResolvedValueOnce({ session: apiSession, target: apiTarget })
        .mockResolvedValue({ session: { ...apiSession, protocol: "adb" as const }, target: { ...apiTarget, protocol: "adb" as const } })
    });
    let currentBridge = {
      id: "br-1",
      machineLabel: "Laptop",
      platform: "windows",
      arch: "amd64",
      clientVersion: "0.1.0",
      capabilities: {},
      createdAt: "2026-06-23T00:00:00.000Z",
      lastSeenAt: "2026-06-23T00:05:00.000Z",
      revokedAt: null as string | null
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(vi.fn(async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === resolveLocalBridgeHealthUrl()) {
        return new Response(JSON.stringify({
          ok: true,
          paired: true,
          connected: true,
          bridgeId: "br-1",
          updatedAt: "2026-06-23T00:05:30.000Z"
        }));
      }
      if (url.endsWith("/api/v1/device-bridges/mine")) {
        return new Response(JSON.stringify({ items: [currentBridge] }));
      }
      if (url.endsWith("/api/v1/device-bridges/br-1") && method === "PATCH") {
        currentBridge = { ...currentBridge, machineLabel: "Desk-PC" };
        return new Response(JSON.stringify({ item: currentBridge }));
      }
      if (url.endsWith("/api/v1/device-bridges/br-1/revoke") && method === "POST") {
        currentBridge = { ...currentBridge, revokedAt: "2026-06-23T00:10:00.000Z" };
        return new Response(JSON.stringify({ item: currentBridge }));
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    fireEvent.click(await screen.findByRole("button", { name: "ADB" }));

    const renameInput = await screen.findByDisplayValue("Laptop");
    fireEvent.change(renameInput, { target: { value: "Desk-PC" } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/device-bridges/br-1"),
      expect.objectContaining({ method: "PATCH" })
    ));
    expect(await screen.findByDisplayValue("Desk-PC")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/device-bridges/br-1/revoke"),
      expect.objectContaining({ method: "POST" })
    ));
    expect(await screen.findByText("已撤销")).toBeInTheDocument();
  });

  it("falls back to local HDC calls when API gateway actions are not supplied", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead,
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "write ok\n", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<NodeDebuggingPage state={userState} />);
    await screen.findByText(/在线 · target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hdc/targets"));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hdc/read-node", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hdc/write-node", expect.objectContaining({ method: "POST" })));
  });

  it("auto-detects hdc targets on entry", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/hdc/targets"));
    expect(await screen.findByText(/已连接：target-a/)).toBeInTheDocument();
  });

  it("moves hdc connection controls into the topbar and removes the standalone page header", async () => {
    mockFetchSequence([{ ok: false, targets: [], stderr: "hdc target detection failed" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText("检测失败，请检查 HDC 环境");

    const topbarActions = document.querySelector(".topbar-page-actions") as HTMLElement | null;
    expect(topbarActions).toBeInTheDocument();
    await waitFor(() => expect(topbarActions).toHaveTextContent("未连接 HDC 设备"));
    expect(within(topbarActions as HTMLElement).getByRole("button", { name: "重新检测" })).toBeInTheDocument();
    expect(document.querySelector(".node-debugging-page > .page-header")).not.toBeInTheDocument();
  });

  it("does not show seeded values as current values before readable nodes are read", async () => {
    mockFetchSequence([{ ok: false, targets: [], stderr: "hdc target detection failed" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText("检测失败，请检查 HDC 环境");
    expect(screen.queryByText("hdc target detection failed")).not.toBeInTheDocument();

    const rwRow = findRowByText("charger.input_current_limit_ma");
    const roRow = findRowByText("battery.impedance_mohm");
    const woRow = findRowByText("charger.trickle_switch_soc");

    expect(currentValueCell(rwRow)).toHaveTextContent("等待读取");
    expect(currentValueCell(rwRow)).not.toHaveTextContent("3600");
    expect(currentValueCell(roRow)).toHaveTextContent("等待读取");
    expect(currentValueCell(roRow)).not.toHaveTextContent("68");
    expect(currentValueCell(woRow)).toHaveTextContent("写入后不可回读");
  });

  it("auto-reads readable nodes after hdc detection", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3651", returncode: 0, stdout: "3651\n", stderr: "" },
      { ok: true, value: "41", returncode: 0, stdout: "41\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "69", returncode: 0, stdout: "69\n", stderr: "" },
      { ok: true, value: "80", returncode: 0, stdout: "80\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5100", returncode: 0, stdout: "5100\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText(/已连接：target-a/);
    const rwRow = await within(findRowByText("charger.input_current_limit_ma")).findByText("3651");
    expect(rwRow).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(10);
    expect(fetch).toHaveBeenLastCalledWith("/api/hdc/read-node", expect.objectContaining({ method: "POST" }));
  });

  it("shows a node debug session summary and updates it after writes", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead,
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    const summary = await screen.findByRole("region", { name: "调试会话摘要" });
    await within(summary).findByText(/在线 · target-a/);
    expect(summary).toHaveTextContent("会话时长");
    expect(summary).toHaveTextContent("已写入");
    expect(summary).toHaveTextContent("待写入");
    expect(summary).toHaveTextContent("失败");
    expect(summary).toHaveTextContent("1");

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^成功$/);
    expect(summary).toHaveTextContent("最近操作");
    expect(summary).toHaveTextContent("充电输入限流");
    expect(summary).toHaveTextContent("成功");
    expect(within(summary).getByText("已写入").nextElementSibling).toHaveTextContent("1");
  });

  it("uses a compact status set with distinct status classes", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3651", returncode: 0, stdout: "3651\n", stderr: "" },
      { ok: true, value: "41", returncode: 0, stdout: "41\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "69", returncode: 0, stdout: "69\n", stderr: "" },
      { ok: true, value: "80", returncode: 0, stdout: "80\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5100", returncode: 0, stdout: "5100\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await within(findRowByText("charger.input_current_limit_ma")).findByText("成功");
    const successBadge = within(findRowByText("charger.input_current_limit_ma")).getByText("成功");
    const pendingBadge = within(findRowByText("charger.trickle_switch_soc")).getByText("待写入");

    expect(successBadge).toHaveClass("node-status-badge", "node-status-success");
    expect(pendingBadge).toHaveClass("node-status-badge", "node-status-pending");
    expect(screen.queryByText("读取成功")).not.toBeInTheDocument();
    expect(screen.queryByText("回读一致")).not.toBeInTheDocument();
    expect(screen.queryByText("回读不一致")).not.toBeInTheDocument();
  });

  it("does not expose node paths to normal users", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText(/已连接：target-a/);
    expect(document.body).not.toHaveTextContent("/data/local/tmp/wiseeff_nodes");
  });

  it("omits risk filtering, risk column, and access mode filtering", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText(/已连接：target-a/);

    expect(screen.queryByRole("button", { name: /风险等级/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "风险" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选访问模式" })).not.toBeInTheDocument();
  });

  it("仅将状态筛选合并到表头，搜索框仍独立存在", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText(/已连接：target-a/);

    expect(screen.getByRole("searchbox", { name: "按名称 / Key 搜索" })).toBeInTheDocument();
    expect(document.querySelector(".parameters-table-filters")).not.toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "筛选模块" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选访问模式" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选状态" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "待写入" }));

    expect(screen.getByRole("button", { name: "筛选状态" })).toHaveClass("active");
    expect(findRowByText("charger.trickle_switch_soc")).toBeInTheDocument();
    expect(screen.queryByText("charger.input_current_limit_ma")).not.toBeInTheDocument();
  });

  it("仅支持从状态表头筛选节点参数", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);

    await screen.findByText(/已连接：target-a/);

    const headers: Array<[string, string, string | RegExp]> = [
      ["状态", "筛选状态", "待写入"]
    ];

    for (const [headerName, buttonName, optionName] of headers) {
      const header = screen.getByRole("columnheader", { name: new RegExp(headerName) });
      const button = within(header).getByRole("button", { name: buttonName });
      fireEvent.click(button);
      expect(within(header).getByRole("checkbox", { name: optionName })).toBeInTheDocument();
      fireEvent.click(button);
    }

    expect(screen.queryByRole("button", { name: "筛选参数名称" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选访问模式" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选当前值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选目标写入值" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选范围" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "筛选模块" })).not.toBeInTheDocument();

    const statusHeader = screen.getByRole("columnheader", { name: /状态/ });
    fireEvent.click(within(statusHeader).getByRole("button", { name: "筛选状态" }));
    fireEvent.click(within(statusHeader).getByRole("checkbox", { name: "待写入" }));

    expect(findRowByText("charger.trickle_switch_soc")).toBeInTheDocument();
    expect(screen.queryByText("charger.input_current_limit_ma")).not.toBeInTheDocument();
  });

  it("uses a detail sheet for node operations instead of row-level read and write controls", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const roRow = findRowByText("battery.impedance_mohm");
    const woRow = findRowByText("charger.trickle_switch_soc");
    const rwRow = findRowByText("charger.input_current_limit_ma");

    expect(screen.queryByRole("button", { name: /^读取$/ })).not.toBeInTheDocument();
    expect(within(rwRow).queryByLabelText(/目标写入值/)).not.toBeInTheDocument();
    expect(within(roRow).getByRole("button", { name: /查看详情/ })).toBeInTheDocument();
    expect(within(roRow).queryByRole("button", { name: /写入/ })).not.toBeInTheDocument();
    expect(within(woRow).getByRole("button", { name: /查看\/修改/ })).toBeInTheDocument();
    expect(within(rwRow).getByRole("button", { name: /查看\/修改/ })).toBeInTheDocument();
  });

  it("shows read-only node details without a write input", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("battery.impedance_mohm");
    fireEvent.click(within(row).getByRole("button", { name: /查看详情/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    expect(within(dialog).getByText("battery.impedance_mohm")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("68 mΩ");
    expect(within(dialog).queryByLabelText("目标写入值")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /写入/ })).not.toBeInTheDocument();
  });

  it("writes and verifies RW nodes from the detail sheet", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead,
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    expect(screen.queryByRole("dialog", { name: /确认写入节点/ })).not.toBeInTheDocument();
    await within(row).findByText(/^成功$/);
    expect(currentValueCell(row)).toHaveTextContent("3700");
  });

  it("stashes detail edits and writes selected pending nodes in bulk", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead,
      {
        ok: true,
        verified: true,
        value: "3700",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3700\n", stderr: "" }
      }
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "暂存" }));

    expect(screen.queryByRole("dialog", { name: /节点详情/ })).not.toBeInTheDocument();
    expect(within(row).getByText("3700")).toBeInTheDocument();
    expect(within(row).getByText("待写入")).toHaveClass("node-status-pending");
    expect(within(row).getByRole("checkbox", { name: /选择 充电输入限流/ })).toBeChecked();
    expect(screen.getByText("已选 1 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /下发选中 \(1\)/ }));

    await within(row).findByText(/^成功$/);
    expect(fetch).toHaveBeenLastCalledWith("/api/hdc/write-node", expect.objectContaining({ method: "POST" }));
  });

  it("shows write format as an independent detail section", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });

    expect(formatSection).toHaveTextContent("写入格式");
    expect(formatSection).toHaveTextContent("示例");
    expect(formatSection).toHaveTextContent("3600");
    expect(formatSection).toHaveTextContent("RW");
    expect(formatSection).toHaveTextContent("2000 - 5000 mA");
    expect(formatSection).not.toHaveTextContent("/data/local/tmp/wiseeff_nodes");
  });

  it("places the target value input after the write format section", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });
    const targetInput = within(dialog).getByLabelText("目标写入值");

    expect(formatSection.compareDocumentPosition(targetInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps write format examples stable while editing the target value", async () => {
    mockFetchSequence([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    const formatSection = within(dialog).getByRole("region", { name: "写入格式" });

    expect(formatSection).toHaveTextContent("例如输入 3600");
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });

    expect(formatSection).toHaveTextContent("例如输入 3600");
    expect(formatSection).not.toHaveTextContent("3700");
  });

  it("uses a multiline target value editor for complex writes", async () => {
    mockFetchSequence(withComplexDebugAutoReads([{ ok: true, targets: ["target-a"], activeTarget: "target-a" }]));
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.policy_overlay_json");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));

    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    expect(dialog.closest(".node-complex-editor")).toBeInTheDocument();
    const targetEditor = within(dialog).getByLabelText("目标写入值");
    const multilineValue = "{\n  \"inputLimitMa\": 3700\n}";

    expect(targetEditor.tagName).toBe("TEXTAREA");
    expect(targetEditor).toHaveAttribute("wrap", "off");
    fireEvent.change(targetEditor, { target: { value: multilineValue } });
    expect(targetEditor).toHaveValue(multilineValue);
  });

  it("shows compact preview for complex read-only parameters in the table", async () => {
    const complexRo = userState.debugParameters.find((parameter) => parameter.id === "dbg-battery-health-dts");
    if (!complexRo) {
      throw new Error("missing complex read-only debug parameter");
    }

    const fullDts = complexRo.currentValue;
    const debuggingActions = createDebuggingActions({
      readNode: vi.fn(async (input) => ({
        ok: true,
        value: input.parameterId === "dbg-battery-health-dts" ? fullDts : "12",
        stdout: `${input.parameterId === "dbg-battery-health-dts" ? fullDts : "12"}\n`,
        operation: {
          id: `op-read-${input.parameterId}`,
          sessionId: apiSession.id,
          parameterId: input.parameterId,
          nodePath: input.nodePath,
          operationType: "read",
          status: "succeeded",
          readValue: input.parameterId === "dbg-battery-health-dts" ? fullDts : "12",
          verified: true,
          durationMs: 7,
          createdAt: "2026-05-27T09:00:01.000Z",
          valueKind: input.parameterId === "dbg-battery-health-dts" ? "complex" : undefined,
          valueFormat: input.parameterId === "dbg-battery-health-dts" ? "dts" : undefined,
          valuePreview: input.parameterId === "dbg-battery-health-dts" ? `${fullDts.slice(0, 80)}…` : undefined
        }
      }))
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/API Gateway Target/);

    const row = findRowByText("battery.health_dts_fragment");
    await waitFor(() => expect(within(row).getByText("DTS")).toBeInTheDocument());
    expect(currentValueCell(row).querySelector(".debug-value-preview")).toBeInTheDocument();
    expect(currentValueCell(row)).toHaveTextContent("…");
    expect(currentValueCell(row)).not.toHaveTextContent("alert-levels");
  });

  it("shows preview and digest for complex write events in operation history", async () => {
    const complexJson = userState.debugParameters.find((parameter) => parameter.id === "dbg-charge-policy-json")?.targetValue ?? "";
    const digest = "abc123deadbeef0123456789abcdef0123456789abcdef0123456789ab";
    const preview = '{"inputLimitMa": 3700';
    const debuggingActions = createDebuggingActions({
      writeNode: vi.fn().mockResolvedValue({
        ok: true,
        value: complexJson,
        verified: true,
        writeResult: { ok: true, stdout: "write ok\n", durationMs: 8 },
        readResult: { ok: true, value: complexJson, stdout: complexJson, durationMs: 9 },
        operation: {
          id: "op-write-complex",
          sessionId: apiSession.id,
          parameterId: "dbg-charge-policy-json",
          nodePath: "/data/local/tmp/wiseeff_nodes/charger/policy_overlay_json",
          operationType: "write",
          status: "succeeded",
          requestedValue: complexJson,
          readbackValue: complexJson,
          verified: true,
          durationMs: 17,
          createdAt: "2026-05-27T09:00:02.000Z",
          valueKind: "complex",
          valueFormat: "json",
          valuePreview: preview,
          requestedValueDigest: digest,
          readbackValueDigest: digest
        }
      })
    });
    render(<NodeDebuggingPage state={userState} debuggingActions={debuggingActions} />);
    await screen.findByText(/API Gateway Target/);

    const row = findRowByText("charger.policy_overlay_json");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: /节点详情/ })).getByRole("button", { name: /写入并回读/ }));

    await waitFor(() => expect(debuggingActions.writeNode).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /节点操作记录/ }));
    const events = await screen.findByRole("list", { name: "节点操作事件列表" });
    expect(events).toHaveTextContent(preview);
    expect(events).toHaveTextContent("abc123deadbe");
    expect(events).toHaveTextContent("JSON");
  });

  it("marks RW readback mismatch", async () => {
    mockFetchSequence([
      { ok: true, targets: ["target-a"], activeTarget: "target-a" },
      { ok: true, value: "3600", returncode: 0, stdout: "3600\n", stderr: "" },
      { ok: true, value: "43", returncode: 0, stdout: "43\n", stderr: "" },
      { ok: true, value: "1", returncode: 0, stdout: "1\n", stderr: "" },
      { ok: true, value: "68", returncode: 0, stdout: "68\n", stderr: "" },
      { ok: true, value: "84", returncode: 0, stdout: "84\n", stderr: "" },
      { ok: true, value: "46", returncode: 0, stdout: "46\n", stderr: "" },
      { ok: true, value: "5200", returncode: 0, stdout: "5200\n", stderr: "" },
      complexJsonAutoRead,
      complexDtsAutoRead,
      {
        ok: true,
        verified: false,
        value: "3600",
        writeResult: { returncode: 0, stdout: "", stderr: "" },
        readResult: { returncode: 0, stdout: "3600\n", stderr: "" }
      }
    ]);
    render(<App initialAppState={userState} runtimeMode="mock" />);
    await screen.findByText(/已连接：target-a/);

    const row = findRowByText("charger.input_current_limit_ma");
    fireEvent.click(within(row).getByRole("button", { name: /查看\/修改/ }));
    const dialog = screen.getByRole("dialog", { name: /节点详情/ });
    fireEvent.change(within(dialog).getByLabelText("目标写入值"), { target: { value: "3700" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /写入并回读/ }));

    await within(row).findByText(/^失败$/);
  });
});
