import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogRecord, LogSignalSummary } from "@/domain/logs/types";
import { initialState } from "@/mockData";
import { LogsPage } from "./LogsPage";
import { SignalsTab } from "./SignalsTab";

const first = { file: "device/kernel.log", line: 1, content: "kernel panic" };
const last = { file: "device/kernel.log", line: 2, content: "ERROR count=2" };
const other = { file: "device/system.log", line: 1, content: "watchdog" };
const summary: LogSignalSummary = {
  signals: [
    { kind: "crash", severity: "Critical", source: "generic", title: "Crash signature: Kernel panic", signature: "Kernel panic", count: 2, anchors: [first, other] },
    { kind: "crash", severity: "Critical", source: "generic", title: "Crash signature: Oops", signature: "Oops", count: 1, anchors: [last] },
    { kind: "skill:rule-a", severity: "Warning", source: "skill", title: "技能规则命中", count: 1, anchors: [last] },
    { kind: "first-error", severity: "Warning", source: "generic", title: "First error", count: 1, anchors: [last] }
  ],
  templates: [{ template: "ERROR count=<num>", count: 42, first, last }],
  truncatedSignals: true,
  truncatedTemplates: true
};

function renderReport(signalSummary?: LogSignalSummary) {
  const log: LogRecord = {
    ...initialState.logs[0], status: "Complete", stage: "report", signalSummary, evidence: [],
    files: [{ path: first.file, lineCount: 2, sizeBytes: 100, encoding: "utf-8", lossy: false, status: "analyzed", skipReason: null }],
    rawLines: [first.content, last.content]
  };
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined} onNavigate={() => undefined} />);
}

afterEach(cleanup);

