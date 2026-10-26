import { cleanup, render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogAdminPage } from "./LogAdminPage";
import { createPrototypeState } from "./mockData";
import { createTestLogRuntimeActions } from "./test/harness";
import type { LogRecord } from "./domain/logs/types";

beforeEach(() => window.history.replaceState(null, "", "/log-admin"));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

function log(overrides: Partial<LogRecord> = {}): LogRecord {
  return { ...createPrototypeState().logs[0], id: "complete", reportId: "RPT-1", fileName: "充电.log", source: "upload",
    status: "Complete", confidence: 85, analysisSource: "agent", updatedAtIso: new Date().toISOString(),
    logDomainId: "charging", logDomainName: "充电诊断", ...overrides };
}
function page(logs: LogRecord[], archivedLogIds: string[] = [], feedbackFailure = false) {
  const logActions = createTestLogRuntimeActions({ listFeedbackInsights: vi.fn().mockResolvedValue([
    { logDomainId: "charging", logDomainName: "充电诊断", analysisSource: "agent", promptVersion: null,
      totalCount: 2, helpfulCount: 1, helpfulRate: 0.5, lastFeedbackAt: new Date().toISOString() },
    { logDomainId: "charging", logDomainName: "充电诊断", analysisSource: "rules-fallback", promptVersion: null,
      totalCount: 2, helpfulCount: 2, helpfulRate: 1, lastFeedbackAt: new Date().toISOString() }
  ]) });
  if (feedbackFailure) vi.mocked(logActions.listFeedbackInsights).mockRejectedValueOnce(new Error("offline"));
  const onNavigate = vi.fn();
  const state = { ...createPrototypeState(), activeRoleId: "admin", logs, archivedLogIds };
  return { ...render(<LogAdminPage state={state} dispatch={vi.fn()} onNavigate={onNavigate} search="" logActions={logActions} />), logActions, onNavigate };
}

