import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionSummaryCard } from "./SessionSummaryCard";
import { createPrototypeState, type DebugSnapshot } from "../mockData";

afterEach(() => cleanup());

const connectedState = () => {
  const base = createPrototypeState();
  return {
    ...base,
    debuggingSessionStartedAt: "2026-05-10T20:00:00.000Z",
    devices: base.devices.map((device, index) => (index === 0 ? { ...device, status: "已连接" as const } : device))
  };
};

describe("SessionSummaryCard", () => {
  it("未连接设备时显示设备名 + 未连接状态 + 按钮 disabled", () => {
    const base = createPrototypeState();
    const disconnectedState = {
      ...base,
      devices: base.devices.map((device) => ({ ...device, status: "未连接" as const }))
    };
    render(
      <SessionSummaryCard
        state={disconnectedState}
        now={new Date("2026-05-10T20:05:00.000Z")}
        onRollbackRequest={() => undefined}
      />
    );
    expect(screen.getByText(/离线/)).toBeInTheDocument();
    expect(screen.getByText(/ChargeLab_X01/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /回滚到上次快照/ })).toBeDisabled();
  });

  it("已连接 + 无快照 → 显示尚无快照提示，按钮 disabled", () => {
    const state = connectedState();
    render(
      <SessionSummaryCard
        state={state}
        now={new Date("2026-05-10T20:12:00.000Z")}
        onRollbackRequest={() => undefined}
      />
    );
    expect(screen.getByText(/尚无快照/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /回滚到上次快照/ })).toBeDisabled();
  });

  it("已连接 + 有快照 → 显示快照 ID，按钮可点击，点击触发 onRollbackRequest", () => {
    const snapshot: DebugSnapshot = {
      id: "snap-0001",
      createdAt: "2026-05-10T20:08:00.000Z",
      entries: [{ parameterId: "dbg-pid-p", previousValue: "1.2", nextValue: "1.5" }],
      risk: "High"
    };
    const state = { ...connectedState(), lastDebugSnapshot: snapshot };
    const handle = vi.fn();
    render(
      <SessionSummaryCard
        state={state}
        now={new Date("2026-05-10T20:10:00.000Z")}
        onRollbackRequest={handle}
      />
    );
    expect(screen.getByText(/snap-0001/)).toBeInTheDocument();
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("展示会话时长（向下取整分钟）与 3 个计数", () => {
    const state = connectedState();
    render(
      <SessionSummaryCard
        state={{ ...state, pushedDebugIds: [state.debugParameters[0].id] }}
        now={new Date("2026-05-10T20:12:45.000Z")}
        onRollbackRequest={() => undefined}
      />
    );
    expect(screen.getByText(/12 分钟/)).toBeInTheDocument();
    expect(screen.getByText("已下发").parentElement).toHaveTextContent("1");
    expect(screen.getByText("失败").parentElement).toHaveTextContent("0");
  });
});
