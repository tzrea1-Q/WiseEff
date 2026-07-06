import { describe, expect, it, vi } from "vitest";
import { createNotificationsClient } from "./notificationsClient";

describe("notificationsClient", () => {
  it("loads unread count and marks one notification read", async () => {
    const get = vi.fn(async (path: string) => {
      if (path === "/api/v1/notifications/unread-count") {
        return { count: 2 };
      }
      return { items: [], nextCursor: null };
    });
    const post = vi.fn(async () => ({ id: "notif-1", readAt: "2026-07-06T01:00:00.000Z" }));

    const client = createNotificationsClient({ get, post } as never);
    await expect(client.getUnreadCount()).resolves.toEqual({ count: 2 });
    await client.markRead("notif-1");
    expect(post).toHaveBeenCalledWith("/api/v1/notifications/notif-1/read", {});
  });
});
