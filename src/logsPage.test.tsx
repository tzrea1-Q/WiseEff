import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · Header", () => {
  it("显示标题与上传按钮", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    expect(screen.getByRole("heading", { name: "日志智能分析" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上传新日志/ })).toBeInTheDocument();
  });

  it("Complete 日志结论卡显示置信度且主按钮可用", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));

    expect(screen.getByRole("progressbar", { name: "分析置信度" })).toHaveAttribute("aria-valuenow", "88");
    expect(screen.getByRole("button", { name: /生成参数修改请求/ })).toBeEnabled();
  });

  it("Processing 日志主按钮禁用", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    expect(screen.getByRole("button", { name: /生成参数修改请求/ })).toBeDisabled();
  });

  it("Failed 日志结论卡替换为 ErrorAlert", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/格式不支持|二进制/);
    expect(screen.getByRole("button", { name: /重新上传/ })).toBeInTheDocument();
  });

  it("Failed 日志时间线：失败步红色标记且后续步骤灰化", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));

    expect(document.querySelector(".log-timeline__step--failed")).toBeInTheDocument();
    expect(document.querySelectorAll(".log-timeline__step--aborted")).toHaveLength(3);
  });

  it("Processing 日志时间线当前步有 current 标记", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    expect(document.querySelector(".log-timeline__step--current")).toBeInTheDocument();
  });

  it("辅助栏默认显示历史 Tab，切换元数据 Tab 显示文件名和项目", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    const auxPanel = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(auxPanel).getByRole("tab", { name: "历史", selected: true })).toBeInTheDocument();
    fireEvent.click(within(auxPanel).getByRole("tab", { name: "元数据" }));
    const metadataPanel = within(auxPanel).getByRole("tabpanel", { name: "元数据" });
    expect(within(metadataPanel).getByText(/charging_thermal_trace/)).toBeInTheDocument();
    expect(within(metadataPanel).getByText("aurora")).toBeInTheDocument();
  });

  it("结论卡展示 [问 Agent 关于此结论] 按钮，并能打开 WiseAgent", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /问 Agent/ }));

    expect(document.querySelector(".agent-panel")).toBeInTheDocument();
    expect(screen.getByText("WiseAgent")).toBeInTheDocument();
  });

  it("切换日志时 Live Region 播报文件名和状态", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));

    expect(screen.getByTestId("log-live-region")).toHaveTextContent(/usb_pd_negotiation_20260503\.log/);
    expect(screen.getByTestId("log-live-region")).toHaveTextContent(/已完成/);
  });
});
