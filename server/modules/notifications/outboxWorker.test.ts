import { describe, expect, it, vi } from "vitest";
import type { Database } from "../../shared/database/client";
import { processNextNotificationOutboxEntry } from "./outboxWorker";

describe("notification outbox worker", () => {
  it("delivers claimed outbox entries and records metrics", async () => {
    let phase = 0;
    const db = {
      query: async (text: string) => {
        if (text.includes("update notification_outbox") && text.includes("returning")) {
          phase = 1;
          return {
            rows: [
              {
                id: "outbox-1",
                organization_id: "org-1",
                idempotency_key: "key-1",
                payload: {
                  organizationId: "org-1",
                  recipientUserId: "u-1",
                  category: "parameter.review.submitted",
                  title: "Review",
                  body: "Please review"
                },
                status: "processing",
                attempts: 1,
                error_message: null,
                next_attempt_at: null,
                created_at: "2026-07-06T00:00:00.000Z",
                updated_at: "2026-07-06T00:00:00.000Z",
                delivered_at: null,
                dead_lettered_at: null
              }
            ],
            rowCount: 1
          };
        }
        return { rows: [{ queued: "0", processing: "0", dead_lettered: "0", oldest_queued_at: null }], rowCount: 1 };
      },
      transaction: async (callback: (tx: Database) => Promise<void>) => callback(db as Database)
    } as unknown as Database;
    const recordNotificationDeliveryResult = vi.fn();

    const result = await processNextNotificationOutboxEntry({
      db,
      metrics: { recordNotificationDeliveryResult, setQueueStats: vi.fn() }
    });

    expect(result).toBe("processed");
    expect(phase).toBe(1);
    expect(recordNotificationDeliveryResult).toHaveBeenCalledWith(expect.objectContaining({ status: "delivered" }));
  });
});
