import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationBell } from "./NotificationBell";

describe("NotificationBell", () => {
  it("hides the badge when unread count is zero", () => {
    render(
      <NotificationBell
        unreadCount={0}
        open={false}
        onOpenChange={vi.fn()}
        panel={null}
      />
    );

    expect(screen.getByRole("button", { name: "通知" })).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("shows unread count and opens the panel", () => {
    const onOpenChange = vi.fn();
    render(
      <NotificationBell
        unreadCount={3}
        open={false}
        onOpenChange={onOpenChange}
        panel={<div>panel</div>}
      />
    );

    expect(screen.getByRole("button", { name: "通知，3 条未读" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通知，3 条未读" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
