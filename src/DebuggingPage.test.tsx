import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };
const adminState = { ...initialState, activeRoleId: "admin" };

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

  it("将风险、模块和状态筛选合并到表头，搜索框仍独立存在", () => {
    window.history.replaceState(null, "", "/debugging");
    render(<App initialAppState={userState} />);

    expect(screen.getByRole("searchbox", { name: "按名称 / Key 搜索" })).toBeInTheDocument();
    expect(document.querySelector(".parameters-table-filters")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "筛选模块" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Charging Policy" }));

    expect(screen.getByRole("button", { name: "筛选模块" })).toHaveClass("active");
    expect(getDebugRow("charger.charge_pump.enable")).toBeInTheDocument();
    expect(() => getDebugRow("battery.temp.target")).toThrow();
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
    render(<App initialAppState={adminState} />);

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
