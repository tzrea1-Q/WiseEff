import { selectControlOption } from "@/test/selectControlOption";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useReducer, useState } from "react";
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
import { createApiClient } from "@/infrastructure/http/apiClient";
import { createHttpLogAnalysisRepository } from "@/infrastructure/http/logClient";
import { createTestAppPorts, createTestLogAnalysisRepository, renderApp } from "@/test/harness";
import { reducer } from "@/application/state/appState";

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
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · Header", () => {
  it("resumes a hydrated processing report without an upload and stops refreshing after completion", async () => {
    vi.useFakeTimers();
    const processing = { ...initialState.logs[0], status: "Processing" as const };
    const complete = { ...processing, status: "Complete" as const, conclusion: "Thermal foldback reduced charging output." };
    const repository = createTestLogAnalysisRepository([processing], {
      getLog: vi.fn().mockResolvedValueOnce(processing).mockResolvedValue(complete)
    });
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: repository } });
    function RestoredLogs() {
      const [state, dispatch] = useReducer(reducer, { ...userState, logs: [processing] });
      return <LogsPage search="" state={state} dispatch={dispatch} runtime={runtime} onNavigate={() => undefined} />;
    }
    render(<RestoredLogs />);
    expect(screen.getByRole("heading", { name: "AI 正在分析..." })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(screen.getByRole("heading", { name: complete.conclusion })).toBeInTheDocument();
    expect(repository.uploadLog).not.toHaveBeenCalled();
    expect(repository.rerunLog).not.toHaveBeenCalled();
    const completedCalls = vi.mocked(repository.getLog).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(repository.getLog).toHaveBeenCalledTimes(completedCalls);
  });

  it.each(["selection", "unmount"])("cancels a processing refresh on %s", async (cancel) => {
    vi.useFakeTimers();
    const processing = { ...initialState.logs[0], status: "Processing" as const };
    let resolve!: (record: (typeof initialState.logs)[number]) => void;
    const repository = createTestLogAnalysisRepository([processing], {
      getLog: vi.fn().mockReturnValue(new Promise<(typeof initialState.logs)[number]>((complete) => { resolve = complete; }))
    });
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: repository } });
    const dispatch = vi.fn();
    const view = render(<LogsPage search="" state={{ ...userState, logs: [processing] }} dispatch={dispatch} runtime={runtime} onNavigate={() => undefined} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(repository.getLog).toHaveBeenCalledWith(processing.id);
    if (cancel === "selection") view.rerender(<LogsPage search="" state={{ ...userState, logs: [] }} dispatch={dispatch} runtime={runtime} onNavigate={() => undefined} />);
    else view.unmount();
    await act(async () => {
      resolve({ ...processing, status: "Complete" });
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(repository.getLog).toHaveBeenCalledTimes(1);
  });

  it("bounds processing recovery retries to five minutes", async () => {
    vi.useFakeTimers();
    const processing = { ...initialState.logs[0], status: "Processing" as const };
    const repository = createTestLogAnalysisRepository([processing]);
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: repository } });
    render(<LogsPage search="" state={{ ...userState, logs: [processing] }} dispatch={() => undefined} runtime={runtime} onNavigate={() => undefined} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    const exhaustedCalls = vi.mocked(repository.getLog).mock.calls.length;
    expect(exhaustedCalls).toBeGreaterThan(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(300_000); });
    expect(repository.getLog).toHaveBeenCalledTimes(exhaustedCalls);
  });

  it.each(["selection", "deep link"])("hydrates a completed kernel report from detail on %s and renders decoded evidence", async (entry) => {
    const evidence = [{
      decodedFields: [{ v: 1, file: "kernel.log", line: 1, fields: {
        ibus: { raw: "1450", value: 1450 }, temp: { raw: "71", value: 71 }, vbus: { raw: "9012", value: 9012 }
      }, source: "declarative", extractor: "thermal" }],
      id: "evidence-…-0", stageId: "rootcause", lineNumbers: [1, 3, 4],
      inference: "Thermal protection reduced charging output.", suggestedAction: "…", filePath: "kernel.log", ruleHit: "thermal-foldback"
    }];
    const summary = { id: "kernel-report", reportId: "RPT-KERNEL", fileName: "kernel.log", source: "upload", fileSizeBytes: 200,
      status: "complete", archiveState: "active", stage: "report", confidence: 0.9,
      conclusion: "Thermal protection reduced charging output.", impact: "Reduced current", evidence: [],
      suggestedActions: [], severity: "Warning", rawLines: [], submittedBy: "API User",
      capturedAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:01:00.000Z" };
    const other = { ...summary, id: "other-report", fileName: "other.log" };
    const fetchMock = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/v1/logs") return new Response(JSON.stringify({ items: [other, summary] }));
      if (path === "/api/v1/logs/kernel-report") return new Response(JSON.stringify({ item: { ...summary, evidence,
        signalSummary: { signals: [{ kind: "crash", severity: "Critical", source: "generic", title: "Hydrated signal", signature: "watchdog", count: 1,
          anchors: [{ file: "kernel.log", line: 1, content: "ibus=1450 temp=71 vbus=9012" }] }], templates: [], truncatedSignals: false, truncatedTemplates: false },
        rawLines: ["ibus=1450 temp=71 vbus=9012", "INFO waiting", "WARN thermal", "INFO reduced"] } }));
      if (path === "/api/v1/logs/other-report") return new Response(JSON.stringify({ item: other }));
      throw new Error(`Unexpected request: ${path}`);
    });
    const repository = createHttpLogAnalysisRepository({ baseUrl: "http://localhost",
      apiClient: createApiClient({ baseUrl: "http://localhost", fetchImpl: fetchMock }) });
    renderApp({ path: entry === "deep link" ? "/logs?logId=kernel-report" : "/logs", runtimeMode: "api",
      initialAppState: { ...userState, logs: [] }, ports: { logAnalysisRepository: repository } });
    const button = await screen.findByRole("button", { name: /kernel\.log/ });
    if (entry === "selection") await userEvent.click(button);
    const chain = screen.getByRole("region", { name: "日志分析证据链" });
    expect(await within(chain).findByText("kernel.log:1")).toBeInTheDocument();
    const fields = within(chain).getByRole("group", { name: "解码字段" });
    expect(fields).toHaveTextContent("ibus = 1450");
    expect(fields).toHaveTextContent("temp = 71");
    expect(fields).toHaveTextContent("vbus = 9012");
    expect(chain.querySelectorAll(".evidence-card")).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/logs/kernel-report"))).toBe(true);
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    expect(screen.getByText("崩溃特征：watchdog")).toBeInTheDocument();
  });

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
    const signals = within(tabs).getByRole("tab", { name: "信号" });
    await user.click(history);
    await user.keyboard("{ArrowRight}");
    expect(files).toHaveFocus();
    expect(history).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(signals).toHaveFocus();
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

  it("shows the selected source snapshot, requested version and unmatched-label fallback", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={{ ...userState, logs: [{ ...completedTemplate,
      sourceSnapshot: { id: "snapshot-default", versionLabel: "v2.4.0", status: "ready" as const },
      sourceSnapshotSelection: "default" as const, requestedSourceVersion: "firmware-unknown"
    }] }} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("源码：默认快照 v2.4.0 · 请求版本 firmware-unknown");
    expect(provenance).not.toHaveTextContent("snapshot-default");
    expect(provenance).not.toHaveTextContent("就绪");
    expect(within(provenance).getByTitle("snapshot-default")).toHaveTextContent("源码：默认快照 v2.4.0");
    expect(provenance).toHaveTextContent("未找到源码版本 firmware-unknown；已使用默认快照。");
  });

  it("shows a non-ready snapshot status alongside its version label", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={{ ...userState, logs: [{ ...completedTemplate,
      sourceSnapshot: { id: "snapshot-indexing", versionLabel: "v2.4.0", status: "indexing" as const },
      sourceSnapshotSelection: "matched_version" as const, requestedSourceVersion: "v2.4.0"
    }] }} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("源码：版本匹配 v2.4.0 · 索引中 · 请求版本 v2.4.0");
    expect(provenance).not.toHaveTextContent("snapshot-indexing");
    expect(within(provenance).getByTitle("snapshot-indexing")).toBeInTheDocument();
    expect(provenance).not.toHaveTextContent("未找到源码版本");
  });

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
          knowledgeRevisions: [{ entryId: "retrieved-entry", revisionId: "retrieved-revision" }],
          analysisSource: "agent" as const
        },
        ...userState.logs
      ]
    };

    render(<App initialAppState={agentState} />);

    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("Agent 分析");
    expect(provenance).toHaveTextContent("实际检索的知识修订（1）");
    expect(provenance).toHaveTextContent("条目 retrieved-entry · 修订 retrieved-revision");
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
