import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { initialState } from "@/mockData";
import { createTestAppPorts } from "@/test/harness/createTestAppPorts";
import { createTestLogAnalysisRepository } from "@/test/harness/createTestLogAnalysisRepository";
import type { AnalysisTraceStep } from "@/features/log-skills/types";
import { LogsPage } from "./LogsPage";
import { AnalysisTrace } from "./AnalysisTrace";

const step: AnalysisTraceStep = { index: 1, kind: "tool-call", tool: "read_lines", arguments: { file: "sample.log", startLine: 2 },
  resultBytes: 2048, lines: [{ file: "sample.log", line: 2 }], outcome: "truncated", reason: "line-cap", inputTokens: 14, outputTokens: 7 };

function setup(permissions: string[]) {
  const log = { ...initialState.logs[0], status: "Complete" as const };
  const getLogTrace = vi.fn(async () => [step]);
  const getLogLines = vi.fn(async () => ({ file: "sample.log", startLine: 1, endLine: 2, totalLines: 2,
    lines: [{ lineNumber: 1, content: "first" }, { lineNumber: 2, content: "cited evidence" }] }));
  const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: { ...createTestLogAnalysisRepository([log]), getLogTrace, getLogLines } } });
  const props = { state: { ...initialState, activeRoleId: "admin", logs: [log] }, search: "", runtime,
    dispatch: vi.fn(), onNavigate: vi.fn() };
  const rendered = render(<LogsPage {...props} sessionPermissions={permissions} />);
  return { ...rendered, props, getLogTrace, getLogLines, log };
}

