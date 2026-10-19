import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LogLineRange } from "@/application/ports/LogAnalysisRepository";
import type { LogEvidence } from "@/domain/logs/types";
import { initialState } from "@/mockData";
import { createTestAppPorts } from "@/test/harness/createTestAppPorts";
import { createTestLogAnalysisRepository } from "@/test/harness/createTestLogAnalysisRepository";
import { LogsPage } from "./LogsPage";
import { LogFileDrawer } from "./LogFileDrawer";

const file = "device/secondary.log";
const evidence = { ...initialState.logs[0].evidence[0], filePath: file, lineNumbers: [151, 152] };

function renderViewer(failFirst = false, citation: LogEvidence = evidence) {
  const log = { ...initialState.logs[0], status: "Complete" as const, evidence: [citation],
    files: [{ path: initialState.logs[0].fileName, lineCount: 600, sizeBytes: 6000, encoding: "utf-8" as const,
      lossy: false, status: "analyzed" as const, skipReason: null }],
    signalSummary: { signals: [{ kind: "crash" as const, source: "generic" as const, severity: "Critical" as const,
      title: "Crash", count: 1, anchors: [{ file, line: 451, content: "error" }] }],
      templates: [], truncatedSignals: false, truncatedTemplates: false } };
  const getLogLines = vi.fn(async (_id: string, requestedFile: string, startLine: number, requestedEnd: number): Promise<LogLineRange> => {
    const endLine = Math.min(600, requestedEnd);
    return { file: requestedFile, startLine, endLine, totalLines: 600,
      lines: Array.from({ length: endLine - startLine + 1 }, (_, index) => ({ lineNumber: startLine + index, content: `content ${startLine + index}` })) };
  });
  if (failFirst) getLogLines.mockRejectedValueOnce(new Error("Unavailable"));
  const getSourceEvidence = vi.fn(async () => ({ snapshotId: "snapshot", path: "thermal.c", line: 9,
    versionLabel: "v1", startLine: 8, excerpt: "if (hot) {\n  thermal_foldback();\n}" }));
  const runtime = createTestAppPorts({ overrides: {
    logAnalysisRepository: { ...createTestLogAnalysisRepository([log]), getLogLines, getSourceEvidence }
  } });
  render(<LogsPage search="" state={{ ...initialState, activeRoleId: "user", logs: [log] }} dispatch={() => undefined}
    onNavigate={() => undefined} runtime={runtime} />);
  return { getLogLines, getSourceEvidence, log };
}

