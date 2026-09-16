import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedbackStatusBadge, getFeedbackDisplayStatus } from "./FeedbackStatusBadge";

describe("FeedbackStatusBadge", () => {
  it("determines draft status when submittedAt is null or undefined", () => {
    expect(getFeedbackDisplayStatus({ status: "open", submittedAt: null })).toBe("draft");
    expect(getFeedbackDisplayStatus({ status: "open", submittedAt: undefined })).toBe("draft");
    expect(getFeedbackDisplayStatus({ status: "open", submittedAt: "2026-07-08T00:00:00.000Z" })).toBe("open");
  });

  it("renders status badges correctly", () => {
    const { rerender } = render(<FeedbackStatusBadge status="draft" />);
    expect(screen.getByText("草稿")).toBeInTheDocument();

    rerender(<FeedbackStatusBadge status="open" />);
    expect(screen.getByText("待处理")).toBeInTheDocument();

    rerender(<FeedbackStatusBadge status="in_progress" />);
    expect(screen.getByText("处理中")).toBeInTheDocument();

    rerender(<FeedbackStatusBadge status="resolved" resolutionCode="completed" />);
    expect(screen.getByText("已解决 · 已解决")).toBeInTheDocument();

    rerender(<FeedbackStatusBadge status="closed" resolutionCode="duplicate" />);
    expect(screen.getByText("已关闭 · 重复反馈")).toBeInTheDocument();
  });
});
