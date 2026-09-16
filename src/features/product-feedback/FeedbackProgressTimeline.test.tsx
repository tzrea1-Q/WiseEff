import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProductFeedbackProgressEvent } from "@/domain/productFeedback/types";
import { FeedbackProgressTimeline } from "./FeedbackProgressTimeline";

describe("FeedbackProgressTimeline", () => {
  const sampleEvents: ProductFeedbackProgressEvent[] = [
    {
      id: "evt-1",
      feedbackId: "fb-1",
      kind: "submitted",
      toStatus: "open",
      createdAt: "2026-07-08T08:00:00.000Z"
    },
    {
      id: "evt-2",
      feedbackId: "fb-1",
      kind: "status_changed",
      fromStatus: "open",
      toStatus: "in_progress",
      publicMessage: "已转交前端团队处理",
      internalMessage: "涉及虚拟列表重构",
      createdAt: "2026-07-08T09:00:00.000Z"
    },
    {
      id: "evt-3",
      feedbackId: "fb-1",
      kind: "status_changed",
      fromStatus: "in_progress",
      toStatus: "resolved",
      resolutionCode: "completed",
      publicMessage: "已在 v2.5.1 修复",
      createdAt: "2026-07-08T10:00:00.000Z"
    }
  ];

  it("renders empty message when events list is empty", () => {
    render(<FeedbackProgressTimeline events={[]} />);
    expect(screen.getByText("暂无进展记录。")).toBeInTheDocument();
  });

  it("user mode: hides internalMessage and renders publicMessage", () => {
    render(<FeedbackProgressTimeline events={sampleEvents} isAdmin={false} />);

    expect(screen.getByText("反馈已提交")).toBeInTheDocument();
    expect(screen.getByText("状态变更：待处理 → 处理中")).toBeInTheDocument();
    expect(screen.getByText("已转交前端团队处理")).toBeInTheDocument();
    expect(screen.queryByText("涉及虚拟列表重构")).not.toBeInTheDocument();
    expect(screen.getByText("解决结论：")).toBeInTheDocument();
    expect(screen.getByText("已在 v2.5.1 修复")).toBeInTheDocument();
  });

  it("admin mode: displays both publicMessage and internalMessage", () => {
    render(<FeedbackProgressTimeline events={sampleEvents} isAdmin={true} />);

    expect(screen.getByText("已转交前端团队处理")).toBeInTheDocument();
    expect(screen.getByText("涉及虚拟列表重构")).toBeInTheDocument();
    expect(screen.getByText("内部备注:")).toBeInTheDocument();
  });
});
