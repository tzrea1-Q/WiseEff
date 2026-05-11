import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MetricBentoCard } from "./MetricBentoCard";

describe("MetricBentoCard", () => {
  const sparkProps = {
    label: "今日分析",
    value: "42",
    variant: "spark" as const,
    data: [3, 5, 8, 12, 7, 10, 14]
  };

  it("renders label and value", () => {
    render(<MetricBentoCard {...sparkProps} />);

    expect(screen.getByText("今日分析")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders caption if provided", () => {
    render(<MetricBentoCard {...sparkProps} caption="较昨日 +18%" />);

    expect(screen.getByText("较昨日 +18%")).toBeInTheDocument();
  });

  it("renders trend up indicator", () => {
    render(<MetricBentoCard {...sparkProps} trend={{ direction: "up", text: "+12%" }} />);

    expect(screen.getByText("+12%")).toBeInTheDocument();
  });

  it("renders SVG sparkline for spark variant", () => {
    const { container } = render(<MetricBentoCard {...sparkProps} />);
    const svg = container.querySelector("svg");

    expect(svg).toBeInTheDocument();
    expect(svg?.querySelector("polyline, path")).toBeInTheDocument();
  });

  it("renders radial ring for radial variant", () => {
    const { container } = render(<MetricBentoCard label="置信度" value="91%" variant="radial" percent={91} />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("circle")).toBeInTheDocument();
  });

  it("renders pulse badge for pulse variant", () => {
    render(<MetricBentoCard label="失败" value="1" variant="pulse" severity="error" />);

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders peak bars for peak variant", () => {
    const { container } = render(
      <MetricBentoCard label="峰值" value="1.2GB" variant="peak" data={[2, 4, 5, 9, 12, 8, 3]} />
    );
    const bars = container.querySelectorAll("[data-peak-bar], rect");

    expect(bars.length).toBeGreaterThan(0);
  });

  it("triggers onClick when clickable", async () => {
    const onClick = vi.fn();

    render(<MetricBentoCard {...sparkProps} onClick={onClick} />);
    await userEvent.click(screen.getByRole("button"));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("applies aria-pressed when active and onClick provided", () => {
    const onClick = vi.fn();

    render(<MetricBentoCard {...sparkProps} onClick={onClick} active />);

    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("renders as non-interactive div when onClick not provided", () => {
    const { container } = render(<MetricBentoCard {...sparkProps} />);

    expect(container.querySelector('[role="button"]')).not.toBeInTheDocument();
  });

  it("is keyboard accessible when clickable", async () => {
    const onClick = vi.fn();

    render(<MetricBentoCard {...sparkProps} onClick={onClick} />);
    const button = screen.getByRole("button");
    button.focus();
    await userEvent.keyboard("{Enter}");

    expect(onClick).toHaveBeenCalled();
  });
});
