import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RiskPicker } from "./RiskPicker";

afterEach(() => {
  cleanup();
});

describe("RiskPicker", () => {
  it("renders three levels and the active value", () => {
    render(<RiskPicker value="High" onChange={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /高/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /中/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: /低/ })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange when a level is clicked", () => {
    const onChange = vi.fn();
    render(<RiskPicker value="High" onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /中/ }));

    expect(onChange).toHaveBeenCalledWith("Medium");
  });

  it("supports arrow-key navigation", () => {
    const onChange = vi.fn();
    render(<RiskPicker value="High" onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("radiogroup", { name: "风险" }), { key: "ArrowRight" });

    expect(onChange).toHaveBeenCalledWith("Medium");
  });
});
