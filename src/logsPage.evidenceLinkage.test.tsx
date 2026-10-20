import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { initialState } from "./mockData";
import type { LogRecord } from "@/domain/prototype/types";
import { LogsPage } from "@/features/log-analysis/LogsPage";
import { createTestAppPorts } from "@/test/harness/createTestAppPorts";
import { createTestLogAnalysisRepository } from "@/test/harness/createTestLogAnalysisRepository";

const userState = { ...initialState, activeRoleId: "user", logs: [{ ...initialState.logs[0], status: "Complete" as const }] };
const apiHydratedRawLines = [
  "2026-05-25T09:00:00.000Z INFO boot sequence started",
  "2026-05-25T09:00:01.000Z INFO charge loop stable",
  "2026-05-25T09:00:02.000Z WARN pack temp reached 79C",
  "2026-05-25T09:00:03.000Z ERROR derate guard opened",
  "2026-05-25T09:00:04.000Z INFO telemetry flush complete"
];
const apiHydratedLog: LogRecord = {
  ...initialState.logs[0],
  id: "api-hydrated-log",
  reportId: "API-LOG-10C",
  fileName: "api-hydrated-lines.log",
  status: "Complete",
  stage: "report",
  confidence: 91,
  evidence: [
    {
      id: "api-evidence-duplicate-lines",
      stageId: "rootcause",
      lineNumbers: [3, 3, 4],
      inference: "ASCII inference from API hydrated evidence",
      suggestedAction: "ASCII action from API hydrated evidence"
    }
  ],
  rawLines: apiHydratedRawLines
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("LogsPage · 证据与原始日志联动", () => {
  it("证据建议独占一行，保留动作内容且只显示一次", () => {
    render(<LogsPage search="" state={{ ...userState, logs: [apiHydratedLog] }} dispatch={() => undefined} onNavigate={() => undefined} />);
    const chain = screen.getByRole("region", { name: "日志分析证据链" });
    const suggestion = within(chain).getByText(`建议：${apiHydratedLog.evidence[0].suggestedAction}`);
    expect(suggestion.tagName).toBe("P");
    expect(suggestion.parentElement).toHaveClass("evidence-card__suggestion");
    expect(within(chain).queryByText("建议处置")).not.toBeInTheDocument();
    expect(chain).not.toHaveTextContent("关联处置：");
  });
  it("点击证据卡会聚焦对应原始日志行", () => {
    window.history.replaceState(null, "", `/logs?logId=${initialState.logs[0].id}`);
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: "证据 01 日志解析" }));

    expect(screen.getByTestId("rawlog-line-20")).toHaveClass("rawlog-line--anchor-focus");
  });

  it("点击带证据的原始日志行会聚焦证据卡", () => {
    window.history.replaceState(null, "", `/logs?logId=${initialState.logs[0].id}`);
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.click(within(rawLog).getByRole("button", { name: "跳转到第 25 行对应证据" }));

    expect(screen.getByRole("button", { name: "证据 02 模式匹配" })).toHaveClass("evidence-card--focused");
  });

  it("悬停证据卡时高亮对应原始日志行", () => {
    window.history.replaceState(null, "", `/logs?logId=${initialState.logs[0].id}`);
    render(<App initialAppState={userState} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "证据 03 根因推断" }));

    expect(screen.getByTestId("rawlog-line-30")).toHaveClass("rawlog-line--anchor-hover");
  });

  it("links API-hydrated evidence line numbers to raw rows without mock-only ids", () => {
    const state = {
      ...initialState,
      activeRoleId: "user",
      logs: [apiHydratedLog],
      archivedLogIds: []
    };

    window.history.replaceState(null, "", "/logs");
    const { container } = render(<App initialAppState={state} />);

    const evidenceCard = container.querySelector(".evidence-card") as HTMLElement;
    expect(evidenceCard).not.toBeNull();
    expect(within(evidenceCard).getByText(/ASCII inference from API hydrated evidence/)).toBeInTheDocument();
    expect(state.logs[0].evidence[0].lineNumbers).toEqual([3, 3, 4]);

    fireEvent.click(evidenceCard);

    expect(screen.getByTestId("rawlog-line-3")).toHaveTextContent("pack temp reached 79C");
    expect(screen.getByTestId("rawlog-line-4")).toHaveTextContent("derate guard opened");
    expect(screen.getByTestId("rawlog-line-3")).toHaveClass("rawlog-line--anchor-focus");
    expect(screen.getByTestId("rawlog-line-4")).toHaveClass("rawlog-line--anchor-focus");
    expect(screen.queryByTestId("rawlog-line-api-evidence-duplicate-lines")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".rawlog-line--anchor-focus")).toHaveLength(2);
  });

  it.each([true, false])("caps 101 evidence locations and opens every citation in the file drawer (explicit file: %s)", async (withFile) => {
    const rawLines = Array.from({ length: 101 }, (_, index) => `日志内容 ${index + 1}`);
    const filePath = withFile ? "device/secondary.log" : apiHydratedLog.fileName;
    const log: LogRecord = { ...apiHydratedLog, rawLines, files: undefined, evidence: [{
      ...apiHydratedLog.evidence[0],
      filePath: withFile ? filePath : undefined,
      lineNumbers: rawLines.map((_, index) => index + 1)
    }] };
    const getLogLines = vi.fn(async (_logId: string, requestedFile: string, startLine: number, endLine: number) => ({
      file: requestedFile, startLine, endLine: Math.min(endLine, rawLines.length), totalLines: rawLines.length,
      lines: rawLines.slice(startLine - 1, endLine).map((content, index) => ({ lineNumber: startLine + index, content }))
    }));
    const runtime = createTestAppPorts({ overrides: { logAnalysisRepository: {
      ...createTestLogAnalysisRepository([log]), getLogLines
    } } });
    const { container } = render(<LogsPage state={{ ...userState, logs: [log] }} search="" runtime={runtime}
      dispatch={() => undefined} onNavigate={() => undefined} />);
    const card = container.querySelector(".evidence-card") as HTMLElement;
    expect(card.querySelectorAll(".evidence-card__body code")).toHaveLength(3);
    for (const line of [1, 2, 3]) {
      expect(within(card).getByText(withFile ? `${filePath}:${line}` : `#${line} ${rawLines[line - 1]}`)).toBeVisible();
    }
    expect(within(card).queryByText(withFile ? `${filePath}:4` : `#4 ${rawLines[3]}`)).not.toBeInTheDocument();
    expect(getLogLines).not.toHaveBeenCalled();
    const remaining = within(card).getByRole("button", { name: "其余 98 行" });
    remaining.focus();
    await userEvent.keyboard("{Enter}");
    const drawer = screen.getByRole("dialog", { name: "日志文件" });
    expect(await within(drawer).findByLabelText("引用日志第 101 行")).toHaveTextContent(rawLines[100]);
    expect(within(drawer).getByText(filePath)).toBeVisible();
    expect(getLogLines).toHaveBeenCalledWith(log.id, filePath, 1, 101);
    const cited = within(drawer).getAllByLabelText(/^引用日志第 \d+ 行$/);
    expect(cited).toHaveLength(101);
    for (const [index, line] of cited.entries()) {
      expect(line).toHaveAttribute("data-line-number", String(index + 1));
      expect(line).toHaveAttribute("data-highlighted", "true");
    }
  });
});
