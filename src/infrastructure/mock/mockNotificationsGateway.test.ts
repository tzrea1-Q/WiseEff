import { describe, expect, it, vi } from "vitest";
import { createMockNotificationItem, createMockNotificationsGateway, createStateBackedNotificationsClient } from "./mockNotificationsGateway";
import { createMockRuntimeState } from "./mockState";
import { createPrototypeState } from "@/mockData";

describe("mockNotificationsGateway", () => {
  it("tracks unread counts and mark-read mutations", async () => {
    const runtime = createMockRuntimeState(createPrototypeState());
    const gateway = createMockNotificationsGateway(runtime);

    runtime.current.notificationInbox = [
      createMockNotificationItem({ body: "first" }),
      createMockNotificationItem({ body: "second" })
    ];

    expect((await gateway.getUnreadCount()).count).toBe(2);
    const listed = await gateway.listNotifications({ limit: 10 });
    expect(listed.items).toHaveLength(2);

    await gateway.markRead(listed.items[0].id);
    expect((await gateway.getUnreadCount()).count).toBe(1);

    await gateway.markAllRead();
    expect((await gateway.getUnreadCount()).count).toBe(0);
  });

  it("updates state through createStateBackedNotificationsClient", async () => {
    let inbox = [createMockNotificationItem({ body: "toast" })];
    const setInbox = vi.fn((items) => {
      inbox = items;
    });
    const client = createStateBackedNotificationsClient({
      getInbox: () => inbox,
      setInbox
    });

    await client.markRead(inbox[0].id);
    expect(setInbox).toHaveBeenCalled();
    expect(inbox[0]?.readAt).toBeTruthy();
  });
});
