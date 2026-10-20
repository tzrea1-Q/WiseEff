import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DtsReloadCandidate, DtsReloadRun, DtsReloadRunListItem } from "@/domain/dtsReload/types";
import { DeployConfirmBody, formatAttemptedAt, ReloadSnapshotSummary, RunHistorySection, RunResultSection } from "./dtsReloadPresentation";

const candidates = [{ bindingId: "binding-1", propertyKey: "fcp_support", displayName: "FCP 支持" }] as DtsReloadCandidate[];
const run: DtsReloadRun = {
  id: "run-1", projectId: "project-1", configRevisionId: null, status: "validated", purpose: "ordinary", failureCode: null,
  targets: [{ bindingId: "binding-1", propertyKey: "fcp_support", nodePath: "/charger", baselineValue: "<0>", debugValue: "<1>" }],
  steps: [{ step: "compile-overlay", outcome: "passed" }], diagnostics: [], toolVersions: { dtc: null, fdtoverlay: null },
  overlaySource: "/dts-v1/;", overlaySourceSha256: "source-hash", artifact: { fileName: "long-generated-compiled-overlay.dtbo", sha256: "full-hash", sizeBytes: 12 },
  createdAt: "2026-10-15T12:34:56Z", completedAt: "2026-10-15T12:34:56Z"
};

describe("DTS reload result presentation", () => {
  it("preserves complete multiline values in deployment confirmation and device verification", () => {
    const baselineValue = `first ${"a".repeat(300)}\nsecond baseline\nthird baseline`;
    const debugValue = `first ${"b".repeat(300)}\nsecond target\nthird target`;
    const target = { ...run.targets[0], baselineValue, debugValue };
    const view = render(<DeployConfirmBody run={{ ...run, targets: [target] }} deviceId="device-1" targetRef="target-1" bridgeMachineLabel="Lab PC" residue={null} />);
    expect(screen.getByRole("region", { name: "fcp_support 库基线" }).textContent).toBe(baselineValue);
    expect(screen.getByRole("region", { name: "fcp_support 调试值" }).textContent).toBe(debugValue);
    view.rerender(<ReloadSnapshotSummary snapshot={{ libraryBaselines: [], artifactDigest: null, kernelSignal: null,
      behaviouralVerification: { outcomes: [{ bindingId: target.bindingId, propertyKey: target.propertyKey, outcome: "contradicted", debugNodeId: "node-1", nodePath: "/charger", expectedValue: debugValue, readValue: baselineValue, reason: null }] } }} />);
    const readback = screen.getByRole("region", { name: "fcp_support 读回值" });
    const expected = screen.getByRole("region", { name: "fcp_support 期望值" });
    expect(readback.textContent).toBe(baselineValue);
    expect(expected.textContent).toBe(debugValue);
    expect(readback).toHaveAttribute("tabindex", "0");
    expect(expected).toHaveAttribute("tabindex", "0");
  });

  it("leads with actionable status and parameter changes while keeping technical evidence folded", () => {
    render(<RunResultSection run={run} candidates={candidates} deviceId="" targetRef="" canStartRun canRetryDeploy deployReady={false} deploying={false} onDownload={vi.fn()} onDeploy={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("预检已通过。请先连接 Bridge");
    expect(within(screen.getByRole("region", { name: "本次参数变更" })).getByText("FCP 支持")).toBeVisible();
    expect(screen.getByText("Overlay 源码").closest("details")).not.toHaveAttribute("open");
    expect(screen.getByText("full-hash", { exact: false }).closest("details")).not.toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "下载编译产物" })).toHaveAttribute("title", run.artifact!.fileName);
    expect(screen.getByRole("button", { name: "部署到设备" })).toBeDisabled();
  });

  it("shows history detail loading, Chinese names, and the shared Chinese date format", () => {
    const item: DtsReloadRunListItem = { id: run.id, projectId: run.projectId, deviceId: null, status: run.status, purpose: run.purpose,
      failureCode: null, targetCount: 1, propertyKeys: ["fcp_support"], artifact: run.artifact, integrityCheck: null, createdAt: run.createdAt, completedAt: run.completedAt };
    render(<RunHistorySection historyItems={[item]} candidates={candidates} historyLoading={false} historyLoadingMore={false} historyRunLoading historyError="" historyNextCursor={null} historyFilterDevice={false} deviceId="" activeRunId={run.id} onFilterDeviceChange={vi.fn()} onOpenRun={vi.fn()} onLoadMore={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("正在加载运行详情…")).toBeInTheDocument();
    expect(screen.getByText("正在加载运行详情…").parentElement).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTitle("fcp_support")).toHaveTextContent("FCP 支持");
    expect(formatAttemptedAt("invalid-date")).toBe("invalid-date");
    expect(formatAttemptedAt(run.createdAt)).toMatch(/2026\/10\/15/);
  });
});
