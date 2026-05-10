import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComparisonMetrics } from "../components/ComparisonMetrics";

describe("ComparisonMetrics", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders three summary cards", () => {
    render(<ComparisonMetrics total={12} drift={5} synced={7} highRisk={2} onShowDrift={() => undefined} onShowHighRisk={() => undefined} />);

    expect(screen.getByText("对比范围")).toBeInTheDocument();
    expect(screen.getByText("漂移参数")).toBeInTheDocument();
    expect(screen.getByText("高重要性差异")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("fires filter shortcuts from metric cards", () => {
    const onShowDrift = vi.fn();
    const onShowHighRisk = vi.fn();
    render(<ComparisonMetrics total={12} drift={5} synced={7} highRisk={2} onShowDrift={onShowDrift} onShowHighRisk={onShowHighRisk} />);

    fireEvent.click(screen.getByRole("button", { name: /漂移参数/ }));
    fireEvent.click(screen.getByRole("button", { name: /高重要性差异/ }));

    expect(onShowDrift).toHaveBeenCalledTimes(1);
    expect(onShowHighRisk).toHaveBeenCalledTimes(1);
  });

  it("disables high-risk shortcut when there are no high risk rows", () => {
    render(<ComparisonMetrics total={12} drift={5} synced={7} highRisk={0} onShowDrift={() => undefined} onShowHighRisk={() => undefined} />);

    expect(screen.getByRole("button", { name: /高重要性差异/ })).toBeDisabled();
  });
});
