import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWiseEffServer } from "../../app";
import type { Database } from "../../shared/database/client";
import { requestJson } from "../../test/testClient";
import * as service from "./service";

vi.mock("./service", () => ({
  listUserNotifications: vi.fn(),
  getUserUnreadNotificationCount: vi.fn(),
  markUserNotificationRead: vi.fn(),
  markAllUserNotificationsRead: vi.fn(),
  notifyUsers: vi.fn()
}));

function makeDb(input: { userId?: string; organizationId?: string } = {}): Database {
  const userId = input.userId ?? "u-notified";
  const organizationId = input.organizationId ?? "org-prod";
  const query: Database["query"] = async <Row,>(text: string) => {
    if (text.includes("users.id as user_id")) {
      return {
        rows: [
          {
            user_id: userId,
            organization_id: organizationId,
            organization_name: "Pilot Org",
            name: "Notified User",
            email: "user@example.com",
            title: "Engineer",
            is_active: true,
            project_id: "aurora",
            role_id: "hardware-user"
          }
        ] as Row[],
        rowCount: 1
      };
    }
    return { rows: [] as Row[], rowCount: 0 };
  };

  return { query, transaction: vi.fn() };
}

describe("notification routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists notifications for the current user", async () => {
    vi.mocked(service.listUserNotifications).mockResolvedValue({
      items: [
        {
          id: "notif-1",
          category: "parameter.review.submitted",
          title: "参数审阅",
          body: "有新的提交",
          severity: "info",
          actionUrl: "/parameter-review?project=aurora",
          readAt: null,
          createdAt: "2026-07-06T00:00:00.000Z",
          metadata: {}
        }
      ],
      nextCursor: null
    });

    const response = await requestJson<{ items: Array<{ id: string }> }>(
      createWiseEffServer({ db: makeDb() }),
      "/api/v1/notifications"
    );

    expect(response.status).toBe(200);
    expect(response.body.items[0].id).toBe("notif-1");
    expect(service.listUserNotifications).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org-prod",
      recipientUserId: "u-notified",
      unreadOnly: undefined,
      cursor: undefined,
      limit: undefined
    });
  });

  it("returns unread count", async () => {
    vi.mocked(service.getUserUnreadNotificationCount).mockResolvedValue({ count: 2 });

    const response = await requestJson<{ count: number }>(
      createWiseEffServer({ db: makeDb() }),
      "/api/v1/notifications/unread-count"
    );

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(2);
  });

  it("marks a notification read", async () => {
    vi.mocked(service.markUserNotificationRead).mockResolvedValue({
      id: "notif-1",
      category: "parameter.review.submitted",
      title: "参数审阅",
      body: "有新的提交",
      severity: "info",
      actionUrl: null,
      readAt: "2026-07-06T01:00:00.000Z",
      createdAt: "2026-07-06T00:00:00.000Z",
      metadata: {}
    });

    const response = await requestJson(
      createWiseEffServer({ db: makeDb() }),
      "/api/v1/notifications/notif-1/read",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
  });

  it("marks all notifications read", async () => {
    vi.mocked(service.markAllUserNotificationsRead).mockResolvedValue({ updated: 3 });

    const response = await requestJson<{ updated: number }>(
      createWiseEffServer({ db: makeDb() }),
      "/api/v1/notifications/mark-all-read",
      { method: "POST" }
    );

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(3);
  });
});
