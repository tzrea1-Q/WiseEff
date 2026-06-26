import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/agent/XiaozeProvider", () => ({
  XiaozeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  XiaozeProactiveInsights: () => null
}));

vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: vi.fn()
}));

import App from "./App";
import { initialState } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };

function FakeXiaozeToggle() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="xiaoze-chat-toggle-anchor">
        <button type="button" aria-label="打开小泽" onClick={() => setOpen(true)} />
      </div>
      {open ? (
        <div data-testid="xiaoze-popup-layer" className="xiaoze-popup-layer">
          <span>小泽</span>
        </div>
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · Header", () => {
  it("显示标题与上传按钮", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(within(topbar).getByRole("button", { name: /上传新日志/ })).toBeInTheDocument();
    expect(within(topbar).queryByRole("heading", { name: "日志智能分析" })).not.toBeInTheDocument();
  });

  it("Complete 日志结论卡显示置信度且主按钮可用", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));

    expect(screen.getByText("AI置信度")).toBeInTheDocument();
    expect(screen.queryByText("置信度")).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "分析置信度" })).toHaveAttribute("aria-valuenow", "88");
    expect(screen.getByRole("button", { name: /生成参数修改请求/ })).toBeEnabled();
  });

  it("Processing 日志主按钮禁用", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    expect(screen.getByRole("button", { name: /生成参数修改请求/ })).toBeDisabled();
  });

  it("Failed 日志结论卡替换为 ErrorAlert", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/格式不支持|二进制/);
    expect(screen.getByRole("button", { name: /重新上传/ })).toBeInTheDocument();
  });

  it("Failed 日志时间线：失败步红色标记且后续步骤灰化", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));

    expect(document.querySelector(".log-timeline__step--failed")).toBeInTheDocument();
    expect(document.querySelectorAll(".log-timeline__step--aborted")).toHaveLength(3);
  });

  it("Processing 日志时间线当前步有 current 标记", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    expect(document.querySelector(".log-timeline__step--current")).toBeInTheDocument();
  });

  it("辅助栏默认显示历史 Tab，切换元数据 Tab 显示文件名和项目", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const auxPanel = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(auxPanel).getByRole("tab", { name: "历史", selected: true })).toBeInTheDocument();
    fireEvent.click(within(auxPanel).getByRole("tab", { name: "元数据" }));
    const metadataPanel = within(auxPanel).getByRole("tabpanel", { name: "元数据" });
    expect(within(metadataPanel).getByText(/charging_thermal_trace/)).toBeInTheDocument();
    expect(within(metadataPanel).getByText("aurora")).toBeInTheDocument();
  });

  it("结论卡展示 [问 Agent 关于此结论] 按钮，并能打开小泽", () => {
    window.history.replaceState(null, "", "/logs");

    render(
      <>
        <App initialAppState={userState} />
        <FakeXiaozeToggle />
      </>
    );

    fireEvent.click(screen.getByRole("button", { name: /问 Agent/ }));

    expect(screen.getByTestId("xiaoze-popup-layer")).toBeInTheDocument();
    expect(screen.getByText("小泽")).toBeInTheDocument();
    expect(document.querySelector(".agent-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("WiseAgent")).not.toBeInTheDocument();
  });

  it("Processing 结论卡不再展示文件名、阶段、时间和设备胶囊标签", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const conclusionCard = screen.getByRole("region", { name: "AI 正在分析..." });
    expect(conclusionCard).not.toHaveTextContent("charging_thermal_trace_20260504.log");
    expect(conclusionCard).not.toHaveTextContent("根因推断");
    expect(conclusionCard).not.toHaveTextContent("10:24:05");
    expect(conclusionCard).not.toHaveTextContent("ChargeLab_X01");
  });

  it("每份日志可通过弹窗反馈置信度和可能问题", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /反馈分析质量/ }));

    const dialog = screen.getByRole("dialog", { name: "反馈分析质量" });
    expect(within(dialog).getByText(/charging_thermal_trace/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("置信度反馈"), { target: { value: "low" } });
    fireEvent.change(within(dialog).getByLabelText("可能存在的问题"), { target: { value: "证据链缺少温控阈值来源" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.queryByRole("dialog", { name: "反馈分析质量" })).not.toBeInTheDocument();
    expect(screen.getByText(/反馈已记录/)).toBeInTheDocument();
  });

  it("切换日志时 Live Region 播报文件名和状态", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));

    expect(screen.getByTestId("log-live-region")).toHaveTextContent(/usb_pd_negotiation_20260503\.log/);
    expect(screen.getByTestId("log-live-region")).toHaveTextContent(/已完成/);
  });
});
