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
    expect(within(main).queryByLabelText("调试操作记录")).not.toBeInTheDocument();
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
