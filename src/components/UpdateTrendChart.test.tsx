import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateTrendChart } from "./UpdateTrendChart";
import type { UpdateTrendPoint } from "../parameterHomepageAnalytics";

afterEach(() => {
  cleanup();
});

const sampleSeries: UpdateTrendPoint[] = [
  { label: "5/4", value: 2, date: "2026-05-04T00:00:00.000Z" },
  { label: "5/5", value: 5, date: "2026-05-05T00:00:00.000Z" },
  { label: "5/6", value: 4, date: "2026-05-06T00:00:00.000Z" },
  { label: "5/7", value: 7, date: "2026-05-07T00:00:00.000Z" },
  { label: "5/8", value: 3, date: "2026-05-08T00:00:00.000Z" },
  { label: "5/9", value: 6, date: "2026-05-09T00:00:00.000Z" },
  { label: "5/10", value: 8, date: "2026-05-10T00:00:00.000Z" }
];

describe("UpdateTrendChart", () => {
  it("renders one dot per data point when in 7d mode", () => {
    render(<UpdateTrendChart series={sampleSeries} timeWindow="7d" />);
    expect(document.querySelectorAll('[data-testid="update-trend-dot"]').length).toBe(
      sampleSeries.length
    );
  });

  it("hides per-point dots in 30d mode", () => {
    const series: UpdateTrendPoint[] = Array.from({ length: 30 }, (_, index) => ({
      label: `5/${index + 1}`,
      value: index % 5,
      date: `2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`
    }));
    render(<UpdateTrendChart series={series} timeWindow="30d" />);
    expect(document.querySelectorAll('[data-testid="update-trend-dot"]').length).toBe(0);
  });

  it("shows a tooltip after hovering the overlay", () => {
    render(<UpdateTrendChart series={sampleSeries} timeWindow="7d" />);
    const overlay = document.querySelector(
      '[data-testid="update-trend-overlay"]'
    ) as SVGRectElement;
    expect(overlay).toBeTruthy();
    fireEvent.mouseMove(overlay, { clientX: 300, clientY: 100 });
    expect(screen.getByTestId("update-trend-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("update-trend-tooltip")).toHaveTextContent("更新");
  });

  it("renders first, middle, and last X-axis labels", () => {
    render(<UpdateTrendChart series={sampleSeries} timeWindow="7d" />);
    expect(screen.getByText(sampleSeries[0].label)).toBeInTheDocument();
    expect(screen.getByText(sampleSeries[sampleSeries.length - 1].label)).toBeInTheDocument();
  });

  it("renders a polyline path for the series", () => {
    render(<UpdateTrendChart series={sampleSeries} timeWindow="7d" />);
    const polyline = document.querySelector('[data-testid="update-trend-line"]');
    expect(polyline).toBeTruthy();
  });
});
