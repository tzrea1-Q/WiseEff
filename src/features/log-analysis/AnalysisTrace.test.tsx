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
  it("summarizes tools, provider tokens and convergence above the steps", () => {
    render(<AnalysisTrace steps={[
      { ...step, inputTokens: 4000, outputTokens: 150 },
      { ...step, index: 2, inputTokens: 207, outputTokens: 30 },
      { ...step, index: 3, kind: "model-turn", inputTokens: undefined, outputTokens: undefined },
      { ...step, index: 4, kind: "early-convergence", inputTokens: undefined, outputTokens: undefined },
      { ...step, index: 5, kind: "rule-fallback", inputTokens: undefined, outputTokens: undefined }
    ]} />);
    expect(screen.getByLabelText("分析轨迹摘要")).toHaveTextContent("5 步 · 2 次工具调用 · 输入 4,207 / 输出 180 tokens · 已降级 · 提前收敛");
    expect(screen.queryByRole("button", { name: "sample.log:2" })).not.toBeInTheDocument();
  });

  it("distinguishes pinned source references from navigable log lines", () => {
    const onOpenLine = vi.fn();
    render(<AnalysisTrace steps={[{ ...step, lines: [{ file: "drivers/thermal.c", line: 9, snapshotId: "source-version" }] }]} onOpenLine={onOpenLine} />);
    expect(screen.getByText("源码 drivers/thermal.c:9")).toHaveAttribute("title", "source-version");
    expect(screen.queryByRole("button", { name: /thermal\.c/ })).not.toBeInTheDocument();
    expect(onOpenLine).not.toHaveBeenCalled();
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
    expect(steps).toHaveTextContent("read_lines");
    expect(steps).toHaveTextContent("已截断"); expect(steps).toHaveTextContent("line-cap");
    expect(steps).toHaveTextContent("2.0 KiB"); expect(steps).toHaveTextContent("输入 14 tokens"); expect(steps).toHaveTextContent("输出 7 tokens");
    expect(getLogTrace).toHaveBeenCalledWith(log.id);
    expect(screen.getByLabelText("分析轨迹摘要")).toHaveTextContent("1 步 · 1 次工具调用 · 输入 14 / 输出 7 tokens");
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
