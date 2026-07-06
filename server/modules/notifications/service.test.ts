import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../../shared/database/client";
import { configureNotificationDelivery, resetNotificationDeliveryConfigForTests } from "./delivery";
import { notifyUsers } from "./service";

describe("notification service outbox delivery", () => {
  afterEach(() => {
    resetNotificationDeliveryConfigForTests();
  });

  it("delivers notifications synchronously through the outbox by default", async () => {
    const calls: Array<{ text: string }> = [];
    const db = {
      query: async (text: string) => {
        calls.push({ text });
        if (text.includes("insert into notification_outbox")) {
          return { rows: [{ id: "outbox-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    } as unknown as Database;

    await notifyUsers(db, {
      organizationId: "org-1",
      recipientUserIds: ["u-1"],
      category: "parameter.review.submitted",
      title: "Review",
      body: "Please review"
    });

    expect(calls.some((call) => call.text.includes("insert into notification_outbox"))).toBe(true);
    expect(calls.some((call) => call.text.includes("insert into user_notifications"))).toBe(true);
    expect(calls.some((call) => call.text.includes("status = 'delivered'"))).toBe(true);
  });

  it("enqueues async delivery without writing inbox rows immediately", async () => {
    const enqueue = vi.fn(async () => ({ id: "job-1" }));
    configureNotificationDelivery({
      mode: "async",
      queue: { enqueue }
    });

    const calls: Array<{ text: string }> = [];
    const db = {
      query: async (text: string) => {
        calls.push({ text });
        if (text.includes("insert into notification_outbox")) {
          return { rows: [{ id: "outbox-1" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
    } as unknown as Database;

    await notifyUsers(db, {
      organizationId: "org-1",
      recipientUserIds: ["u-1"],
      category: "parameter.review.submitted",
      title: "Review",
      body: "Please review"
    });

    expect(enqueue).toHaveBeenCalledWith({
      name: "deliver-notification",
      payload: { organizationId: "org-1", outboxId: "outbox-1" },
      idempotencyKey: "notification-outbox:outbox-1"
    });
    expect(calls.some((call) => call.text.includes("insert into user_notifications"))).toBe(false);
  });
});
