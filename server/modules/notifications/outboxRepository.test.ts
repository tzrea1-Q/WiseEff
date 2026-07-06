import { describe, expect, it } from "vitest";
import type { Queryable } from "../../shared/database/client";
import {
  claimNextNotificationOutboxEntry,
  insertNotificationOutboxEntry,
  markNotificationOutboxDelivered
} from "./outboxRepository";
import { buildNotificationOutboxIdempotencyKey } from "./outboxTypes";

describe("notification outbox repository", () => {
  it("inserts outbox entries with idempotency keys", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      query: async (text, values = []) => {
        calls.push({ text, values });
        return { rows: [{ id: "outbox-1" }], rowCount: 1 };
      }
    };

    const payload = {
      organizationId: "org-1",
      recipientUserId: "u-1",
      category: "parameter.review.submitted",
      title: "Review",
      body: "Please review"
    };
    const id = await insertNotificationOutboxEntry(db, { id: "outbox-1", payload });

    expect(id).toBe("outbox-1");
    expect(calls[0]?.text).toContain("insert into notification_outbox");
    expect(calls[0]?.values).toContain(buildNotificationOutboxIdempotencyKey(payload));
  });

  it("claims the next pending outbox entry for processing", async () => {
    const db: Queryable = {
      query: async () => ({
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
      })
    };

    const record = await claimNextNotificationOutboxEntry(db);
    expect(record?.id).toBe("outbox-1");
    expect(record?.status).toBe("processing");
  });

  it("marks outbox entries delivered", async () => {
    const calls: Array<{ text: string }> = [];
    const db: Queryable = {
      query: async (text) => {
        calls.push({ text });
        return { rows: [], rowCount: 0 };
      }
    };

    await markNotificationOutboxDelivered(db, "outbox-1");
    expect(calls[0]?.text).toContain("status = 'delivered'");
  });
});
