import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionError, SectionEmpty, SectionSkeleton } from "./SectionState";

describe("SectionState", () => {
  it("skeleton exposes busy status", () => {
    render(<SectionSkeleton label="加载趋势" />);
    expect(screen.getByRole("status")).toHaveTextContent("加载趋势");
  });

  it("empty shows guidance", () => {
    render(<SectionEmpty message="暂无数据" />);
    expect(screen.getByText("暂无数据")).toBeInTheDocument();
  });

  it("error triggers retry", () => {
    const onRetry = vi.fn();
    render(<SectionError message="加载失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
