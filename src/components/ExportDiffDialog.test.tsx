import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDiffDialog } from "./ExportDiffDialog";

const defaultDiff = {
  added: 1,
  updated: 2,
  deleted: 0,
  affectedParameters: [
    { name: "new-p", kind: "added" as const },
    { name: "fast_charge", kind: "updated" as const },
    { name: "charge_voltage", kind: "updated" as const }
  ]
};

afterEach(() => {
  cleanup();
});

describe("ExportDiffDialog", () => {
  it("renders added, updated, and deleted counts", () => {
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText(/新增参数：1/)).toBeInTheDocument();
    expect(screen.getByText(/更新.*2/)).toBeInTheDocument();
    expect(screen.getByText(/删除.*0/)).toBeInTheDocument();
  });

  it("calls confirm and cancel callbacks", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={onConfirm} onCancel={onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: /确认导出/ }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape", () => {
    const onCancel = vi.fn();
    render(<ExportDiffDialog open diff={defaultDiff} onConfirm={vi.fn()} onCancel={onCancel} />);

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    const { container } = render(<ExportDiffDialog open={false} diff={defaultDiff} onConfirm={vi.fn()} onCancel={vi.fn()} />);

    expect(container.firstChild).toBeNull();
  });
});
