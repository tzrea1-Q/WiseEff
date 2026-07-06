import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationPanel } from "./NotificationPanel";

const sampleItems = [
  {
    id: "notif-1",
    category: "parameter.review.submitted",
    title: "参数审阅 · Aurora",
    body: "提交了 2 项修改",
    severity: "info" as const,
    actionUrl: "/parameter-review?project=aurora",
    readAt: null,
    createdAt: "2026-07-06T00:00:00.000Z"
  }
];

describe("NotificationPanel", () => {
  it("renders empty state", () => {
    render(
      <NotificationPanel
        items={[]}
        loading={false}
        error=""
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onMarkAllRead={vi.fn()}
        onOpenItem={vi.fn()}
      />
    );

    expect(screen.getByText("暂无通知")).toBeInTheDocument();
  });

  it("lists notifications and marks all read", () => {
    const onMarkAllRead = vi.fn();
    render(
      <NotificationPanel
        items={sampleItems}
        loading={false}
        error=""
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onMarkAllRead={onMarkAllRead}
        onOpenItem={vi.fn()}
      />
    );

    expect(screen.getByText("参数审阅 · Aurora")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "全部标为已读" }));
    expect(onMarkAllRead).toHaveBeenCalled();
  });
});
