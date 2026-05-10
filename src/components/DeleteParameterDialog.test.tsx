import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeleteParameterDialog } from "./DeleteParameterDialog";

afterEach(() => {
  cleanup();
});

describe("DeleteParameterDialog", () => {
  it("renders parameter name and project usage", () => {
    render(
      <DeleteParameterDialog
        open
        parameterName="fast_charge_current_limit_ma"
        usedByProjects={["AUR-Prod", "NEB-RD", "ATL-Intl"]}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    expect(screen.getByText(/fast_charge_current_limit_ma/)).toBeInTheDocument();
    expect(screen.getByText(/AUR-Prod/)).toBeInTheDocument();
    expect(screen.getByText(/NEB-RD/)).toBeInTheDocument();
  });

  it("renders orphan copy when no projects use the parameter", () => {
    render(<DeleteParameterDialog open parameterName="orphan_p" usedByProjects={[]} onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByText(/孤儿/)).toBeInTheDocument();
  });

  it("confirms, cancels, and closes on Escape", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<DeleteParameterDialog open parameterName="p" usedByProjects={[]} onCancel={onCancel} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: /确认删除/ }));
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
