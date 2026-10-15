import { fireEvent, render, screen } from "@testing-library/react";
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

  it("labels submitter replies and renders submitted messages only once", () => {
    render(<FeedbackProgressTimeline events={[
      { ...sampleEvents[0], publicMessage: "反馈已提交" },
      { ...sampleEvents[1], kind: "progress", author: "submitter", publicMessage: "补充复现步骤", internalMessage: null }
    ]} />);
    expect(screen.getAllByText("反馈已提交")).toHaveLength(1);
    expect(screen.getByText("提交人补充")).toBeInTheDocument();
    expect(screen.getByText("补充复现步骤")).toBeInTheDocument();
  });

  it("user mode: hides internalMessage and renders publicMessage", () => {
    render(<FeedbackProgressTimeline events={sampleEvents} isAdmin={false} />);

    expect(screen.getByText("反馈已提交")).toBeInTheDocument();
    expect(screen.getByText("开始处理")).toBeInTheDocument();
    expect(screen.getByText("已转交前端团队处理")).toBeInTheDocument();
    expect(screen.queryByText("涉及虚拟列表重构")).not.toBeInTheDocument();
    expect(screen.getByText("已标记解决")).toBeInTheDocument();
    expect(screen.getByText("已在 v2.5.1 修复")).toBeInTheDocument();
  });

  it("admin mode: displays both publicMessage and internalMessage", () => {
    render(<FeedbackProgressTimeline events={sampleEvents} isAdmin={true} />);

    expect(screen.getByText("已转交前端团队处理")).toBeInTheDocument();
    expect(screen.getByText("涉及虚拟列表重构")).toBeInTheDocument();
    expect(screen.getByText("仅管理员可见")).toBeInTheDocument();
  });

  it("shows recent records and explicitly expands earlier history without exposing private notes", () => {
    render(<FeedbackProgressTimeline events={sampleEvents} initialVisibleCount={2} />);
    expect(screen.queryByText("反馈已提交")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("已标记解决");
    fireEvent.click(screen.getByRole("button", { name: "查看更早的 1 条记录" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("反馈已提交")).toBeInTheDocument();
    expect(screen.queryByText("涉及虚拟列表重构")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[2]).toHaveTextContent("反馈已提交");
    expect(sampleEvents[0].id).toBe("evt-1");
  });
});
