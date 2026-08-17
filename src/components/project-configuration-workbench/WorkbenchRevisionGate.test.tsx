import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigRevisionGateSnapshot } from "@/application/project-configuration/configRevisionGateSession";
import { WorkbenchRevisionGate } from "./WorkbenchRevisionGate";

afterEach(() => cleanup());

function snapshot(overrides: Partial<ConfigRevisionGateSnapshot> = {}): ConfigRevisionGateSnapshot {
  return {
    revisions: [
      {
        id: "rev-cs-2",
        configSetId: "cs-1",
        revisionNumber: 2,
        status: "resolved",
        createdAt: "2026-08-17T10:00:00.000Z"
      },
      {
        id: "rev-cs-1",
        configSetId: "cs-1",
        revisionNumber: 1,
        status: "validated",
        createdAt: "2026-08-16T10:00:00.000Z"
      }
    ],
    loading: false,
    error: "",
    selectedRevisionId: "rev-cs-2",
    validating: false,
    lastRun: null,
    requiresConfirmation: false,
    actionError: "",
    ...overrides
  };
}

describe("WorkbenchRevisionGate", () => {
  it("lists product labels and validates the selected listed id", () => {
    const onSelect = vi.fn();
    const onValidate = vi.fn();
    render(
      <WorkbenchRevisionGate
        snapshot={snapshot()}
        canAdmin
        onSelect={onSelect}
        onValidate={onValidate}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole("combobox", { name: "配置修订" })).toHaveValue("rev-cs-2");
    expect(screen.getByRole("option", { name: "修订 2 · 已解析" })).toBeInTheDocument();
    expect(screen.queryByText("revision-teaching-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "校验修订" }));
    expect(onValidate).toHaveBeenCalled();
  });

  it("shows an empty next-step when no revisions are listed", () => {
    render(
      <WorkbenchRevisionGate
        snapshot={snapshot({ revisions: [], selectedRevisionId: null })}
        canAdmin
        onSelect={vi.fn()}
        onValidate={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("尚未生成配置修订");
    expect(screen.getByRole("button", { name: "校验修订" })).toBeDisabled();
  });

  it("disables validate for non-admin viewers with a product reason", () => {
    render(
      <WorkbenchRevisionGate
        snapshot={snapshot()}
        canAdmin={false}
        onSelect={vi.fn()}
        onValidate={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "校验修订" })).toHaveAttribute(
      "title",
      "仅管理员可以校验配置修订。"
    );
  });

  it("surfaces requiresConfirmation in product language", () => {
    render(
      <WorkbenchRevisionGate
        snapshot={snapshot({
          lastRun: {
            id: "run-soft",
            status: "passed",
            stage: "toolchain",
            requiresConfirmation: true
          },
          requiresConfirmation: true
        })}
        canAdmin
        onSelect={vi.fn()}
        onValidate={vi.fn()}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("修订校验未硬性通过，发布前需确认该风险。");
  });
});
