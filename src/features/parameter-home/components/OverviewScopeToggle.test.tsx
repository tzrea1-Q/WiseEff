import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OverviewScopeToggle } from "./OverviewScopeToggle";

describe("OverviewScopeToggle", () => {
  it("calls onScopeChange with overall when 整体 is clicked", () => {
    const onScopeChange = vi.fn();
    render(<OverviewScopeToggle scope="personal" onScopeChange={onScopeChange} />);
    expect(screen.getByRole("radiogroup", { name: "概览视角" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "个人" })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: "整体" }));
    expect(onScopeChange).toHaveBeenCalledWith("overall");
  });
});
