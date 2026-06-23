import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchiveDebugParameterDialog } from "./ArchiveDebugParameterDialog";

describe("ArchiveDebugParameterDialog", () => {
  it("renders archive copy and actions", () => {
    render(
      <ArchiveDebugParameterDialog
        open
        parameterName="debug.fast_charge_limit"
        loading={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("dialog", { name: /归档参数/ })).toBeInTheDocument();
    expect(screen.getByText(/运行时下发清单中隐藏/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "归档" })).toBeInTheDocument();
  });

  it("calls onConfirm when archiving", () => {
    const onConfirm = vi.fn();
    render(
      <ArchiveDebugParameterDialog
        open
        parameterName="debug.fast_charge_limit"
        loading={false}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
