import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { DtsReleaseReadiness } from "@/application/ports/DtsStructuredRepository";
import {
  WorkbenchReleaseReadinessIssues,
  WorkbenchReleaseReadinessSummary,
  workbenchReadinessAllowsCreate,
  workbenchReadinessAllowsRelease
} from "./WorkbenchReleaseReadiness";

function readiness(overrides: Partial<DtsReleaseReadiness> = {}): DtsReleaseReadiness {
  return {
    available: true,
    level: "ready",
    blockers: [],
    warnings: [],
    gateToken: "gate-1",
    evaluatedAt: "2026-08-07T00:00:00.000Z",
    configSetId: "cs-1",
    projectId: "project-1",
    canCreateBaseline: true,
    canRelease: true,
    ...overrides
  };
}

describe("WorkbenchReleaseReadiness", () => {
  it("does not invent create/release permission from client session counts alone", () => {
    const blocked = readiness({
      level: "blocked",
      canCreateBaseline: false,
      canRelease: false,
      blockers: [
        {
          id: "open-conflict:1",
          severity: "blocker",
          code: "open-conflict",
          message: "conflict",
          remediation: { kind: "resolve-conflict", label: "Resolve" }
        }
      ]
    });
    expect(workbenchReadinessAllowsCreate(blocked, false)).toBe(false);
    expect(workbenchReadinessAllowsRelease(readiness(), true)).toBe(false);
    expect(workbenchReadinessAllowsCreate(readiness(), false)).toBe(true);
  });

  it("renders authoritative summary and opens issues on click", () => {
    const onOpenIssues = vi.fn();
    render(
      <WorkbenchReleaseReadinessSummary
        readiness={readiness({
          level: "blocked",
          canCreateBaseline: false,
          canRelease: false,
          blockers: [
            {
              id: "b1",
              severity: "blocker",
              code: "open-conflict",
              message: "open",
              remediation: { kind: "resolve-conflict", label: "Resolve" }
            }
          ]
        })}
        loading={false}
        error=""
        localSessionDirty
        onRetry={vi.fn()}
        onOpenIssues={onOpenIssues}
      />
    );
    expect(screen.getByLabelText("配置版本状态")).toHaveAttribute("data-level", "blocked");
    expect(screen.getByText("有未提交变更")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /有未提交变更/ }));
    expect(onOpenIssues).toHaveBeenCalled();
  });

  it("labels read-only version browsing without reporting unavailable admin checks", () => {
    render(<WorkbenchReleaseReadinessSummary readiness={null} loading={false} error="" localSessionDirty={false}
      readOnly onRetry={vi.fn()} onOpenIssues={vi.fn()} />);
    expect(screen.getByRole("button", { name: /配置版本.*只读/ })).toBeEnabled();
    expect(screen.getByLabelText("配置版本状态")).toHaveAttribute("data-can-create", "false");
    expect(screen.getByLabelText("配置版本状态")).toHaveAttribute("data-can-release", "false");
    expect(screen.queryByText("检查不可用")).not.toBeInTheDocument();
  });

  it("shows a clean baseline result without zero counts or a global release claim", () => {
    render(<WorkbenchReleaseReadinessSummary readiness={readiness()} loading={false} error="" localSessionDirty={false} onRetry={vi.fn()} onOpenIssues={vi.fn()} />);
    expect(screen.getByRole("button", { name: /配置版本.*检查通过/ })).toHaveAttribute("data-variant", "outline");
    expect(screen.queryByText(/0.*阻断|0.*警告|可发布/)).not.toBeInTheDocument();
  });

  it.each([{ loading: true, error: "", label: "检查中…" }, { loading: false, error: "网络异常", label: "检查不可用" }])(
    "keeps one release entry and fails closed while $label", ({ loading, error, label }) => {
      const onOpenIssues = vi.fn();
      render(<WorkbenchReleaseReadinessSummary readiness={readiness()} loading={loading} error={error}
        localSessionDirty={false} onRetry={vi.fn()} onOpenIssues={onOpenIssues} />);
      expect(screen.getAllByRole("button")).toHaveLength(1);
      expect(screen.getByLabelText("配置版本状态")).toHaveAttribute("data-can-release", "false");
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`配置版本.*${label}`) }));
      expect(onOpenIssues).toHaveBeenCalledOnce();
    });

  it("never presents local changes as ready even when the server baseline check passed", () => {
    render(<WorkbenchReleaseReadinessSummary readiness={readiness()} loading={false} error="" localSessionDirty onRetry={vi.fn()} onOpenIssues={vi.fn()} />);
    expect(screen.getByLabelText("配置版本状态")).toHaveAttribute("data-can-release", "false");
    expect(screen.getByText("有未提交变更")).toBeInTheDocument();
    expect(screen.queryByText("检查通过")).not.toBeInTheDocument();
  });

  it("lists ordered issues and supports warning acknowledgement + locate", () => {
    const onSelect = vi.fn();
    const onAck = vi.fn();
    render(
      <WorkbenchReleaseReadinessIssues
        readiness={readiness({
          level: "warning",
          canRelease: false,
          warnings: [
            {
              id: "w1",
              severity: "warning",
              code: "toolchain-warning",
              message: "请核对 DTS 校验警告。",
              acknowledgementRequired: true,
              remediation: { kind: "acknowledge-warning", label: "确认警告" },
              target: { fileId: "file-1", nodePath: "/board", propertyName: "model" }
            }
          ]
        })}
        acknowledgedWarningIds={new Set()}
        onAcknowledgeWarning={onAck}
        onSelectIssue={onSelect}
        onRetry={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /请核对 DTS 校验警告/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    fireEvent.click(screen.getByLabelText("确认警告 请核对 DTS 校验警告。"));
    expect(onAck).toHaveBeenCalledWith("w1");
  });

  it("presents an English toolchain remediation in product language", () => {
    render(<WorkbenchReleaseReadinessIssues readiness={readiness({ blockers: [{ id: "tool", severity: "blocker",
      code: "hard-validation-error", message: "DTS 校验工具不可用，请联系管理员。",
      remediation: { kind: "fix-validation", label: "Fix or restore validation toolchain" } }] })}
      acknowledgedWarningIds={new Set()} onAcknowledgeWarning={vi.fn()} onSelectIssue={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getAllByText("DTS 校验工具不可用，请联系管理员。")).toHaveLength(2);
    expect(screen.queryByText(/Fix or restore/)).not.toBeInTheDocument();
  });

  it("shows a warning as text when no location or review destination exists", () => {
    const onAck = vi.fn();
    render(<WorkbenchReleaseReadinessIssues readiness={readiness({ warnings: [{ id: "warning", severity: "warning",
      code: "toolchain-warning", message: "需确认工具链提示", acknowledgementRequired: true,
      remediation: { kind: "acknowledge-warning", label: "确认后继续" } }] })}
      acknowledgedWarningIds={new Set()} onAcknowledgeWarning={onAck} onSelectIssue={vi.fn()} onRetry={vi.fn()} />);
    expect(screen.getByText("需确认工具链提示")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("确认警告 需确认工具链提示"));
    expect(onAck).toHaveBeenCalledWith("warning");
  });
});
