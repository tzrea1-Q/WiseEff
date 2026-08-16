import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogRecord } from "@/domain/prototype/types";
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

  it("marks degraded rules-fallback results prominently with the reason", () => {
    render(
      <LogRecordDrawer
        record={{
          ...record,
          analysisSource: "rules-fallback",
          degradedReason: "provider-unavailable",
          logDomainName: "charging-power"
        }}
        open
        {...handlers}
        canAct
      />
    );

    const provenance = screen.getByTestId("drawer-analysis-provenance");
    expect(provenance).toHaveTextContent("降级分析 · 规则回退");
    expect(provenance).toHaveTextContent(/AI 分析服务不可用/);
    expect(provenance).toHaveTextContent("业务域 · charging-power");
    expect(screen.getByText("规则评分")).toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
  });

  it("shows the agent provenance badge without a degraded warning", () => {
    render(<LogRecordDrawer record={{ ...record, analysisSource: "agent" }} open {...handlers} canAct />);

    const provenance = screen.getByTestId("drawer-analysis-provenance");
    expect(provenance).toHaveTextContent("Agent 分析");
    expect(provenance).not.toHaveTextContent("降级分析");
    expect(screen.getByText("模型自估")).toBeInTheDocument();
    expect(screen.queryByText("置信度")).not.toBeInTheDocument();
  });

  it("renders no provenance block for legacy records without a source", () => {
    render(<LogRecordDrawer record={record} open {...handlers} canAct />);

    expect(screen.queryByTestId("drawer-analysis-provenance")).not.toBeInTheDocument();
    expect(screen.getByText("置信度")).toBeInTheDocument();
    expect(screen.queryByText("模型自估")).not.toBeInTheDocument();
    expect(screen.queryByText("规则评分")).not.toBeInTheDocument();
  });

  it("marks an early-converged agent conclusion as degraded instead of a full analysis", () => {
    render(
      <LogRecordDrawer
        record={{ ...record, analysisSource: "agent", degradedReason: "token-budget-exhausted" }}
        open
        {...handlers}
        canAct
      />
    );

    const provenance = screen.getByTestId("drawer-analysis-provenance");
    expect(provenance).toHaveTextContent("降级分析 · 提前收敛");
    expect(provenance).toHaveTextContent(/提前收敛为低置信结论/);
    expect(provenance).not.toHaveTextContent("降级分析 · 规则回退");
    expect(screen.getByText("模型自估")).toBeInTheDocument();
  });

  describe("导出评测案例草稿", () => {
    const completedRecord: LogRecord = {
      ...record,
      status: "Complete",
      logDomainName: "charging-power",
      rawLines: ["10:24:01 WARN battery temperature over soft limit", "10:24:03 INFO policy foldback engaged"],
      analysisQuestion: "为什么快充降速？"
    };

    it("disables the export action for records without a completed analysis", () => {
      render(<LogRecordDrawer record={record} open {...handlers} canAct />);

      expect(screen.getByRole("button", { name: /导出评测案例草稿/ })).toBeDisabled();
    });

    it("opens the de-identification reminder dialog with the checklist and gate wording", async () => {
      render(<LogRecordDrawer record={completedRecord} open {...handlers} canAct />);

      await userEvent.click(screen.getByRole("button", { name: /导出评测案例草稿/ }));

      const dialog = await screen.findByTestId("export-eval-case-draft-dialog");
      expect(dialog).toHaveTextContent("eval-cases/logs/charging-power/");
      expect(dialog).toHaveTextContent(/无个人姓名、电话、邮箱或账号标识/);
      expect(dialog).toHaveTextContent(/替换保持行号与技术语义稳定/);
      expect(dialog).toHaveTextContent(/把 deIdentified 改为 true.*后才可入库/);
      expect(dialog).toHaveTextContent(/无法完全脱敏的案例不得进入仓库/);
    });

    function blobToText(blob: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
      });
    }

    it("downloads a schema-aligned case.yaml draft and log.txt", async () => {
      const objectUrls: Blob[] = [];
      const createObjectURL = vi.fn((blob: Blob) => {
        objectUrls.push(blob);
        return `blob:mock-${objectUrls.length}`;
      });
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));

      render(<LogRecordDrawer record={completedRecord} open {...handlers} canAct />);
      await userEvent.click(screen.getByRole("button", { name: /导出评测案例草稿/ }));
      const dialog = await screen.findByTestId("export-eval-case-draft-dialog");

      await userEvent.click(within(dialog).getByRole("button", { name: /下载 case\.yaml 草稿/ }));
      await userEvent.click(within(dialog).getByRole("button", { name: /下载 log\.txt/ }));

      expect(objectUrls).toHaveLength(2);
      const caseYaml = await blobToText(objectUrls[0]);
      expect(caseYaml).toContain("domain: charging-power");
      expect(caseYaml).toContain("realLog: true");
      expect(caseYaml).toContain("deIdentified: false");
      expect(caseYaml).toContain("rootCauseCategory: TODO");
      expect(caseYaml).toContain("keyEvidenceLines: [20, 30]");
      expect(caseYaml).toContain('analysisQuestion: "为什么快充降速？"');
      const logText = await blobToText(objectUrls[1]);
      expect(logText).toBe(
        "10:24:01 WARN battery temperature over soft limit\n10:24:03 INFO policy foldback engaged\n"
      );
      vi.unstubAllGlobals();
    });
  });
});
