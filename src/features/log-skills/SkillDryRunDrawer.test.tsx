import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { SkillDryRun, SkillDryRunDetail } from "./types";
import { SkillDryRunDrawer } from "./SkillDryRunDrawer";

const processing: SkillDryRun = { id: "dry-run", skillRevisionId: "draft", status: "processing", progress: 20, report: null, error: null, createdAt: "2026-10-19T00:00:00Z" };
const complete: SkillDryRunDetail = { run: { ...processing, status: "complete", progress: 100, report: {
  confidence: 0.9, conclusion: "Draft conclusion", impact: "Reduced power", severity: "Warning", suggestedActions: ["Check temperature"],
  evidence: [{ stageId: "rootcause", filePath: "sample.log", lineNumbers: [2], inference: "Thermal evidence", suggestedAction: "Check cooling" }],
  reportContext: { lineCount: 2, entryCount: 2 }
} }, steps: [{ index: 1, kind: "early-convergence", tool: null, arguments: {}, resultBytes: 32,
  lines: [{ file: "sample.log", line: 2 }], outcome: "ok", reason: "sufficient-evidence" }] };

describe("skill dry-run drawer", () => {
  it("shows progress, then the conclusion, evidence and trace with plain-text lines", async () => {
    let finish!: (detail: SkillDryRunDetail) => void;
    const repository = { getSkillDryRun: vi.fn(() => new Promise<SkillDryRunDetail>((resolve) => { finish = resolve; })),
      getSkillDryRunLines: vi.fn(async () => ({ file: "sample.log", startLine: 1, endLine: 2, totalLines: 2,
        lines: [{ lineNumber: 2, content: "temperature=90" }] })) };
    const onClose = vi.fn();
    function Harness() {
      const [run, setRun] = useState(processing);
      return <SkillDryRunDrawer skillId="skill" run={run} repository={repository} open onClose={onClose} onRunChange={setRun} />;
    }
    render(<Harness />);
    const drawer = screen.getByRole("dialog", { name: "试运行" });
    expect(within(drawer).getByRole("progressbar", { name: "试运行进度" })).toHaveAttribute("value", "20");
    expect(drawer).toHaveTextContent("结果不会加入日志列表");
    await act(async () => finish(complete));
    expect(drawer).toHaveTextContent("试运行完成");
    expect(drawer).toHaveTextContent("Draft conclusion"); expect(drawer).toHaveTextContent("Thermal evidence");
    expect(drawer).toHaveTextContent("提前收敛");
    expect(within(drawer).getByLabelText("分析轨迹摘要")).toHaveTextContent("1 步 · 0 次工具调用 · 提前收敛");
    expect(within(drawer).getAllByText("sample.log:2")).toHaveLength(2);
    expect(within(drawer).queryByRole("button", { name: "sample.log:2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "日志文件" })).not.toBeInTheDocument();
    expect(repository.getSkillDryRunLines).not.toHaveBeenCalled();
  });

  it("shows failed runs and allows retrying a failed status request", async () => {
    const failed = { ...complete, run: { ...processing, status: "failed" as const, progress: 100, error: "Dry run timed out." } };
    const repository = { getSkillDryRun: vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(failed) };
    function Harness() {
      const [run, setRun] = useState(processing);
      return <SkillDryRunDrawer skillId="skill" run={run} repository={repository} open onClose={() => undefined} onRunChange={setRun} />;
    }
    render(<Harness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("无法读取试运行进度");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("试运行超时，请重试。")).toBeInTheDocument();
    expect(screen.getByText("试运行失败")).toBeInTheDocument();
  });

  it("restarts an interrupted run and polls the new run on retry", async () => {
    const interrupted = { ...processing, status: "failed" as const, error: "服务重启，试运行已中断" };
    const restarted = { ...processing, id: "retry-run" };
    let finishRetry!: (run: SkillDryRun) => void;
    const repository = {
      getSkillDryRun: vi.fn(async (_skillId: string, runId: string) => ({ run: runId === interrupted.id ? interrupted : restarted, steps: [] })),
      startSkillDryRun: vi.fn().mockRejectedValueOnce(new WiseEffApiError("RATE_LIMITED", "试运行繁忙，请稍后重试", {}, "request"))
        .mockImplementation(() => new Promise<SkillDryRun>((resolve) => { finishRetry = resolve; }))
    };
    function Harness() {
      const [run, setRun] = useState(interrupted as SkillDryRun);
      return <SkillDryRunDrawer skillId="skill" run={run} repository={repository} open onClose={() => undefined} onRunChange={setRun} />;
    }
    render(<Harness />);
    expect(await screen.findByText("服务重启，试运行已中断")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("试运行繁忙，请稍后重试")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(screen.getByRole("button", { name: "正在重试…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在重试…" }));
    expect(repository.startSkillDryRun).toHaveBeenCalledTimes(2);
    await act(async () => finishRetry(restarted));
    expect(await screen.findByRole("progressbar", { name: "试运行进度" })).toBeInTheDocument();
    expect(repository.startSkillDryRun).toHaveBeenCalledTimes(2);
    expect(repository.startSkillDryRun).toHaveBeenLastCalledWith("skill");
    expect(repository.getSkillDryRun).toHaveBeenCalledWith("skill", "retry-run");
  });
});
