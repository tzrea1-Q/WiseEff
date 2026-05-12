import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("/debugging 单栏骨架", () => {
  it("渲染为单栏布局，不再出现筛选侧栏或右侧调试时间轴", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);

    const main = screen.getByRole("main");
    expect(within(main).queryByLabelText("参数筛选")).not.toBeInTheDocument();
    expect(within(main).queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
    expect(main.querySelector(".workbench-one-col")).toBeInTheDocument();
    expect(main.querySelector(".workbench-grid")).not.toBeInTheDocument();
  });

  it("保留主表格和现有下发按钮能跑通的基本功能", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);

    expect(screen.getByText("实时可调参数")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /下发调试值/ })).toBeInTheDocument();
  });

  it("连接、修改 target、下发的基本链路仍能工作", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);

    const parameterKey = "charger.charge_pump.enable";
    fireEvent.change(screen.getByLabelText(`${parameterKey} 目标设定值`), { target: { value: "0" } });
    expect(document.body).toHaveTextContent("1 项参数等待应用");

    fireEvent.click(screen.getByRole("button", { name: "连接" }));
    fireEvent.click(screen.getByRole("button", { name: "下发调试值" }));

    const row = Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr")).find((item) =>
      item.textContent?.includes(parameterKey)
    );
    expect(row).toBeDefined();
    expect(row).toHaveTextContent("0");
  });

  it("不再渲染硬编码的示例时间条目（10:45:02 / 10:50:11 / 10:52:30）", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);

    expect(screen.queryByText(/10:45:02/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10:50:11/)).not.toBeInTheDocument();
    expect(screen.queryByText(/10:52:30/)).not.toBeInTheDocument();
    expect(screen.queryByText(/读取全量充电参数快照/)).not.toBeInTheDocument();
  });
});

describe("DisconnectedBanner 集成", () => {
  it("默认设备 aurora 未连接时显示 banner", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    expect(screen.getByRole("status")).toHaveTextContent(/ChargeLab_X01/);
  });

  it("点击 banner 的连接样机后 banner 消失", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("SessionSummaryCard 集成", () => {
  it("未连接默认设备时按钮 disabled 且提示连接设备", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/连接/));
  });

  it("连接后按钮仍 disabled（尚无快照）但 title 文案改变", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));
    const button = screen.getByRole("button", { name: /回滚到上次快照/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", expect.stringMatching(/尚无快照/));
  });
});

describe("回滚链路端到端", () => {
  it("下发 → 回滚 → 快照清空、currentValue 恢复", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));

    const firstTargetInput = document.querySelector<HTMLInputElement>("tbody tr:first-child input[aria-label*='目标设定值']");
    if (!firstTargetInput) {
      throw new Error("找不到第一行目标值输入");
    }
    const originalCurrentText = firstTargetInput.closest("tr")?.querySelector("td.mono")?.textContent ?? "";
    fireEvent.change(firstTargetInput, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));

    expect(screen.getByText(/snap-/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /回滚到上次快照/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认回滚/ }));

    expect(screen.queryByText(/snap-/)).not.toBeInTheDocument();

    const restoredCurrent = firstTargetInput.closest("tr")?.querySelector("td.mono")?.textContent ?? "";
    expect(restoredCurrent).toBe(originalCurrentText);
  });

  it("点击取消保留快照", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));
    const firstTargetInput = document.querySelector<HTMLInputElement>("tbody tr:first-child input[aria-label*='目标设定值']");
    if (!firstTargetInput) {
      throw new Error("找不到输入");
    }
    fireEvent.change(firstTargetInput, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));
    fireEvent.click(screen.getByRole("button", { name: /回滚到上次快照/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText(/snap-/)).toBeInTheDocument();
  });
});

describe("OperationHistoryPanel 集成", () => {
  it("页面底部出现折叠式操作记录面板（默认折叠）", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    expect(screen.getByRole("button", { name: /调试操作记录/ })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "调试事件列表" })).not.toBeInTheDocument();
  });

  it("下发后展开面板能看到 push 事件", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "连接样机" }));
    const input = document.querySelector<HTMLInputElement>("tbody tr:first-child input[aria-label*='目标设定值']");
    if (!input) {
      throw new Error("找不到输入");
    }
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.click(screen.getByRole("button", { name: /下发调试值/ }));
    fireEvent.click(screen.getByRole("button", { name: /调试操作记录/ }));
    expect(screen.getByText(/下发 1 项/)).toBeInTheDocument();
  });

  it("table-actionbar 中不再出现断掉的一键回滚按钮", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App />);
    expect(screen.queryByRole("button", { name: /一键回滚充电策略/ })).not.toBeInTheDocument();
  });
});
