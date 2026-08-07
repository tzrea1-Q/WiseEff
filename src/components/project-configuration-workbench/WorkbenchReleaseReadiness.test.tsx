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
    expect(screen.getByLabelText("发布就绪")).toHaveAttribute("data-level", "blocked");
    expect(screen.getByText("本机会话未保存")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /已阻断/ }));
    expect(onOpenIssues).toHaveBeenCalled();
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
              message: "dtc advisory",
              acknowledgementRequired: true,
              remediation: { kind: "acknowledge-warning", label: "Acknowledge" },
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
    fireEvent.click(screen.getByRole("button", { name: /dtc advisory/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "w1" }));
    fireEvent.click(screen.getByLabelText("确认警告 dtc advisory"));
    expect(onAck).toHaveBeenCalledWith("w1");
  });
});