describe("log admin overview", () => {
  it("defaults overview to 7 days and records to all, including older logs", async () => {
    const old = log({ id: "old", fileName: "历史日志.log", updatedAtIso: "2020-01-01T00:00:00Z" });
    page([log(), old]);
    expect(screen.getByRole("button", { name: "7 日" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("overview-total")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("tab", { name: "日志分析记录" }));
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByRole("table", { name: "日志分析记录" })).getByText("历史日志.log")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "30 日" }));
    expect(screen.queryByText("历史日志.log")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "概览" }));
    expect(screen.getByRole("button", { name: "7 日" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "全部" }));
    expect(screen.getByTestId("overview-total")).toHaveTextContent("2");
  });

  it("distinguishes unavailable feedback from no feedback and retries on refresh", async () => {
    page([log()], [], true);
    expect(await screen.findByRole("alert")).toHaveTextContent("反馈数据暂不可用，请刷新重试。");
    const skills = screen.getByRole("table", { name: "技能分析量与有帮助率" });
    expect(within(skills).getByText("暂不可用")).toBeInTheDocument();
    expect(within(skills).queryByTitle("0 条反馈")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await within(skills).findByText("75%")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("defaults to overview first, keeps one metric summary and removes capacity and advice (D1, D3, D5)", () => {
    const { container } = page([log()]);
    expect(screen.getAllByRole("tab")[0]).toHaveAccessibleName("概览");
    expect(screen.getByRole("tab", { name: "概览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("overview-total")).toHaveLength(1);
    expect(screen.getAllByTestId("overview-confidence")).toHaveLength(1);
    expect(screen.getAllByTestId("overview-failed")).toHaveLength(1);
    expect(container.querySelectorAll(".overview-page__summary")).toHaveLength(1);
    for (const text of ["吞吐峰值", "大文件压力", "容量排行", "建议动作", "继续监控上传格式", "保留失败原件以便复查"]) expect(screen.queryByText(text)).not.toBeInTheDocument();
    expect(screen.getByText("处理队列稳定")).toBeInTheDocument();
  });

  it("uses file names, report-number fallback, readable sources and adaptive sizes (D2, D4)", () => {
    page([log({ status: "Failed", fileSizeMB: 20 / 1024, failureReason: "文件编码无法识别" }),
      log({ id: "unnamed", fileName: "  ", reportId: "RPT-FALLBACK", status: "Failed", source: "api", fileSizeMB: 1 }),
      log({ id: "review", fileName: "复核.log", confidence: 70 }),
      log({ id: "review-fallback", fileName: "", reportId: "RPT-REVIEW", confidence: 80 })]);
    const overview = screen.getByTestId("log-admin-overview");
    expect(within(overview).getByText("充电.log")).toBeInTheDocument();
    expect(within(overview).getByText("RPT-FALLBACK")).toBeInTheDocument();
    expect(within(overview).getByText(/手动上传 · 20.0 KB/)).toBeInTheDocument();
    expect(within(overview).getByText(/接口接入 · 1.0 MB/)).toBeInTheDocument();
    const review = screen.getByRole("region", { name: "置信度复核队列" });
    expect(review).toHaveTextContent("复核.log · 手动上传 · 70%");
    expect(review).toHaveTextContent("RPT-REVIEW · 手动上传 · 80%");
    expect(overview).not.toHaveTextContent("0.0MB");
    expect(overview).not.toHaveTextContent("upload");
  });

  it("groups only failure reasons with counts and filters the matching records (D3, D6)", async () => {
    page([log({ suggestedActions: ["降低温度"] }), log({ id: "f1", status: "Failed", fileName: "失败一.log", failureReason: "编码不支持" }),
      log({ id: "f2", status: "Failed", fileName: "失败二.log", failureReason: "编码不支持" }),
      log({ id: "f3", status: "Failed", fileName: "失败三.log", failureReason: "包已损坏" })]);
    const card = screen.getByRole("article", { name: "失败原因" });
    expect(within(card).getByText("2 份")).toBeInTheDocument();
    expect(within(card).getByText("1 份")).toBeInTheDocument();
    expect(within(card).queryByText("降低温度")).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "编码不支持" }));
    const table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByText("失败一.log")).toBeInTheDocument();
    expect(within(table).getByText("失败二.log")).toBeInTheDocument();
    expect(within(table).queryByText("失败三.log")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(within(table).getByText("失败三.log")).toBeInTheDocument();
  });

  it("maps backend failure messages to Chinese reasons and groups unknown failures without exposing codes", async () => {
    page([log({ status: "Failed", failureReason: "Unsupported log format: binary" }),
      log({ id: "unknown", status: "Failed", fileName: "未知.log", failureReason: "PROVIDER_ERROR_INTERNAL" })]);
    const card = screen.getByRole("article", { name: "失败原因" });
    expect(card).not.toHaveTextContent("PROVIDER_ERROR_INTERNAL");
    expect(card).not.toHaveTextContent("Unsupported log format");
    await userEvent.click(within(card).getByRole("button", { name: "未记录可识别的失败原因" }));
    const records = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(records).getByText("未知.log")).toBeInTheDocument();
    expect(within(records).getAllByRole("row")).toHaveLength(2);
  });

  it("shows a dash when today is selected and yesterday has no baseline (D4)", async () => {
    page([log()]);
    await userEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getAllByText("较昨日 —")).toHaveLength(2);
    expect(screen.queryByText("较昨日 +0%")).not.toBeInTheDocument();
  });

  it("shows real day deltas when today is selected and a baseline exists (D4)", async () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    page([log({ confidence: 90 }), log({ id: "second", confidence: 90 }), log({ id: "baseline", confidence: 80, updatedAtIso: yesterday.toISOString() })]);
    await userEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByText("较昨日 +100%")).toBeInTheDocument();
    expect(screen.getByText("较昨日 +10 点")).toBeInTheDocument();
  });

  it("shows the four operator signals, aggregates weighted skill feedback and warns about high degradation (D6)", async () => {
    page([log({ analysisSource: "rules-fallback", degradedReason: "provider-unavailable" }),
      log({ id: "generic", logDomainId: undefined, logDomainName: undefined, analysisSource: "rules-fallback" })]);
    expect(screen.getByRole("alert")).toHaveTextContent("至少一半");
    expect(within(screen.getByRole("article", { name: "降级到规则" })).getByText("100%")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "通用分析占比" })).getByText("50%")).toBeInTheDocument();
    const skills = screen.getByRole("table", { name: "技能分析量与有帮助率" });
    expect(await within(skills).findByText("75%")).toBeInTheDocument();
    expect(within(skills).getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "失败原因" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "查看通用分析记录" }));
    const records = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(records).getAllByRole("row")).toHaveLength(2);
    expect(within(records).getByText("通用分析")).toBeInTheDocument();
  });

  it("filters degraded records and skills without including unfinished analyses (D6)", async () => {
    page([log({ analysisSource: "rules-fallback", fileName: "降级.log" }),
      log({ id: "processing", status: "Processing", analysisSource: "rules-fallback", fileName: "处理中.log" }),
      log({ id: "agent", analysisSource: "agent", logDomainId: "other", logDomainName: "其他技能", fileName: "其他.log" })]);
    await userEvent.click(screen.getByRole("button", { name: "查看降级记录" }));
    let table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByText("降级.log")).toBeInTheDocument();
    expect(within(table).queryByText("处理中.log")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "概览" }));
    await userEvent.click(within(screen.getByRole("table", { name: "技能分析量与有帮助率" })).getByRole("button", { name: "其他技能" }));
    table = screen.getByRole("table", { name: "日志分析记录" });
    expect(within(table).getByText("其他.log")).toBeInTheDocument();
    expect(within(table).queryByText("降级.log")).not.toBeInTheDocument();
  });

  it("keeps low degradation quiet and does not infer degradation from legacy source omissions (D6)", () => {
    page([log({ analysisSource: "rules-fallback" }), log({ id: "agent" }), log({ id: "legacy", analysisSource: undefined })]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: "降级到规则" })).getByText("33%")).toBeInTheDocument();
  });

  it("keeps the degraded helper to the count line when no analyses have completed", () => {
    page([log({ status: "Processing" })]);
    const card = screen.getByRole("article", { name: "降级到规则" });
    expect(within(card).getByText("0 / 0 份已完成分析", { exact: true })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("历史记录未标注来源");
  });

  it("shares overview's window with quality, keeps records independent and refreshes both data sources (D7)", async () => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const { logActions } = page([log(), log({ id: "old", fileName: "昨天.log", updatedAtIso: yesterday.toISOString() })]);
    await userEvent.click(screen.getByRole("button", { name: "今日" }));
    expect(screen.getByTestId("overview-total")).toHaveTextContent("1");
    await userEvent.click(screen.getByRole("button", { name: "7 日" }));
    expect(screen.getByTestId("overview-total")).toHaveTextContent("2");
    expect(screen.queryByText(/较昨日/)).not.toBeInTheDocument();
    await waitFor(() => expect(logActions.listFeedbackInsights).toHaveBeenCalledWith({ timeWindow: "7d" }));
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(logActions.refresh).toHaveBeenCalledWith({ includeArchived: true });
    await userEvent.click(screen.getByRole("tab", { name: "日志分析记录" }));
    expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table", { name: "日志分析记录" })).toHaveTextContent("昨天.log");
    await userEvent.click(screen.getByRole("tab", { name: "分析质量" }));
    expect(screen.getByRole("button", { name: "7 日" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each(["none", "archived", "historical"])("renders one whole-tab empty state for %s data (D8)", (kind) => {
    const old = new Date(); old.setDate(old.getDate() - 40);
    const { container, onNavigate } = page(kind === "none" ? [] : [log({ updatedAtIso: kind === "historical" ? old.toISOString() : new Date().toISOString() })], kind === "archived" ? ["complete"] : []);
    const overview = screen.getByTestId("log-admin-overview");
    const empty = within(overview).getByTestId("log-admin-overview-empty");
    expect(overview.querySelectorAll(".section-empty")).toHaveLength(1);
    expect(empty.querySelector(".section-empty")).toHaveTextContent("当前时间窗口内暂无日志");
    expect(empty.querySelectorAll("p")).toHaveLength(1);
    expect(within(empty).queryByRole("button")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".overview-tile")).toHaveLength(0);
    expect(within(overview).queryByRole("article")).not.toBeInTheDocument();
    expect(within(overview).queryByText("处理队列稳定")).not.toBeInTheDocument();
    expect(within(overview).getAllByRole("button", { name: "前往智能分析" })).toHaveLength(1);
    const primary = within(overview).getByRole("button", { name: "前往智能分析" });
    primary.click();
    expect(onNavigate).toHaveBeenCalledWith("/logs");
  });

  it("does not infer completed quality from failed or processing records and excludes archived records", () => {
    page([log({ status: "Processing", confidence: 85 }), log({ id: "failed", status: "Failed", confidence: 0 }),
      log({ id: "archived", fileName: "归档.log", confidence: 99 })], ["archived"]);
    expect(screen.getByTestId("overview-total")).toHaveTextContent("2");
    expect(screen.getByTestId("overview-confidence")).toHaveTextContent("—");
    expect(screen.getByRole("region", { name: "置信度复核队列" })).not.toHaveTextContent("85%");
    expect(screen.queryByText("归档.log")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports stalled processing rather than stable queues", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 20, 12));
    page([log({ status: "Processing", updatedAtIso: new Date(Date.now() - 11 * 60_000).toISOString() })]);
    expect(screen.getByText("1 条分析超过 10 分钟未完成。")).toBeInTheDocument();
    expect(screen.queryByText("处理队列稳定")).not.toBeInTheDocument();
  });
});
