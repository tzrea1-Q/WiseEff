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
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps one useful empty-state action and the shared icon", () => {
    const onAction = vi.fn();
    const { container } = render(<SectionEmpty title="暂无项目" message="请先创建项目。" actionLabel="新建项目" onAction={onAction} />);
    expect(screen.getByText("暂无项目")).toBeInTheDocument();
    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(container.querySelector('[data-slot="empty-icon"] svg')).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "新建项目" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("error triggers retry", () => {
    const onRetry = vi.fn();
    render(<SectionError message="加载失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
