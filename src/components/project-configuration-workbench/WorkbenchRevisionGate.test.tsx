import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { selectControlOption } from "@/test/selectControlOption";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfigRevisionGateSession, type ConfigRevisionGateSnapshot } from "@/application/project-configuration/configRevisionGateSession";
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
  it("lists product labels and validates the selected listed id", async () => {
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

    expect(screen.getByRole("combobox", { name: "配置修订" })).toHaveAttribute("data-value", "rev-cs-2");
    expect(screen.getByRole("combobox", { name: "配置修订" })).toHaveTextContent("修订 2 · 已解析");
    expect(screen.queryByText("revision-teaching-1")).not.toBeInTheDocument();
    await selectControlOption(screen.getByRole("combobox", { name: "配置修订" }), "rev-cs-1");
    expect(onSelect).toHaveBeenCalledWith("rev-cs-1");
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
    expect(screen.getByRole("status")).toHaveTextContent("尚无配置修订。添加来源文件并完成解析后，可在这里校验。");
    expect(screen.queryByRole("combobox", { name: "配置修订" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "校验修订" })).toBeDisabled();
  });

  it("renders the sole automatically selected revision read-only and validates its real id", async () => {
    const session = createConfigRevisionGateSession();
    const revision = snapshot().revisions[0]!;
    await session.load("project-1", "cs-1", { listConfigRevisions: async () => [revision] });
    const validateRevision = vi.fn(async () => ({ id: "run-1", status: "passed" as const, stage: "toolchain" as const }));
    const props = { snapshot: session.getSnapshot(), canAdmin: true, onSelect: vi.fn(), onRetry: vi.fn(),
      onValidate: () => { void session.validate("project-1", { validateRevision }); } };
    const { rerender } = render(<WorkbenchRevisionGate {...props} />);
    expect(session.selectedRevisionId).toBe(revision.id);
    expect(screen.getByText("修订 2 · 已解析")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "配置修订" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "校验修订" }));
    expect(validateRevision).toHaveBeenCalledWith("project-1", revision.id);
    await waitFor(() => expect(session.lastRun?.id).toBe("run-1"));
    expect(props.onSelect).not.toHaveBeenCalled();
    rerender(<WorkbenchRevisionGate {...props} canAdmin={false} />);
    expect(screen.getByRole("button", { name: "校验修订" })).toBeDisabled();
    rerender(<WorkbenchRevisionGate {...props} snapshot={{ ...props.snapshot, validating: true }} />);
    expect(screen.getByRole("button", { name: "校验中…" })).toBeDisabled();
  });

  it("keeps revision load failures retryable without an empty selector", () => {
    const onRetry = vi.fn();
    render(<WorkbenchRevisionGate snapshot={snapshot({ revisions: [], selectedRevisionId: null, error: "修订加载失败" })}
      canAdmin onSelect={vi.fn()} onValidate={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("修订加载失败");
    expect(screen.queryByRole("combobox", { name: "配置修订" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "校验修订" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
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