describe("log file drawer", () => {
  it.each(["body", "Enter", "Space"])("focuses the current file via %s without opening the drawer", async (action) => {
    const currentFile = initialState.logs[0].fileName;
    const { getLogLines } = renderViewer(false, { ...evidence, filePath: currentFile, lineNumbers: [3, 4] });
    const card = screen.getByRole("group", { name: /^证据 01 / });
    if (action === "body") fireEvent.click(within(card).getByText(evidence.inference));
    else {
      const locate = within(card).getByRole("button", { name: /^证据 01 / });
      locate.focus();
      await userEvent.keyboard(action === "Enter" ? "{Enter}" : " ");
      expect(locate).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.getByTestId("rawlog-line-3")).toHaveClass("rawlog-line--anchor-focus");
    expect(screen.getByTestId("rawlog-line-4")).toHaveClass("rawlog-line--anchor-focus");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getLogLines).not.toHaveBeenCalled();
  });

  it("does not highlight raw lines from a different file when the card body is clicked", async () => {
    renderViewer(false, { ...evidence, lineNumbers: [3, 4] });
    const card = screen.getByRole("group", { name: /^证据 01 / });
    fireEvent.click(within(card).getByText(evidence.inference));
    expect(card).toHaveClass("evidence-card--focused");
    expect(screen.getByTestId("rawlog-line-3")).not.toHaveClass("rawlog-line--anchor-focus");
    expect(screen.getByTestId("rawlog-line-4")).not.toHaveClass("rawlog-line--anchor-focus");
  });

  it.each([0, 43, 92])("disables both context controls when all %i lines are already shown", async (totalLines) => {
    const readLines = vi.fn(async (): Promise<LogLineRange> => ({
      file, startLine: 1, endLine: totalLines, totalLines,
      lines: Array.from({ length: totalLines }, (_, index) => ({ lineNumber: index + 1, content: `content ${index + 1}` }))
    }));
    render(<LogFileDrawer file={file} citedLines={[1]} readLines={readLines} onClose={() => undefined} />);
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(await within(drawer).findByText(totalLines ? `第 1–${totalLines} 行，共 ${totalLines} 行` : "共 0 行")).toBeInTheDocument();
    const above = within(drawer).getByRole("button", { name: "加载上方日志" });
    const below = within(drawer).getByRole("button", { name: "加载下方日志" });
    expect(above).toBeDisabled();
    expect(below).toBeDisabled();
    await userEvent.click(above);
    await userEvent.click(below);
    expect(readLines).toHaveBeenCalledTimes(1);
    if (totalLines) expect(within(drawer).getByLabelText(`复制第 ${totalLines} 行`)).toBeInTheDocument();
    expect(within(drawer).queryByLabelText(`复制第 ${totalLines + 1} 行`)).not.toBeInTheDocument();
  });

  it.each([false, true])("keeps source excerpts expandable in a group with file path: %s", async (withFile) => {
    const { getSourceEvidence } = renderViewer(false, { ...evidence, filePath: withFile ? file : undefined,
      sourceLocation: { snapshotId: "snapshot", path: "thermal.c", line: 9 } });
    const card = screen.getByRole("group", { name: /^证据 01 / });
    expect(card).not.toHaveAttribute("aria-pressed");
    await userEvent.click(within(card).getByRole("button", { name: "展开源码摘录" }));
    expect(await within(card).findByLabelText("已引用源码摘录")).toHaveTextContent("9: thermal_foldback()");
    expect(getSourceEvidence).toHaveBeenCalledTimes(1);
    expect(card).not.toHaveClass("evidence-card--focused");
    if (withFile) {
      await userEvent.click(within(card).getByRole("button", { name: `${file}:151` }));
      const drawer = screen.getByRole("dialog", { name: "日志文件" });
      expect(await within(drawer).findByLabelText("引用日志第 151 行")).toHaveAttribute("data-highlighted", "true");
    }
  });

  it("opens evidence from another file, highlights citations, copies a line and loads context in both directions", async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const { getLogLines, log } = renderViewer();
    expect(screen.getByRole("group", { name: /^证据 01 / })).not.toHaveAttribute("aria-pressed");
    expect(screen.getByText(/原始日志预览：.*共 600 行/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: `${file}:151` }));
    expect(document.getElementById(`evidence-card-${evidence.id}`)).not.toHaveClass("evidence-card--focused");
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(within(drawer).getByText(file)).toBeInTheDocument();
    const first = await within(drawer).findByLabelText("引用日志第 151 行");
    expect(first).toHaveAttribute("data-highlighted", "true");
    expect(within(drawer).getByLabelText("引用日志第 152 行")).toHaveAttribute("data-highlighted", "true");
    await waitFor(() => expect(first).toHaveFocus());
    expect(first.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(getLogLines).toHaveBeenLastCalledWith(log.id, file, 101, 201);
    fireEvent.click(within(drawer).getByLabelText("复制第 151 行"));
    await waitFor(() => expect(within(drawer).getByText("已复制日志行。")).toBeInTheDocument());
    expect(copy).toHaveBeenCalledWith("content 151");
    expect(within(drawer).getByText("已复制日志行。")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByText("加载上方日志"));
    await waitFor(() => expect(getLogLines).toHaveBeenLastCalledWith(log.id, file, 1, 201));
    expect(await within(drawer).findByText("content 1")).toBeInTheDocument();
    expect(within(drawer).getByText("加载上方日志")).toBeDisabled();
    fireEvent.click(within(drawer).getByText("加载下方日志"));
    expect(await within(drawer).findByText("content 301")).toBeInTheDocument();
    expect(getLogLines).toHaveBeenLastCalledWith(log.id, file, 1, 301);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "原始日志" })).toBeInTheDocument();
  });

  it("opens every signal anchor through the file reader and keeps requests within 400 lines", async () => {
    const { getLogLines, log } = renderViewer();
    await userEvent.click(screen.getByRole("tab", { name: "信号" }));
    const anchor = screen.getByRole("button", { name: `${file}:451` });
    expect(anchor).toBeEnabled();
    fireEvent.click(anchor);
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(await within(drawer).findByLabelText("引用日志第 451 行")).toHaveAttribute("data-highlighted", "true");
    expect(getLogLines).toHaveBeenLastCalledWith(log.id, file, 401, 501);
    for (let index = 0; index < 4; index++) {
      const button = within(drawer).getByText("加载上方日志");
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
    }
    await waitFor(() => expect(within(drawer).getByText("加载上方日志")).toBeDisabled());
    for (const [, , start, end] of getLogLines.mock.calls) expect(end - start + 1).toBeLessThanOrEqual(400);
    expect(drawer.querySelectorAll("[data-line-number]")).toHaveLength(400);
  });

  it("shows a failed read and retries without losing the report", async () => {
    renderViewer(true);
    await userEvent.click(await screen.findByRole("button", { name: `${file}:151` }));
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(await within(drawer).findByRole("alert")).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole("button", { name: "重试" }));
    expect(await within(drawer).findByText("content 151")).toBeInTheDocument();
    expect(within(drawer).queryByRole("alert")).not.toBeInTheDocument();
  });
});
