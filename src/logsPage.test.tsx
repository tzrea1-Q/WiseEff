import { selectControlOption } from "@/test/selectControlOption";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
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
import { LogsPage } from "@/features/log-analysis/LogsPage";

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
  it("renders the file inventory tab with analyzed, skipped and lossy files", async () => {
    const log = { ...initialState.logs[0], files: [
      { path: "device/a.log", sizeBytes: 1024, lineCount: 12, encoding: "utf-8" as const, lossy: true, status: "analyzed" as const, skipReason: null },
      { path: "image.bin", sizeBytes: 256, lineCount: 0, encoding: "utf-8" as const, lossy: false, status: "skipped" as const, skipReason: "二进制文件" }
    ] };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "文件" }));
    const inventory = screen.getByRole("region", { name: "日志文件清单" });
    expect(inventory).toHaveTextContent("device/a.log"); expect(inventory).toHaveTextContent("1.0 KiB");
    expect(inventory).toHaveTextContent("12"); expect(inventory).toHaveTextContent("有损解码");
    expect(inventory).toHaveTextContent("已分析"); expect(inventory).toHaveTextContent("已跳过 · 二进制文件");
  });
  it("shows file:line evidence without borrowing text from a different file", () => {
    const log = { ...initialState.logs[0], evidence: [{ ...initialState.logs[0].evidence[0], filePath: "device/b.log", lineNumbers: [2] }] };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    expect(document.querySelector(".evidence-card__body code")).toHaveTextContent("device/b.log:2");
  });
  it("keeps upload available without presenting an empty installation as a failed analysis", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const task = screen.getByRole("region", { name: "日志任务区" });
    expect(within(task).getByText("暂无日志记录，请上传日志。")).toBeInTheDocument();
    expect(within(task).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传新日志" })).toBeEnabled();
  });

  it.each(["Complete", "Processing", "Failed"] as const)("keeps %s records in the navigator and their report in the task area", async (status) => {
    const log = initialState.logs.find((record) => record.status === status)!;
    window.history.replaceState(null, "", `/logs?logId=${log.id}`);
    render(<LogsPage search="" state={userState} dispatch={() => undefined} onNavigate={() => undefined} />);
    const navigator = screen.getByRole("region", { name: "模块导航" });
    const task = screen.getByRole("region", { name: "日志任务区" });
    expect(within(navigator).getByRole("button", { name: new RegExp(log.fileName) })).toHaveAttribute("aria-pressed", "true");
    expect(within(task).getByRole(status === "Failed" ? "alert" : "heading", { ...(status === "Failed" ? {} : { name: status === "Processing" ? "AI 正在分析..." : log.conclusion }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传新日志" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "收起模块导航" }));
    expect(within(task).getByRole(status === "Failed" ? "alert" : "heading", { ...(status === "Failed" ? {} : { name: status === "Processing" ? "AI 正在分析..." : log.conclusion }) })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("logId")).toBe(log.id);
    await userEvent.click(screen.getByRole("button", { name: "展开模块导航" }));
  });

  it("moves focus between auxiliary tabs before activation without changing the selected log", async () => {
    const user = userEvent.setup();
    const log = initialState.logs[1];
    window.history.replaceState(null, "", `/logs?logId=${log.id}`);
    render(<LogsPage search="" state={userState} dispatch={() => undefined} onNavigate={() => undefined} />);
    const tabs = screen.getByRole("tablist", { name: "日志辅助信息" });
    const history = within(tabs).getByRole("tab", { name: "报告" });
    const metadata = within(tabs).getByRole("tab", { name: "元数据" });
    const files = within(tabs).getByRole("tab", { name: "文件" });
    await user.click(history);
    await user.keyboard("{ArrowRight}");
    expect(files).toHaveFocus();
    expect(history).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(metadata).toHaveFocus();
    expect(history).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Enter}");
    const panel = screen.getByRole("tabpanel", { name: "元数据" });
    expect(metadata).toHaveAttribute("aria-controls", panel.id);
    expect(within(within(panel).getByRole("region", { name: "日志任务区" })).getByText(log.fileName)).toBeInTheDocument();
    await user.keyboard("{End}{Enter}");
    expect(screen.getByRole("tabpanel", { name: "相关" })).toHaveTextContent("没有找到关联日志。");
    expect(new URLSearchParams(window.location.search).get("logId")).toBe(log.id);
  });

  it("显示标题与上传按钮", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const topbar = document.querySelector(".topbar") as HTMLElement;
    expect(document.querySelector(".workspace-header")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /上传新日志/ })).toBeInTheDocument();
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
    expect(screen.getByRole("list", { name: "分析流程" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "原始日志" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "日志分析证据链" })).toBeInTheDocument();
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

  it("Failed 日志只显示失败摘要和文件信息，不渲染空分析面板", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    fireEvent.click(within(history).getByRole("button", { name: /thermal_snapshot/ }));

    const summary = screen.getByRole("alert");
    const failedLog = initialState.logs.find((log) => log.status === "Failed")!;
    expect(summary).toHaveTextContent("日志处理失败");
    expect(summary).toHaveTextContent("在 日志解析 阶段失败");
    expect(within(summary).getByText(failedLog.fileName)).toBeInTheDocument();
    expect(summary).toHaveTextContent(`${failedLog.fileSizeMB} MB`);
    expect(summary).toHaveTextContent(failedLog.capturedAt);
    expect(summary).toHaveTextContent(failedLog.submittedBy);
    expect(summary).toHaveTextContent(".log / .txt / .csv / .json");
    expect(screen.queryByRole("list", { name: "分析流程" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "分析结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "原始日志" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "日志分析证据链" })).not.toBeInTheDocument();
    expect(within(history).getByRole("button", { name: /thermal_snapshot/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("Processing 日志时间线当前步有 current 标记", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    expect(document.querySelector(".log-timeline__step--current")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "分析结果" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "原始日志" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "日志分析证据链" })).toBeInTheDocument();
  });

  it("最新日志失败时保留选择，显示实际失败阶段而不切换到旧报告", () => {
    const failedLog = {
      ...initialState.logs.find((log) => log.status === "Failed")!,
      fileName: "analysis.log",
      stage: "rootcause" as const,
      failureReason: "Log analysis failed before a report was generated."
    };
    const completedLog = initialState.logs.find((log) => log.status === "Complete")!;
    window.history.replaceState(null, "", "/logs");
    render(<LogsPage search="" state={{ ...userState, logs: [failedLog, completedLog] }} dispatch={() => undefined} onNavigate={() => undefined} />);

    const summary = screen.getByRole("alert");
    expect(summary).toHaveTextContent("在 根因推断 阶段失败");
    expect(summary).toHaveTextContent("分析未完成，未生成报告，请重试或重新上传。");
    expect(summary).not.toHaveTextContent(".log / .txt / .csv / .json");
    expect(summary).not.toHaveTextContent("Log analysis failed");
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /analysis\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(history).getByRole("button", { name: /usb_pd_negotiation/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("格式失败的原因只提到一种格式时仍列出全部支持格式", () => {
    const failedLog = {
      ...initialState.logs.find((log) => log.status === "Failed")!,
      failureReason: "请导出 .log 文本日志。"
    };
    render(<LogsPage search="" state={{ ...userState, logs: [failedLog] }} dispatch={() => undefined} onNavigate={() => undefined} />);

    expect(screen.getByRole("alert")).toHaveTextContent(".log / .txt / .csv / .json");
  });

  it("报告默认显示，切换元数据后历史导航仍可选择日志", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const auxPanel = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(screen.getByRole("tab", { name: "报告", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "元数据" }));
    const metadataPanel = screen.getByRole("tabpanel", { name: "元数据" });
    const metadata = within(metadataPanel).getByRole("region", { name: "日志任务区" });
    expect(within(metadata).getByText(/charging_thermal_trace/)).toBeInTheDocument();
    expect(within(metadataPanel).getByText("ChargeLab_X01")).toBeInTheDocument();
    await userEvent.click(within(auxPanel).getByRole("button", { name: /usb_pd_negotiation/ }));
    expect(within(metadata).getByText(/usb_pd_negotiation/)).toBeInTheDocument();
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

  it("每份日志可通过弹窗反馈置信度和可能问题", async () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /反馈分析质量/ }));

    const dialog = screen.getByRole("dialog", { name: "反馈分析质量" });
    expect(within(dialog).getByText(/charging_thermal_trace/)).toBeInTheDocument();
    await selectControlOption(within(dialog).getByLabelText("置信度反馈"), "low");
    fireEvent.change(within(dialog).getByLabelText("可能存在的问题"), { target: { value: "证据链缺少温控阈值来源" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));

    expect(screen.queryByRole("dialog", { name: "反馈分析质量" })).not.toBeInTheDocument();
    expect(screen.getByText(/已记录 RPT-9092 的分析反馈/)).toBeInTheDocument();
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

describe("LogsPage · 分析来源与降级标注", () => {
  const completedTemplate = initialState.logs.find((log) => log.status === "Complete")!;

  it("规则回退结果显著标注降级来源与原因", () => {
    window.history.replaceState(null, "", "/logs");
    const degradedState = {
      ...userState,
      logs: [
        {
          ...completedTemplate,
          id: "log-degraded",
          reportId: "RPT-DEGRADED",
          fileName: "degraded_fallback.log",
          analysisSource: "rules-fallback" as const,
          degradedReason: "provider-unavailable" as const,
          logDomainName: "charging-power",
          skillRevision: { id: "revision-3", number: 3 }
        },
        ...userState.logs
      ]
    };

    render(<App initialAppState={degradedState} />);

    const provenance = screen.getByTestId("analysis-provenance");
    expect(within(provenance).getByRole("status")).toHaveTextContent("降级分析 · 规则回退");
    expect(provenance).toHaveTextContent(/AI 分析服务不可用/);
    expect(provenance).toHaveTextContent("技能 charging-power · v3");
    expect(screen.getByText("规则评分")).toBeInTheDocument();
    expect(screen.queryByText("AI置信度")).not.toBeInTheDocument();
  });

  it("Agent 结果显示来源徽标且不显示降级提示", () => {
    window.history.replaceState(null, "", "/logs");
    const agentState = {
      ...userState,
      logs: [
        {
          ...completedTemplate,
          id: "log-agent",
          reportId: "RPT-AGENT",
          fileName: "agent_analysis.log",
          analysisSource: "agent" as const
        },
        ...userState.logs
      ]
    };

    render(<App initialAppState={agentState} />);

    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("Agent 分析");
    expect(provenance).not.toHaveTextContent("降级分析");
    expect(screen.getByText("模型自估")).toBeInTheDocument();
    expect(screen.queryByText("AI置信度")).not.toBeInTheDocument();
  });

  it("没有来源标注的历史结果不渲染来源徽标", () => {
    window.history.replaceState(null, "", "/logs");
    const legacyState = {
      ...userState,
      logs: [
        { ...completedTemplate, id: "log-legacy", reportId: "RPT-LEGACY", fileName: "legacy.log",
          logDomainId: undefined, logDomainName: undefined, skillRevision: null },
        ...userState.logs
      ]
    };

    render(<App initialAppState={legacyState} />);

    expect(screen.queryByTestId("analysis-provenance")).not.toBeInTheDocument();
    expect(screen.getByText("AI置信度")).toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
    expect(screen.queryByText("规则评分")).not.toBeInTheDocument();
  });

  it("提前收敛的 Agent 结论显著标注降级而不冒充完整分析", () => {
    window.history.replaceState(null, "", "/logs");
    const earlyConvergedState = {
      ...userState,
      logs: [
        {
          ...completedTemplate,
          id: "log-early-converged",
          reportId: "RPT-EARLY",
          fileName: "early_converged.log",
          analysisSource: "agent" as const,
          degradedReason: "token-budget-exhausted" as const
        },
        ...userState.logs
      ]
    };

    render(<App initialAppState={earlyConvergedState} />);

    const provenance = screen.getByTestId("analysis-provenance");
    expect(within(provenance).getByRole("status")).toHaveTextContent("降级分析 · 提前收敛");
    expect(provenance).toHaveTextContent(/提前收敛为低置信结论/);
    expect(provenance).not.toHaveTextContent("降级分析 · 规则回退");
    expect(screen.getByText("模型自估")).toBeInTheDocument();
  });
});