describe("analysis trace", () => {
  it("hides zero return sizes without removing outcomes or token counts or leaving an empty row", () => {
    render(<AnalysisTrace steps={[
      { ...step, arguments: {}, lines: [], reason: null, resultBytes: 0, inputTokens: undefined, outputTokens: undefined, outcome: "ok" },
      { ...step, index: 2, arguments: {}, lines: [], reason: null, resultBytes: 0, inputTokens: 0, outputTokens: 7, outcome: "error" }
    ]} />);
    const steps = within(screen.getByRole("list", { name: "分析轨迹步骤" })).getAllByRole("listitem");
    expect(within(steps[0]).getByText("成功")).toBeVisible();
    expect(steps[0].querySelector("p")).toBeNull();
    expect(within(steps[1]).getByText("错误")).toBeVisible();
    expect(within(steps[1]).getByText("输入 0 词元 · 输出 7 词元")).toBeVisible();
    expect(screen.queryByText(/返回大小/)).not.toBeInTheDocument();
  });

  it("summarizes tools, provider tokens and convergence above the steps", () => {
    render(<AnalysisTrace steps={[
      { ...step, inputTokens: 4000, outputTokens: 150 },
      { ...step, index: 2, inputTokens: 207, outputTokens: 30 },
      { ...step, index: 3, kind: "model-turn", inputTokens: undefined, outputTokens: undefined },
      { ...step, index: 4, kind: "early-convergence", inputTokens: undefined, outputTokens: undefined },
      { ...step, index: 5, kind: "rule-fallback", inputTokens: undefined, outputTokens: undefined }
    ]} />);
    expect(screen.getByLabelText("分析轨迹摘要")).toHaveTextContent("5 步 · 2 次工具调用 · 输入 4,207 / 输出 180 词元 · 已降级 · 提前收敛");
    expect(screen.queryByRole("button", { name: "sample.log:2" })).not.toBeInTheDocument();
  });

  it("distinguishes pinned source references from navigable log lines", () => {
    const onOpenLine = vi.fn();
    render(<AnalysisTrace steps={[{ ...step, lines: [{ file: "drivers/thermal.c", line: 9, snapshotId: "source-version" }] }]} onOpenLine={onOpenLine} />);
    expect(screen.getByText("源码 drivers/thermal.c:9")).toBeVisible();
    expect(screen.queryByRole("button", { name: /thermal\.c/ })).not.toBeInTheDocument();
    expect(onOpenLine).not.toHaveBeenCalled();
  });

  it("caps each log file at three locations and opens all cited lines from the remaining button", async () => {
    const onOpenLine = vi.fn();
    const lines = Array.from({ length: 200 }, (_, index) => index + 1);
    render(<AnalysisTrace steps={[{ ...step, lines: [
      ...lines.map((line) => ({ file: "sample.log", line })),
      ...[4, 5, 6, 7].map((line) => ({ file: "other.log", line }))
    ] }]} onOpenLine={onOpenLine} />);
    const sample = screen.getByRole("group", { name: "日志文件 sample.log 引用行" });
    expect(within(sample).getAllByRole("button")).toHaveLength(4);
    expect(within(sample).queryByRole("button", { name: "sample.log:4" })).not.toBeInTheDocument();
    const more = within(sample).getByRole("button", { name: "其余 197 行" });
    more.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpenLine).toHaveBeenCalledWith("sample.log", 1, lines);
    const other = screen.getByRole("group", { name: "日志文件 other.log 引用行" });
    await userEvent.click(within(other).getByRole("button", { name: "其余 1 行" }));
    expect(onOpenLine).toHaveBeenLastCalledWith("other.log", 4, [4, 5, 6, 7]);
  });

  it("keeps capped source locations separate from log files and expands without opening the log drawer", async () => {
    const onOpenLine = vi.fn();
    render(<AnalysisTrace steps={[{ ...step, lines: [
      { file: "same.log", line: 1 },
      ...[1, 2, 3, 4].map((line) => ({ file: "same.log", line, snapshotId: "source-version" }))
    ] }]} onOpenLine={onOpenLine} />);
    expect(screen.getByRole("group", { name: "日志文件 same.log 引用行" })).toBeVisible();
    const source = screen.getByRole("group", { name: "源码文件 same.log 引用行" });
    const details = source.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    await userEvent.click(within(source).getByText("其余 1 行"));
    expect(details).toHaveAttribute("open");
    expect(within(source).getByText("源码 same.log:4")).toBeVisible();
    expect(within(source).queryByRole("button")).not.toBeInTheDocument();
    expect(onOpenLine).not.toHaveBeenCalled();
  });

  it("translates provider and unknown errors, tools and argument labels", () => {
    render(<AnalysisTrace steps={[
      { ...step, outcome: "error", reason: "provider-error", arguments: { query: "[redacted]", isRegex: false } },
      { ...step, index: 2, tool: "constructor", reason: "provider-unavailable" },
      { ...step, index: 3, reason: "toString" }
    ]} />);
    expect(screen.getByText("模型调用失败")).toBeVisible();
    expect(screen.getByText("模型服务不可用")).toBeVisible();
    expect(screen.getByText("其他错误")).toBeVisible();
    expect(screen.getAllByText("读取日志行")).toHaveLength(2);
    expect(screen.getByText("其他工具")).toBeVisible();
    expect(screen.getByText("查询内容")).toBeVisible();
    expect(screen.getByText("已隐藏")).toBeVisible();
    expect(screen.getByText("否")).toBeVisible();
    expect(screen.queryByText(/provider-error|provider-unavailable|toString|read_lines|constructor|\[redacted\]/)).not.toBeInTheDocument();
  });

  it("translates severity and hides internal argument values while retaining log filenames and query literals", () => {
    render(<AnalysisTrace steps={[{ ...step, arguments: {
      file: "device.log", query: "retry 1/3", severity: "ERROR", kind: "first-error", extractor: "extractor-thermal-001",
      cursor: "cursor-token-001", where: "filter-expression-001", source: "rules-fallback"
    }, reason: "token-budget-exhausted" }]} />);
    const details = screen.getByRole("list", { name: "分析轨迹步骤" });
    expect(within(details).getByText("device.log")).toBeVisible();
    expect(within(details).getByText("retry 1/3")).toBeVisible();
    expect(within(details).getByText("错误")).toBeVisible();
    expect(within(details).getAllByText("已设置")).toHaveLength(5);
    expect(within(details).getByText("已达到模型用量上限")).toBeVisible();
    expect(details).not.toHaveTextContent(/ERROR|first-error|extractor-thermal-001|cursor-token-001|filter-expression-001|rules-fallback|token-budget-exhausted/);
  });

  it("hides the tab and makes no trace request without the administrator permission", () => {
    const { getLogTrace } = setup(["logs:view"]);
    expect(screen.queryByRole("tab", { name: "分析轨迹" })).not.toBeInTheDocument();
    expect(getLogTrace).not.toHaveBeenCalled();
  });

  it("shows bounded step metadata and opens the existing viewer at a cited line", async () => {
    const { getLogTrace, getLogLines, log } = setup(["logs:view", "logs:admin-domains"]);
    await userEvent.click(screen.getByRole("tab", { name: "分析轨迹" }));
    const steps = await screen.findByRole("list", { name: "分析轨迹步骤" });
    expect(steps).toHaveTextContent("步骤 1 · 工具调用");
    expect(steps).toHaveTextContent("读取日志行");
    expect(steps).toHaveTextContent("已截断"); expect(steps).toHaveTextContent("引用行数已达到上限");
    expect(steps).toHaveTextContent("2.0 KB"); expect(steps).toHaveTextContent("输入 14 词元"); expect(steps).toHaveTextContent("输出 7 词元");
    expect(getLogTrace).toHaveBeenCalledWith(log.id);
    expect(screen.getByLabelText("分析轨迹摘要")).toHaveTextContent("1 步 · 1 次工具调用 · 输入 14 / 输出 7 词元");
    fireEvent.click(within(steps).getByRole("button", { name: "sample.log:2" }));
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(await within(drawer).findByLabelText("引用日志第 2 行")).toHaveTextContent("cited evidence");
    expect(getLogLines).toHaveBeenCalledWith(log.id, "sample.log", 1, 101);
  });

  it("drops the trace when permission is removed and supports retrying a failed read", async () => {
    const { getLogTrace, rerender, props } = setup(["logs:admin-domains"]);
    getLogTrace.mockRejectedValueOnce(new Error("Unavailable"));
    await userEvent.click(screen.getByRole("tab", { name: "分析轨迹" }));
    expect(await screen.findByText("无法加载分析轨迹")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await screen.findByRole("list", { name: "分析轨迹步骤" });
    rerender(<LogsPage {...props} sessionPermissions={["logs:view"]} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "报告" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.queryByRole("list", { name: "分析轨迹步骤" })).not.toBeInTheDocument();
  });
});
