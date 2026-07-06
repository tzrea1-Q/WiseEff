import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import {
  getUnreadNotificationCount,
  insertNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "./repository";

describe("notifications repository", () => {
  it("inserts notifications with metadata", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async (text, values = []) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      }
    };

    await insertNotification(db, {
      id: "notif-1",
      organizationId: "org-1",
      recipientUserId: "u-reviewer",
      category: "parameter.review.submitted",
      title: "参数审阅",
      body: "有新的提交",
      severity: "info",
      actionUrl: "/parameter-review?project=aurora",
      sourceKind: "parameter-submission-round",
      sourceId: "round-1",
      metadata: { itemCount: 2 }
    });

    expect(calls[0].text).toContain("insert into user_notifications");
    expect(calls[0].text).toContain("on conflict do nothing");
    expect(calls[0].values).toContain("notif-1");
  });

  it("lists notifications for a recipient", async () => {
    const db: Queryable = {
      query: async () => ({
        rows: [
          {
            id: "notif-1",
            organization_id: "org-1",
            recipient_user_id: "u-1",
            category: "parameter.review.submitted",
            title: "参数审阅",
            body: "body",
            severity: "info",
            action_url: "/parameter-review?project=aurora",
            source_kind: "parameter-submission-round",
            source_id: "round-1",
            metadata: {},
            read_at: null,
            created_at: "2026-07-06T00:00:00.000Z"
          }
        ],
        rowCount: 1
      })
    };

    const result = await listNotifications(db, {
      organizationId: "org-1",
      recipientUserId: "u-1"
    });

    expect(result.items[0].actionUrl).toBe("/parameter-review?project=aurora");
    expect(result.nextCursor).toBeNull();
  });

  it("returns unread count", async () => {
    const db: Queryable = {
      query: async () => ({ rows: [{ count: "3" }], rowCount: 1 })
    };

    const result = await getUnreadNotificationCount(db, {
      organizationId: "org-1",
      recipientUserId: "u-1"
    });

    expect(result.count).toBe(3);
  });

  it("marks one notification read", async () => {
    const db: Queryable = {
      query: async (text) => {
        expect(text).toContain("update user_notifications");
        return {
          rows: [
            {
              id: "notif-1",
              organization_id: "org-1",
              recipient_user_id: "u-1",
              category: "parameter.review.submitted",
              title: "参数审阅",
              body: "body",
              severity: "info",
              action_url: null,
              source_kind: null,
              source_id: null,
              metadata: {},
              read_at: "2026-07-06T01:00:00.000Z",
              created_at: "2026-07-06T00:00:00.000Z"
            }
          ],
          rowCount: 1
        };
      }
    };

    const result = await markNotificationRead(db, {
      organizationId: "org-1",
      recipientUserId: "u-1",
      notificationId: "notif-1"
    });

    expect(result?.readAt).toBe("2026-07-06T01:00:00.000Z");
  });

  it("marks all notifications read", async () => {
    const db: Queryable = {
      query: async (text) => {
        expect(text).toContain("mark-all-read".replace("mark-all-read", "read_at"));
        return { rows: [{ count: "2" }], rowCount: 1 };
      }
    };

    const result = await markAllNotificationsRead(db, {
      organizationId: "org-1",
      recipientUserId: "u-1"
    });

    expect(result.updated).toBe(2);
  });
});
