import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchPageToggle } from "./WorkbenchPageToggle";

describe("WorkbenchPageToggle", () => {
  it("switches between overview and hotspots pages", () => {
    const onPageChange = vi.fn();
    render(<WorkbenchPageToggle page="overview" hotspotCount={3} onPageChange={onPageChange} />);

    expect(screen.getByRole("group", { name: "工作台视图" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "热榜" }));
    expect(onPageChange).toHaveBeenCalledWith("hotspots");
  });

  it("does not present an unavailable hotspot query as zero", () => {
    const { rerender } = render(
      <WorkbenchPageToggle
        page="overview"
        hotspotCount={0}
        hotspotStatus="loading"
        onPageChange={vi.fn()}
      />
    );
    expect(screen.getByText("加载中")).toBeInTheDocument();

    rerender(
      <WorkbenchPageToggle
        page="overview"
        hotspotCount={0}
        hotspotStatus="error"
        onPageChange={vi.fn()}
      />
    );
    expect(screen.getByText("不可用")).toBeInTheDocument();
  });
});
