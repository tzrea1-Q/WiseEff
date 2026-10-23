import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useReducer } from "react";
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
import { createApiClient, WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createHttpLogAnalysisRepository } from "@/infrastructure/http/logClient";
import { createTestAppPorts, createTestLogAnalysisRepository, renderApp } from "@/test/harness";
import { reducer } from "@/application/state/appState";
import { selectControlOption } from "@/test/selectControlOption";
import { XIAOZE_OPEN_HANDOFF_EVENT } from "@/features/agent/xiaozeOpenHandoff";
import { createLogRuntimeActions } from "@/application/logs/logRuntime";

const userState = { ...initialState, activeRoleId: "user" };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
});

describe("LogsPage · Header", () => {
  it.each([true, false])("参数管理未开放时隐藏关联参数和修改请求入口（已关联：%s）", async (linked) => {
    const log = { ...initialState.logs[0], status: "Complete" as const, stage: "report" as const,
      relatedParameterId: linked ? "binding-1" : undefined, relatedParameterProjectId: linked ? "project-1" : undefined };
    const onNavigate = vi.fn();
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined}
      onNavigate={onNavigate} canOpenParameters={false} />);
    expect(screen.queryByRole("button", { name: "查看关联参数" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.queryByRole("menuitem", { name: "生成参数修改请求" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "导出报告" })).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("将标签页置于详情标题下，未知文件清单时不声称文件数", async () => {
    const log = { ...initialState.logs[1], files: undefined, fileSizeMB: 0 };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const task = screen.getByRole("region", { name: "日志任务区" });
    const tabs = within(task).getByRole("tablist", { name: "日志辅助信息" });
    const header = within(task).getByRole("region", { name: log.conclusion });
    expect(header.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(header).not.toHaveTextContent(/个文件/);
    expect(screen.getByRole("region", { name: "日志记录" })).not.toContainElement(tabs);
    await userEvent.click(within(tabs).getByRole("tab", { name: "文件" }));
    expect(within(screen.getByRole("tabpanel", { name: "文件" })).getByText("该历史记录暂无文件清单。")).toBeInTheDocument();
  });

  it("重新分析失败只显示一次服务端消息，且可再次重试", async () => {
    const log = initialState.logs[1];
    const state = { ...userState, logs: [log] };
    const dispatch = vi.fn();
    const repository = createTestLogAnalysisRepository([log], { rerunLog: vi.fn().mockRejectedValue(new Error("技能版本已失效，请重新选择。")) });
    const logActions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => state });
    render(<LogsPage search="" state={state} dispatch={dispatch} logActions={logActions} onNavigate={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重新分析" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("技能版本已失效，请重新选择。");
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "ADD_NOTIFICATION" }));
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "重新分析" })).toBeEnabled();
  });

  it("重新分析内部错误隐藏服务端内部文本，保留请求编号", async () => {
    const log = initialState.logs[1], state = { ...userState, logs: [log] };
    const dispatch = vi.fn();
    const repository = createTestLogAnalysisRepository([log], {
      rerunLog: vi.fn().mockRejectedValue(new WiseEffApiError("INTERNAL_ERROR", "无法读取 /srv/private/config.ts", {}, "request-u2"))
    });
    const logActions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => state });
    render(<LogsPage search="" state={state} dispatch={dispatch} logActions={logActions} onNavigate={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "重新分析" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("服务暂时不可用，请稍后重试。（请求编号 request-u2）");
    expect(alert).not.toHaveTextContent("/srv/private");
  });

  it("删除本人失败日志先确认，取消不删除，成功后移出历史列表", async () => {
    const log = { ...initialState.logs[1], status: "Failed" as const, canDelete: true };
    const purgeLog = vi.fn().mockResolvedValue({ logId: log.id, version: "a".repeat(64), database: "deleted", objects: "complete", pendingObjects: 0 });
    const repository = createTestLogAnalysisRepository([log], {
      previewLogDeletion: vi.fn().mockResolvedValue({ organizationId: "org", logId: log.id, fileName: log.fileName,
        version: "a".repeat(64), generatedAt: "2026-10-22T10:00:00Z", inventory: [], objects: { total: 0, shared: 0, exclusive: 0 }, conditions: [], notes: [] }), purgeLog
    });
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: repository } });
    function OwnedLog() {
      const [state, dispatch] = useReducer(reducer, { ...userState, logs: [log] });
      return <LogsPage search="" state={state} dispatch={dispatch} runtime={runtime} onNavigate={() => undefined} />;
    }
    render(<OwnedLog />);
    await userEvent.click(screen.getByRole("button", { name: "删除日志" }));
    await screen.findByText(`${log.fileName} · ${log.id}`);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(purgeLog).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "删除日志" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    await screen.findByText("日志数据库数据已永久删除。");
    expect(purgeLog).toHaveBeenCalledWith(log.id, "a".repeat(64));
    expect(screen.queryByRole("button", { name: /usb_pd_negotiation/ })).not.toBeInTheDocument();
    expect(screen.getByText("还没有日志")).toBeInTheDocument();
  });

  it("存储清理失败后关闭并重载页面，仍可继续清理且不再预览已删除日志", async () => {
    const log = { ...initialState.logs[1], status: "Failed" as const, canDelete: true };
    const receipt = { logId: log.id, version: "a".repeat(64), database: "deleted" as const, objects: "pending" as const, pendingObjects: 1 };
    let pending = false;
    const pendingLogDeletions = vi.fn(async () => pending ? [receipt] : []);
    const purgeLog = vi.fn().mockImplementationOnce(async () => { pending = true; return receipt; })
      .mockImplementationOnce(async () => { pending = false; return { ...receipt, objects: "complete", pendingObjects: 0 }; });
    const previewLogDeletion = vi.fn().mockResolvedValue({ organizationId: "org", logId: log.id, fileName: log.fileName,
      version: receipt.version, generatedAt: "2026-10-22T10:00:00Z", inventory: [], objects: { total: 1, shared: 0, exclusive: 1 }, conditions: [], notes: [] });
    const repository = createTestLogAnalysisRepository([log], { previewLogDeletion, purgeLog, pendingLogDeletions });
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: repository } });
    function OwnedLog({ empty = false }: { empty?: boolean }) {
      const [state, dispatch] = useReducer(reducer, { ...userState, logs: empty ? [] : [log] });
      return <LogsPage search="" state={state} dispatch={dispatch} runtime={runtime} onNavigate={() => undefined} />;
    }
    const first = render(<OwnedLog />);
    await userEvent.click(screen.getByRole("button", { name: "删除日志" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "彻底删除" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "彻底删除" }));
    await screen.findByText("日志数据库数据已永久删除。");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }));
    expect(screen.getByRole("region", { name: "存储清理未完成" })).toHaveTextContent(log.id);
    first.unmount();
    const requestsBeforeReload = pendingLogDeletions.mock.calls.length;
    render(<OwnedLog empty />);
    const notice = await screen.findByRole("region", { name: "存储清理未完成" });
    expect(pendingLogDeletions.mock.calls.length).toBeGreaterThan(requestsBeforeReload);
    await userEvent.click(within(notice).getByRole("button", { name: "重试清理" }));
    expect(previewLogDeletion).toHaveBeenCalledTimes(1);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "重试存储清理" }));
    await screen.findByText("存储清理完成。");
    expect(purgeLog).toHaveBeenCalledTimes(2);
    expect(purgeLog).toHaveBeenLastCalledWith(log.id, receipt.version);
    expect(screen.queryByRole("region", { name: "存储清理未完成" })).not.toBeInTheDocument();
  });

  it.each([undefined, "deleted-skill"])("已删除技能的名称和版本快照以纯文本显示（残留 ID：%s）", (logDomainId) => {
    const log = { ...initialState.logs[1], logDomainId, logDomainName: undefined, skillRevision: null,
      skillNameSnapshot: "历史设备诊断", skillRevisionNumberSnapshot: 3,
      skillSelection: { mode: "explicit" as const, reasons: [] } };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined}
      sessionPermissions={["logs:admin-domains"]} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("技能：历史设备诊断 v3");
    expect(within(provenance).queryByRole("link")).not.toBeInTheDocument();
  });
  it("历史记录按上传时间倒序，搜索与状态筛选仅过滤列表", async () => {
    const logs = [
      { ...initialState.logs[0], id: "old", fileName: "旧记录.log", capturedAt: "2026-10-17T10:00:00Z", status: "Complete" as const },
      { ...initialState.logs[0], id: "new", fileName: "新记录.log", capturedAt: "2026-10-19T10:00:00Z", status: "Processing" as const },
      { ...initialState.logs[0], id: "failed", fileName: "失败.log", capturedAt: "2026-10-18T10:00:00Z", status: "Failed" as const }
    ];
    render(<LogsPage search="" state={{ ...userState, logs }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    const items = history.querySelectorAll(".history-item");
    expect([...items].map((item) => item.querySelector("strong")?.textContent)).toEqual(["新记录.log", "失败.log", "旧记录.log"]);
    expect(items[0]).not.toHaveTextContent("%");
    expect(items[0].querySelector("time")?.textContent).toMatch(/^2026\/10\/19 \d{2}:\d{2}$/);
    fireEvent.change(within(history).getByRole("searchbox", { name: "搜索日志记录" }), { target: { value: "记录" } });
    expect(history.querySelectorAll(".history-item")).toHaveLength(2);
    await selectControlOption(within(history).getByRole("combobox", { name: "日志状态" }), "Processing");
    expect(history.querySelectorAll(".history-item")).toHaveLength(1);
    expect(within(history).getByRole("button", { name: /新记录/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: logs[0].conclusion })).toBeInTheDocument();
    fireEvent.change(within(history).getByRole("searchbox", { name: "搜索日志记录" }), { target: { value: "不存在" } });
    expect(within(history).getByText("没有匹配的日志记录")).toBeInTheDocument();
  });

  it.each([true, false])("技能版本及选择方式在页头显示，管理员链接权限为 %s", (admin) => {
    const log = { ...initialState.logs[1], logDomainId: "skill-1", logDomainName: "设备诊断", skillRevision: { id: "revision", number: 3 },
      skillSelection: { mode: "recommended" as const, reasons: [] }, capturedAt: "2026-10-19T10:00:00Z", fileSizeMB: 0,
      files: [{ path: "device.log", sizeBytes: 20 * 1024, lineCount: 1, encoding: "utf-8" as const, lossy: false, status: "analyzed" as const, skipReason: null }] };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined}
      sessionPermissions={admin ? ["logs:admin-domains"] : ["logs:view"]} />);
    const header = screen.getByRole("region", { name: log.conclusion });
    expect(header).toHaveTextContent("技能：设备诊断 v3");
    expect(header).toHaveTextContent("自动推荐");
    expect(header).toHaveTextContent("1 个文件 / 20.0 KB");
    expect(header).toHaveTextContent(/2026\/10\/19 \d{2}:\d{2}/);
    if (admin) expect(within(header).getByRole("link", { name: "技能：设备诊断 v3" })).toHaveAttribute("href", "/log-admin/skills/skill-1");
    else expect(within(header).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("tablist").textContent).toBe(admin ? "报告信号文件分析轨迹" : "报告信号文件");
  });

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
    expect(screen.getByRole("heading", { name: "正在分析…" })).toBeInTheDocument();
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
      { path: "device/a.log", sizeBytes: 1024, lineCount: 12, encoding: "utf-8" as const, lossy: true, status: "analyzed" as const, skipReason: null, role: "主日志", skillMatched: true },
      { path: "misc/notes.txt", sizeBytes: 16, lineCount: 1, encoding: "utf-8" as const, lossy: false, status: "analyzed" as const, skipReason: null, role: null, skillMatched: false },
      { path: "image.bin", sizeBytes: 256, lineCount: 0, encoding: "utf-8" as const, lossy: false, status: "skipped" as const, skipReason: "二进制文件" }
    ] };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "文件" }));
    const inventory = screen.getByRole("region", { name: "日志文件清单" });
    expect(inventory).toHaveTextContent("device/a.log"); expect(inventory).toHaveTextContent("1.0 KB");
    expect(inventory).toHaveTextContent("12"); expect(inventory).toHaveTextContent("有损解码");
    expect(inventory).toHaveTextContent("已分析"); expect(inventory).toHaveTextContent("已跳过 · 二进制文件");
    expect(within(inventory).getByRole("columnheader", { name: "角色" })).toBeInTheDocument();
    expect(within(inventory).getByText("主日志")).toBeInTheDocument();
    expect(within(inventory).getByText("misc/notes.txt").closest("tr")).toHaveTextContent("仅通用分析");
  });
  it("shows file:line evidence without borrowing text from a different file", () => {
    const log = { ...initialState.logs[0], status: "Complete" as const, evidence: [{ ...initialState.logs[0].evidence[0], filePath: "device/b.log", lineNumbers: [2] }] };
    render(<LogsPage search="" state={{ ...userState, logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    expect(document.querySelector(".evidence-card__body code")).toHaveTextContent("device/b.log:2");
  });
  it("keeps upload available without presenting an empty installation as a failed analysis", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const task = screen.getByRole("region", { name: "日志任务区" });
    expect(within(task).getByText("还没有日志")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(within(task).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传日志" })).toBeEnabled();
  });

  it.each(["Complete", "Processing", "Failed"] as const)("keeps %s records in the navigator and their report in the task area", async (status) => {
    const log = initialState.logs.find((record) => record.status === status)!;
    window.history.replaceState(null, "", `/logs?logId=${log.id}`);
    render(<LogsPage search="" state={userState} dispatch={() => undefined} onNavigate={() => undefined} />);
    const navigator = screen.getByRole("region", { name: "日志记录" });
    const task = screen.getByRole("region", { name: "日志任务区" });
    expect(within(navigator).getByRole("button", { name: new RegExp(log.fileName) })).toHaveAttribute("aria-pressed", "true");
    expect(within(task).getByRole(status === "Failed" ? "alert" : "heading", { ...(status === "Failed" ? {} : { name: status === "Processing" ? "正在分析…" : log.conclusion }) })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传新日志" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "收起日志记录" }));
    expect(within(task).getByRole(status === "Failed" ? "alert" : "heading", { ...(status === "Failed" ? {} : { name: status === "Processing" ? "正在分析…" : log.conclusion }) })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("logId")).toBe(log.id);
    await userEvent.click(screen.getByRole("button", { name: "展开日志记录" }));
  });

  it("moves focus between auxiliary tabs before activation without changing the selected log", async () => {
    const user = userEvent.setup();
    const log = initialState.logs[1];
    window.history.replaceState(null, "", `/logs?logId=${log.id}`);
    render(<LogsPage search="" state={userState} dispatch={() => undefined} onNavigate={() => undefined} />);
    const tabs = screen.getByRole("tablist", { name: "日志辅助信息" });
    const history = within(tabs).getByRole("tab", { name: "报告" });
    const files = within(tabs).getByRole("tab", { name: "文件" });
    const signals = within(tabs).getByRole("tab", { name: "信号" });
    expect(within(tabs).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["报告", "信号", "文件"]);
    await user.click(history);
    await user.keyboard("{ArrowRight}");
    expect(signals).toHaveFocus();
    expect(history).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(files).toHaveFocus();
    await user.keyboard("{Enter}");
    const panel = screen.getByRole("tabpanel", { name: "文件" });
    expect(files).toHaveAttribute("aria-controls", panel.id);
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

    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "分析置信度" })).toHaveAttribute("aria-valuenow", "88");
    expect(screen.queryByRole("button", { name: "查看关联参数" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    expect(screen.getByRole("menuitem", { name: "生成参数修改请求" })).toBeEnabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "分析流程" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "原始日志" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "日志分析证据链" })).toBeInTheDocument();
  });

  it("Processing 日志主按钮禁用", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    expect(screen.queryByRole("button", { name: "更多" })).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "分析反馈" })).not.toBeInTheDocument();
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
    expect(summary).toHaveTextContent("在日志解析阶段失败");
    expect(summary).not.toHaveTextContent("支持格式：");
    expect(within(summary).getByText(failedLog.fileName)).toBeInTheDocument();
    expect(summary).not.toHaveTextContent(/个文件/);
    expect(summary).toHaveTextContent(failedLog.capturedAt);
    expect(summary).toHaveTextContent(failedLog.submittedBy);
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
    expect(screen.queryByRole("region", { name: "分析结果" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "原始日志" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "日志分析证据链" })).not.toBeInTheDocument();
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
    expect(summary).toHaveTextContent("日志处理失败");
    expect(summary).toHaveTextContent("分析未完成，未生成报告，请重试或重新上传。");
    expect(summary).toHaveTextContent("在根因推断阶段失败");
    expect(summary).not.toHaveTextContent("支持格式：");
    expect(summary).not.toHaveTextContent("Log analysis failed");
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(within(history).getByRole("button", { name: /analysis\.log/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(history).getByRole("button", { name: /usb_pd_negotiation/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("保留服务端完整格式说明，不追加重复格式列表", () => {
    const reason = "格式不支持，请上传 .log / .txt / .csv / .json 文本日志或 .zip / .tar / .tar.gz / .tgz / .gz 压缩包。";
    const failedLog = {
      ...initialState.logs.find((log) => log.status === "Failed")!,
      failureReason: reason
    };
    render(<LogsPage search="" state={{ ...userState, logs: [failedLog] }} dispatch={() => undefined} onNavigate={() => undefined} />);

    const alert = screen.getByRole("alert");
    expect(within(alert).getAllByText(reason)).toHaveLength(1);
    expect(alert).toHaveTextContent(`在日志解析阶段失败 · ${reason}`);
    expect(alert).not.toHaveTextContent("支持格式：");
  });

  it("报告默认显示，切换文件后历史导航仍可选择日志", async () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);
    const history = screen.getByRole("complementary", { name: "历史日志记录" });
    expect(screen.getByRole("tab", { name: "报告", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "文件" }));
    await userEvent.click(within(history).getByRole("button", { name: /usb_pd_negotiation/ }));
    expect(screen.getByRole("tab", { name: "文件", selected: true })).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("logId")).toBe("log-auth");
  });

  it("更多菜单中的问小泽直接调用小泽打开入口，无需 DOM 按钮", async () => {
    window.history.replaceState(null, "", "/logs");

    const opened = vi.fn();
    window.addEventListener(XIAOZE_OPEN_HANDOFF_EVENT, opened, { once: true });
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: /usb_pd_negotiation/ }));
    await userEvent.click(screen.getByRole("button", { name: "更多" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "问小泽" }));
    expect(opened).toHaveBeenCalledOnce();
    expect(document.querySelector(".agent-panel")).not.toBeInTheDocument();
    expect(screen.queryByText("WiseAgent")).not.toBeInTheDocument();
  });

  it("Processing 结论卡不再展示文件名、阶段、时间和设备胶囊标签", () => {
    window.history.replaceState(null, "", "/logs");

    render(<App initialAppState={userState} />);

    const conclusionCard = screen.getByRole("region", { name: "正在分析…" });
    expect(conclusionCard).not.toHaveTextContent("charging_thermal_trace_20260504.log");
    expect(conclusionCard).not.toHaveTextContent("根因推断");
    expect(conclusionCard).toHaveTextContent("10:24:05");
    expect(conclusionCard).not.toHaveTextContent("ChargeLab_X01");
  });

  it("二元反馈可立即提交有帮助，再改为带可选说明的没帮助", async () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);
    fireEvent.click(screen.getByRole("button", { name: /usb_pd_negotiation/ }));
    fireEvent.click(screen.getByRole("button", { name: "有帮助" }));
    expect(await screen.findByText("已反馈：有帮助")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "没帮助" }));
    const dialog = screen.getByRole("dialog", { name: "没帮助" });
    fireEvent.change(within(dialog).getByLabelText("补充说明（可选）"), { target: { value: "证据链缺少温控阈值来源" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交反馈" }));
    expect(await screen.findByText("已反馈：没帮助")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  it("没有使用源码快照时隐藏源码芯片", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [{ ...completedTemplate,
      sourceSnapshotSelection: "none", sourceSnapshot: undefined
    }] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).not.toHaveTextContent("源码");
    expect(provenance).toHaveTextContent("AI 分析");
  });

  it("shows the selected source snapshot, requested version and unmatched-label fallback", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={{ ...userState, logs: [{ ...completedTemplate,
      sourceSnapshot: { id: "snapshot-default", versionLabel: "v2.4.0", status: "ready" as const },
      sourceSnapshotSelection: "default" as const, requestedSourceVersion: "firmware-unknown"
    }] }} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("源码 v2.4.0");
    expect(provenance).not.toHaveTextContent("snapshot-default");
    expect(provenance).not.toHaveTextContent("就绪");
    expect(provenance).toHaveTextContent("未找到源码版本 firmware-unknown；已使用默认快照。");
  });

  it("shows a non-ready snapshot status alongside its version label", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={{ ...userState, logs: [{ ...completedTemplate,
      sourceSnapshot: { id: "snapshot-indexing", versionLabel: "v2.4.0", status: "indexing" as const },
      sourceSnapshotSelection: "matched_version" as const, requestedSourceVersion: "v2.4.0"
    }] }} />);
    const provenance = screen.getByTestId("analysis-provenance");
    expect(provenance).toHaveTextContent("源码 v2.4.0");
    expect(provenance).not.toHaveTextContent("索引中");
    expect(provenance).not.toHaveTextContent("snapshot-indexing");
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
    expect(provenance).toHaveTextContent("规则回退");
    expect(provenance).toHaveTextContent(/AI 分析服务不可用/);
    expect(provenance).toHaveTextContent("技能：charging-power v3");
    expect(screen.getByText("置信度")).toBeInTheDocument();
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
    expect(provenance).toHaveTextContent("AI 分析");
    expect(provenance).not.toHaveTextContent("retrieved-entry");
    expect(provenance).not.toHaveTextContent("retrieved-revision");
    expect(provenance).not.toHaveTextContent("降级分析");
    expect(screen.getByText("置信度")).toBeInTheDocument();
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

    expect(screen.getByTestId("analysis-provenance")).toHaveTextContent("通用分析");
    expect(screen.getByText("置信度")).toBeInTheDocument();
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
    expect(provenance).toHaveTextContent("提前收敛");
    expect(provenance).toHaveTextContent(/提前收敛为低置信结论/);
    expect(provenance).not.toHaveTextContent("降级分析 · 规则回退");
    expect(screen.getByText("置信度")).toBeInTheDocument();
  });
});
