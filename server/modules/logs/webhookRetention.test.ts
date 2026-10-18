import { describe, expect, it, vi } from "vitest";

import type { Database, QueryResult } from "../../shared/database/client";
import {
  LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT,
  LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS,
  LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES,
  startLogWebhookDeliveryRetentionLoop
} from "./webhookRetention";

function fakeDatabase(query: Database["query"]): Database {
  const db = {
    query,
    transaction: async <T>(fn: (tx: Database) => Promise<T>) => fn(db)
  } as Database;
  return db;
}

describe("log webhook delivery retention loop", () => {
  it("prunes terminal outbox rows under the same settings and bounded batch budget", async () => {
    vi.useFakeTimers();
    try {
      const victims = Array.from({ length: 10_000 }, (_, index) => ({ id: `outbox-${index}` }));
      const query = vi.fn(async <Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
        if (text.includes("from log_webhook_deliveries")) return { rows: [], rowCount: 0 };
        if (text.includes("row_number() over")) return { rows: victims as Row[], rowCount: victims.length };
        const ids = values[0] as string[];
        return { rows: ids.map((id) => ({ id })) as Row[], rowCount: ids.length };
      });
      const logger = { info: vi.fn(), warn: vi.fn() };
      const stop = startLogWebhookDeliveryRetentionLoop({ db: fakeDatabase(query), keepPerDomain: 7, logger });
      await vi.waitFor(() => expect(logger.info).toHaveBeenCalledOnce());
      const selection = query.mock.calls.filter(([text]) => text.includes("row_number() over") && text.includes("from log_webhook_outbox"));
      expect(selection).toHaveLength(1);
      expect(selection[0][1]).toEqual([7, 10_000]);
      expect(selection[0][0]).toContain("where status in ('delivered', 'failed')");
      const deletes = query.mock.calls.filter(([text]) => text.includes("delete from log_webhook_outbox"));
      expect(deletes).toHaveLength(LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES);
      expect(deletes.every(([text, values]) => text.includes("and status in ('delivered', 'failed')") && (values[0] as string[]).length === 1000)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ deletedRows: 0, deletedOutboxRows: 10_000 }));
      await stop();
      await vi.advanceTimersByTimeAsync(LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS * 2);
      expect(query).toHaveBeenCalledTimes(12);
    } finally { vi.useRealTimers(); }
  });

  it("runs immediately, caps one cycle at ten batches, and stops future cycles", async () => {
    vi.useFakeTimers();
    try {
      const victimIds = Array.from(
        {
          length:
            LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT *
            LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES
        },
        (_, index) => ({ id: `delivery-${index}` })
      );
      const query = vi.fn(
        async <Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> => {
          if (text.includes("row_number() over")) {
            if (text.includes("from log_webhook_outbox")) return { rows: [], rowCount: 0 };
            return { rows: victimIds as Row[], rowCount: victimIds.length };
          }
          if (text.includes("delete from log_webhook_deliveries")) {
            const ids = values[0] as string[];
            return { rows: ids.map((id) => ({ id })) as Row[], rowCount: ids.length };
          }
          throw new Error(`Unexpected retention query: ${text}`);
        }
      );
      const logger = { info: vi.fn(), warn: vi.fn() };

      const stop: () => Promise<void> = startLogWebhookDeliveryRetentionLoop({
        db: fakeDatabase(query),
        keepPerDomain: 10_000,
        logger
      });

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledOnce();
      });
      const selectionQueries = query.mock.calls.filter(([text]) =>
        text.includes("row_number() over") && text.includes("from log_webhook_deliveries")
      );
      const deleteQueries = query.mock.calls.filter(([text]) =>
        text.includes("delete from log_webhook_deliveries")
      );
      expect(selectionQueries).toHaveLength(1);
      expect(selectionQueries[0][1]).toEqual([
        10_000,
        LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT * LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES
      ]);
      expect(selectionQueries[0][0]).toContain("order by created_at desc, id desc");
      expect(selectionQueries[0][0]).toContain(
        "order by organization_id, log_domain_id, created_at desc, id desc"
      );
      expect(deleteQueries).toHaveLength(LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES);
      expect(
        deleteQueries.every(([, values]) => (values[0] as string[]).length === 1000)
      ).toBe(true);
      expect(logger.info).toHaveBeenCalledWith({
        event: "log_webhook_delivery_retention",
        status: "succeeded",
        deletedRows:
          LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT * LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES,
        deletedOutboxRows: 0,
        durationMs: expect.any(Number)
      });

      await stop();
      await vi.advanceTimersByTimeAsync(LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS * 2);
      expect(query).toHaveBeenCalledTimes(2 + LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES);
    } finally {
      vi.useRealTimers();
    }
  });

  it("redacts failures and retries on the next cycle", async () => {
    vi.useFakeTimers();
    try {
      const query = vi
        .fn<Database["query"]>()
        .mockRejectedValueOnce(new Error("postgres://secret-user:secret-password@private-db/customer"))
        .mockResolvedValue({ rows: [], rowCount: 0 });
      const logger = { info: vi.fn(), warn: vi.fn() };
      const stop = startLogWebhookDeliveryRetentionLoop({
        db: fakeDatabase(query),
        keepPerDomain: 10_000,
        logger
      });

      await vi.waitFor(() => expect(logger.warn).toHaveBeenCalledOnce());
      expect(logger.warn).toHaveBeenCalledWith({
        event: "log_webhook_delivery_retention",
        status: "failed",
        errorCode: "LOG_WEBHOOK_DELIVERY_RETENTION_FAILED"
      });
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-password");
      expect(query).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS);
      await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(3));
      expect(logger.info).toHaveBeenCalledWith({
        event: "log_webhook_delivery_retention",
        status: "succeeded",
        deletedRows: 0,
        deletedOutboxRows: 0,
        durationMs: expect.any(Number)
      });

      await stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for an active prune to quiesce and prevents future work", async () => {
    vi.useFakeTimers();
    try {
      let resolveSelection: ((result: QueryResult<{ id: string }>) => void) | undefined;
      const selection = new Promise<QueryResult<{ id: string }>>((resolve) => {
        resolveSelection = resolve;
      });
      const query = vi.fn<Database["query"]>().mockReturnValue(selection);
      const stop = startLogWebhookDeliveryRetentionLoop({
        db: fakeDatabase(query),
        keepPerDomain: 10_000,
        logger: { info: vi.fn(), warn: vi.fn() }
      });

      await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());

      let stopped = false;
      const quiesced = Promise.resolve(stop()).then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);

      resolveSelection?.({ rows: [], rowCount: 0 });
      await quiesced;
      expect(stopped).toBe(true);

      await vi.advanceTimersByTimeAsync(LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS * 2);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
