import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogRecord } from "@/mockData";
import { LogRecordDrawer } from "./LogRecordDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const record: LogRecord = {
  id: "log-active",
  reportId: "RPT-9092",
  fileName: "charging_thermal_trace_20260504.log",
  source: "Battery Thermal",
  fileSizeMB: 48.2,
  status: "Processing",
  stage: "rootcause",
  confidence: 85,
  conclusion: "快充阶段电池包温升过快。",
  impact: "battery-pack-lab-a",
  evidence: [
    {
      id: "ev-1",
      stageId: "parse",
      lineNumbers: [20],
      inference: "10:24:01 WARN battery temperature over soft limit",
      suggestedAction: "复核温控阈值",
      ruleHit: "thermal_soft_limit"
    },
    {
      id: "ev-2",
      stageId: "rootcause",
      lineNumbers: [30],
      inference: "10:24:03 INFO policy foldback engaged",
      suggestedAction: "下调快充电流"
    }
  ],
  suggestedActions: ["下调快充电流", "复核温控阈值"],
  severity: "Warning",
  rawLines: [],
  capturedAt: "10:24:05",
  updatedAt: "18 分钟前",
  updatedAtIso: new Date().toISOString(),
  submittedBy: "H. Zhao"
};

describe("LogRecordDrawer", () => {
  const handlers = {
    onClose: vi.fn(),
    onNavigateToWorkbench: vi.fn(),
    onReanalyze: vi.fn(),
    onArchive: vi.fn(),
    onSubmitHelpfulFeedback: vi.fn()
  };

  it("renders nothing when record is null", () => {
    render(<LogRecordDrawer record={null} open={false} {...handlers} canAct />);

    expect(screen.queryByText(/RPT-/)).not.toBeInTheDocument();
  });

  it("renders record fields when open", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getByText("RPT-9092")).toBeInTheDocument();
    expect(screen.getByText(/charging_thermal_trace/)).toBeInTheDocument();
    expect(screen.getByText(record.conclusion)).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("lists evidence items", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getAllByText(/10:24:01 WARN/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10:24:03 INFO/).length).toBeGreaterThan(0);
    expect(screen.getByText("L20")).toBeInTheDocument();
  });

  it("lists suggested actions", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.getAllByText("下调快充电流").length).toBeGreaterThan(0);
    expect(screen.getAllByText("复核温控阈值").length).toBeGreaterThan(0);
  });

  it("disables action buttons when canAct=false", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct={false} />);

    expect(screen.getByRole("button", { name: /重新分析/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /归档/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /有帮助/ })).toBeDisabled();
  });

  it("calls onNavigateToWorkbench on 跳转", async () => {
    const onNavigateToWorkbench = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={onNavigateToWorkbench}
        onReanalyze={vi.fn()}
        onArchive={vi.fn()}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /跳转到/ }));
    expect(onNavigateToWorkbench).toHaveBeenCalledWith("log-active");
  });

  it("calls onReanalyze on 重新分析", async () => {
    const onReanalyze = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={onReanalyze}
        onArchive={vi.fn()}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /重新分析/ }));
    expect(onReanalyze).toHaveBeenCalledWith("log-active");
  });

  it("calls onArchive on 归档", async () => {
    const onArchive = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={vi.fn()}
        onArchive={onArchive}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /归档/ }));
    expect(onArchive).toHaveBeenCalledWith("log-active");
  });

  it("calls onSubmitHelpfulFeedback on 有帮助", async () => {
    const onSubmitHelpfulFeedback = vi.fn();
    render(
      <LogRecordDrawer
        record={record}
        open
        onClose={vi.fn()}
        onNavigateToWorkbench={vi.fn()}
        onReanalyze={vi.fn()}
        onArchive={vi.fn()}
        onSubmitHelpfulFeedback={onSubmitHelpfulFeedback}
        canAct
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /有帮助/ }));
    expect(onSubmitHelpfulFeedback).toHaveBeenCalledWith("log-active");
  });

  it("marks pending action buttons busy", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct reanalyzePending archivePending feedbackPending />);

    expect(screen.getByRole("button", { name: /重新分析/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /归档/ })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /有帮助/ })).toHaveAttribute("aria-busy", "true");
  });
});
