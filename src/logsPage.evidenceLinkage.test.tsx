import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";
import { initialState, type LogRecord } from "./mockData";

const userState = { ...initialState, activeRoleId: "user" };
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
  it("点击证据卡会聚焦对应原始日志行", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    fireEvent.click(screen.getByRole("button", { name: "证据 01 日志解析" }));

    expect(screen.getByTestId("rawlog-line-20")).toHaveClass("rawlog-line--anchor-focus");
  });

  it("点击带证据的原始日志行会聚焦证据卡", () => {
    window.history.replaceState(null, "", "/logs");
    render(<App initialAppState={userState} />);

    const rawLog = screen.getByRole("region", { name: "原始日志" });
    fireEvent.click(within(rawLog).getByRole("button", { name: "跳转到第 25 行对应证据" }));

    expect(screen.getByRole("button", { name: "证据 02 模式匹配" })).toHaveClass("evidence-card--focused");
  });

  it("悬停证据卡时高亮对应原始日志行", () => {
    window.history.replaceState(null, "", "/logs");
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
});
