import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KpiStrip, type KpiItem } from "./KpiStrip";

afterEach(() => {
  cleanup();
});

function sampleItems(): KpiItem[] {
  return [
    { id: "shared", label: "共享参数", value: 10 },
    { id: "high-risk", label: "高风险", value: 4, interactive: true, onClick: vi.fn(), tone: "warning" },
    { id: "today", label: "今日变更", value: 3, interactive: true, onClick: vi.fn() },
    { id: "orphan", label: "闲置参数", value: 2, interactive: true, onClick: vi.fn(), tone: "warning" },
    { id: "last-import", label: "最近导入", value: "2h 前", interactive: true, onClick: vi.fn() }
  ];
}

describe("KpiStrip", () => {
  it("renders labels and values", () => {
    render(<KpiStrip items={sampleItems()} />);

    expect(screen.getByText("共享参数")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("高风险")).toBeInTheDocument();
    expect(screen.getByText("闲置参数")).toBeInTheDocument();
    expect(screen.getByText("2h 前")).toBeInTheDocument();
  });

  it("renders interactive items as buttons", () => {
    const items = sampleItems();
    render(<KpiStrip items={items} />);

    fireEvent.click(screen.getByRole("button", { name: /高风险 4/ }));

    expect(items[1].onClick).toHaveBeenCalledTimes(1);
  });

  it("renders non-interactive items as divs", () => {
    render(<KpiStrip items={sampleItems()} />);

    expect(screen.getByText("共享参数").closest(".kpi-item")?.tagName).toBe("DIV");
  });

  it("sets the tone attribute", () => {
    render(<KpiStrip items={sampleItems()} />);

    expect(screen.getByRole("button", { name: /闲置参数/ })).toHaveAttribute("data-tone", "warning");
  });
});