describe("log report signals", () => {
  it("shows skill signals before generic kinds with counts, line levels, anchors, templates and limits", async () => {
    renderReport(summary);
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    const crash = screen.getByRole("region", { name: "信号类型 崩溃特征" });
    expect(within(crash).getByRole("heading", { name: "崩溃特征" })).toBeInTheDocument();
    expect(within(crash).getByText("崩溃特征：Kernel panic")).toBeInTheDocument();
    expect(within(crash).getByText("崩溃特征：Oops")).toBeInTheDocument();
    expect(within(crash).queryByText(/Crash signature/)).not.toBeInTheDocument();
    const skill = screen.getByRole("region", { name: "信号类型 技能信号" });
    expect(within(skill).getByText("技能规则命中")).toBeInTheDocument();
    expect(within(skill).getByText("技能")).toBeInTheDocument();
    expect(within(skill).getByText("错误")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent))
      .toEqual(["技能信号", "崩溃特征", "首个错误", "行模板"]);
    expect(within(crash).getAllByText("通用")).toHaveLength(2);
    expect(within(crash).getAllByText("严重")).toHaveLength(1);
    expect(within(crash).getByText("错误")).toBeInTheDocument();
    expect(within(crash).getByText("2")).toBeInTheDocument();
    expect(within(crash).getByRole("button", { name: "device/system.log:1" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "信号类型 首个错误" })).toHaveTextContent("文件中的首个错误");
    expect(screen.getByRole("region", { name: "信号类型 首个错误" })).toHaveTextContent("错误");
    for (const header of screen.getAllByRole("columnheader", { name: "次数" })) {
      expect(header).toHaveClass("whitespace-nowrap", "w-24");
    }
    const templates = screen.getByRole("region", { name: "行模板" });
    expect(within(templates).getByText("ERROR count=<num>")).toBeInTheDocument();
    expect(within(templates).getByText("42")).toBeInTheDocument();
    expect(within(templates).getByRole("button", { name: "第 1 行" })).toBeEnabled();
    expect(within(templates).getByRole("button", { name: "第 2 行" })).toBeEnabled();
    expect(screen.getByText(/信号已达上限/)).toBeInTheDocument();
    expect(screen.getByText(/行模板已达上限/)).toBeInTheDocument();
  });

  it("keeps signal locations fully wrapped while shortening only template locations", () => {
    const anchor = { ...first, file: `device/${"long-directory/".repeat(20)}kernel.log` };
    render(<SignalsTab summary={{ ...summary,
      signals: [{ ...summary.signals[0], anchors: [anchor] }],
      templates: [{ ...summary.templates[0], first: anchor, last: anchor }]
    }} rawFilePath={anchor.file} rawLineCount={2} fileCount={1} onAnchor={() => undefined} />);
    const location = screen.getByRole("button", { name: `${anchor.file}:1` });
    expect(location).toHaveTextContent(`${anchor.file}:1`);
    expect(location).toHaveClass("whitespace-normal", "break-all", "h-auto");
    expect(location).not.toHaveClass("truncate");
    expect(within(screen.getByRole("region", { name: "行模板" })).getAllByRole("button", { name: "第 1 行" })).toHaveLength(2);
  });

  it("shows only line numbers for one-file templates while retaining full paths in tooltips and callbacks", async () => {
    const onAnchor = vi.fn();
    render(<SignalsTab summary={summary} rawFilePath={first.file} rawLineCount={2} fileCount={1} onAnchor={onAnchor} />);
    const templates = screen.getByRole("region", { name: "行模板" });
    const firstLocation = within(templates).getByRole("button", { name: "第 1 行" });
    expect(firstLocation).toHaveAttribute("title", `${first.file}:1 · ${first.content}`);
    expect(firstLocation).not.toHaveTextContent(first.file);
    await userEvent.click(firstLocation);
    expect(onAnchor).toHaveBeenLastCalledWith(first);
    await userEvent.click(within(templates).getByRole("button", { name: "第 2 行" }));
    expect(onAnchor).toHaveBeenLastCalledWith(last);
  });

  it("uses start ellipsis for multi-file template paths and preserves the line suffix and callback", async () => {
    const onAnchor = vi.fn();
    const anchor = { ...other, file: `device/${"long-directory/".repeat(20)}system.log`, line: 12345 };
    render(<SignalsTab summary={{ ...summary, templates: [{ ...summary.templates[0], last: anchor }] }}
      rawFilePath={first.file} rawLineCount={2} fileCount={2} allFilesAvailable onAnchor={onAnchor} />);
    const templates = screen.getByRole("region", { name: "行模板" });
    const location = within(templates).getByRole("button", { name: `${anchor.file}:12345` });
    expect(location).toHaveAttribute("title", `${anchor.file}:12345 · ${anchor.content}`);
    expect(location).toHaveClass("whitespace-nowrap");
    const path = within(location).getByText(anchor.file).parentElement;
    expect(path).toHaveClass("min-w-0", "truncate");
    expect(path).toHaveAttribute("dir", "rtl");
    expect(within(location).getByText(":12345")).toHaveClass("shrink-0");
    await userEvent.click(location);
    expect(onAnchor).toHaveBeenLastCalledWith(anchor);
  });

  it.each([
    ["ERROR retry failed", "错误"], ["WARN retry delayed", "警告"], ["INFO retry started", "信息"],
    ["DEBUG retry details", "调试"], ["TRACE retry details", "跟踪"], ["INFO no error detected", "信息"]
  ])("uses the cited line level for %s", (content, label) => {
    render(<SignalsTab summary={{ ...summary, signals: [{ ...summary.signals[2], anchors: [{ ...last, content }] }], templates: [] }}
      rawFilePath={last.file} rawLineCount={2} onAnchor={() => undefined} />);
    expect(within(screen.getByRole("region", { name: "信号类型 技能信号" })).getByText(label)).toBeInTheDocument();
  });

  it("opens the report and highlights a signal line even without report evidence", async () => {
    renderReport(summary);
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    const crash = screen.getByRole("region", { name: "信号类型 崩溃特征" });
    await userEvent.click(within(crash).getByRole("button", { name: "device/kernel.log:1" }));
    expect(screen.getByRole("tab", { name: "报告", selected: true })).toBeInTheDocument();
    expect(screen.getByTestId("rawlog-line-1")).toHaveClass("rawlog-line--anchor-focus");
    expect(screen.getByTestId("rawlog-line-1")).toHaveFocus();
  });

  it("keeps the report intact and explains missing signals for historical records", async () => {
    renderReport();
    expect(screen.getByRole("tab", { name: "报告", selected: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    expect(screen.getByText("暂无信号。")).toBeInTheDocument();
    expect(screen.getByText("暂无行模板。")).toBeInTheDocument();
  });

  it.each([
    ["time_cap", "信号提取已达时间上限，仅显示已完成的部分结果。"],
    ["line_cap", "部分日志行超出扫描长度，信号仅基于已扫描的行首内容。"],
    ["extraction_error", "信号提取未完成，本次暂无信号结果；可继续查看报告与原始日志。"]
  ] as const)("explains %s without presenting incomplete extraction as a complete inventory", async (reason, message) => {
    renderReport({ ...summary, signals: reason === "extraction_error" ? [] : summary.signals,
      templates: reason === "extraction_error" ? [] : summary.templates, truncated: true, reason });
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    expect(screen.getByText(message)).toHaveAttribute("role", "status");
    expect(screen.queryByText("暂无信号。历史记录可能尚未提取通用信号。")).not.toBeInTheDocument();
    if (reason !== "extraction_error") expect(screen.getByText("崩溃特征：Kernel panic")).toBeInTheDocument();
  });
});
