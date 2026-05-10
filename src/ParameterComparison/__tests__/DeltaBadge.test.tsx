import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeltaBadge } from "../components/DeltaBadge";

describe("DeltaBadge", () => {
  it("renders synced state", () => {
    render(<DeltaBadge delta={{ kind: "synced" }} />);

    expect(screen.getByText("已同步")).toHaveAttribute("data-tone", "synced");
  });

  it("renders positive percentage deltas", () => {
    render(<DeltaBadge delta={{ kind: "percent", percent: 9.09, direction: "up" }} />);

    expect(screen.getByText("+9.1%")).toHaveAttribute("data-tone", "warn");
  });

  it("renders negative percentage deltas", () => {
    render(<DeltaBadge delta={{ kind: "percent", percent: -15, direction: "down" }} />);

    expect(screen.getByText("-15.0%")).toHaveAttribute("data-tone", "ease");
  });

  it("renders absolute deltas with unit", () => {
    render(<DeltaBadge delta={{ kind: "absolute", amount: 30, unit: "mV", direction: "up" }} />);

    expect(screen.getByText("+30 mV")).toBeInTheDocument();
  });

  it("renders changed enum deltas", () => {
    render(<DeltaBadge delta={{ kind: "changed" }} />);

    expect(screen.getByText("已变更")).toHaveAttribute("data-tone", "changed");
  });

  it("renders new and missing states", () => {
    const { rerender } = render(<DeltaBadge delta={{ kind: "new" }} />);
    expect(screen.getByText("新增")).toHaveAttribute("data-tone", "new");

    rerender(<DeltaBadge delta={{ kind: "missing" }} />);
    expect(screen.getByText("缺失")).toHaveAttribute("data-tone", "missing");
  });
});
