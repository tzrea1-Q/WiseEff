import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OperationHistoryPanel } from "./OperationHistoryPanel";
import type { DebugEvent } from "../mockData";

const events: DebugEvent[] = [
  { kind: "connect", deviceId: "device-x01", at: "2026-05-10T20:00:00.000Z" },
  { kind: "push", snapshotId: "snap-0001", parameterIds: ["a", "b"], at: "2026-05-10T20:05:00.000Z", risk: "High" },
  { kind: "rollback", snapshotId: "snap-0001", parameterIds: ["a", "b"], at: "2026-05-10T20:10:00.000Z" }
];

afterEach(() => cleanup());

describe("OperationHistoryPanel 基本版", () => {
  it("默认折叠（列表不可见）", () => {
    render(<OperationHistoryPanel events={events} deviceName="ChargeLab_X01" />);
    expect(screen.queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
  });

  it("点击头部切换展开状态", () => {
    render(<OperationHistoryPanel events={events} deviceName="ChargeLab_X01" />);
    fireEvent.click(screen.getByRole("button", { name: /调试操作记录/ }));
    expect(screen.getByRole("list", { name: "调试事件列表" })).toBeInTheDocument();
  });

  it("展开后按倒序（最新在上）展示三类事件", () => {
    render(<OperationHistoryPanel events={events} deviceName="ChargeLab_X01" />);
    fireEvent.click(screen.getByRole("button", { name: /调试操作记录/ }));
    const list = screen.getByRole("list", { name: "调试事件列表" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/回滚到 snap-0001/);
    expect(items[1]).toHaveTextContent(/下发 2 项.*snap-0001.*含高风险/);
    expect(items[2]).toHaveTextContent(/已连接 ChargeLab_X01/);
  });

  it("空事件列表显示空态提示", () => {
    render(<OperationHistoryPanel events={[]} deviceName="ChargeLab_X01" />);
    fireEvent.click(screen.getByRole("button", { name: /调试操作记录/ }));
    expect(screen.getByText(/本次会话还没有调试记录/)).toBeInTheDocument();
  });

  it("头部展示事件总数", () => {
    render(<OperationHistoryPanel events={events} deviceName="ChargeLab_X01" />);
    expect(screen.getByRole("button", { name: /调试操作记录 · 3 条/ })).toBeInTheDocument();
  });
});
