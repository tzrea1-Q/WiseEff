import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RollbackConfirmDialog } from "./RollbackConfirmDialog";
import type { DebugParameter, DebugSnapshot } from "../mockData";

const snapshot: DebugSnapshot = {
  id: "snap-0003",
  createdAt: "2026-05-10T20:08:00.000Z",
  entries: [
    { parameterId: "dbg-pid-p", previousValue: "1.2", nextValue: "1.5" },
    { parameterId: "dbg-fast-current", previousValue: "3800", nextValue: "3200" }
  ],
  risk: "High"
};

const parameters: DebugParameter[] = [
  {
    id: "dbg-pid-p",
    name: "pid_proportional_gain",
    key: "charger.pid.p",
    description: "",
    module: "",
    currentValue: "1.5",
    targetValue: "1.5",
    unit: "",
    range: "0.1 - 5.0",
    risk: "Medium",
    status: "下发成功"
  },
  {
    id: "dbg-fast-current",
    name: "fast_charge_current_limit_ma",
    key: "charger.fast.current",
    description: "",
    module: "",
    currentValue: "3200",
    targetValue: "3200",
    unit: "mA",
    range: "2500 - 4500",
    risk: "High",
    status: "下发成功"
  }
];

afterEach(() => cleanup());

describe("RollbackConfirmDialog", () => {
  it("渲染快照 ID 与所有参数的 diff（当前 → 上次快照前值）", () => {
    render(
      <RollbackConfirmDialog
        snapshot={snapshot}
        parameters={parameters}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    expect(screen.getByText(/snap-0003/)).toBeInTheDocument();
    expect(screen.getByText(/pid_proportional_gain/)).toBeInTheDocument();
    expect(screen.getByText(/fast_charge_current_limit_ma/)).toBeInTheDocument();
    expect(screen.getByText(/3200/)).toBeInTheDocument();
    expect(screen.getByText(/3800/)).toBeInTheDocument();
  });

  it("点击取消触发 onCancel，不触发 onConfirm", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RollbackConfirmDialog
        snapshot={snapshot}
        parameters={parameters}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("点击确认按钮触发 onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <RollbackConfirmDialog
        snapshot={snapshot}
        parameters={parameters}
        onCancel={() => undefined}
        onConfirm={onConfirm}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /确认回滚/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("主按钮文案包含条目数", () => {
    render(
      <RollbackConfirmDialog
        snapshot={snapshot}
        parameters={parameters}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    expect(screen.getByRole("button", { name: "确认回滚 (2 项)" })).toBeInTheDocument();
  });

  it("对话框带 aria-modal 与 aria-labelledby", () => {
    render(
      <RollbackConfirmDialog
        snapshot={snapshot}
        parameters={parameters}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
  });
});
