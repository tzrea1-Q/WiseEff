import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ComparisonEmptyState } from "../components/EmptyStates";

describe("ComparisonEmptyState", () => {
  it("renders the all-synced message", () => {
    render(<ComparisonEmptyState kind="all-synced" />);

    expect(screen.getByRole("heading", { name: "项目参数已同步" })).toBeInTheDocument();
    expect(screen.getByText("当前项目组合没有发现漂移参数。")).toBeInTheDocument();
  });

  it("lets users clear filters when no results match", () => {
    const onReset = vi.fn();
    render(<ComparisonEmptyState kind="filtered" onReset={onReset} />);

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
