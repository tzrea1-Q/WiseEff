import { describe, expect, it, vi } from "vitest";
import type { Database } from "./shared/database/client";
import { startKnowledgeIndexWorkerLoop } from "./modules/knowledge/indexing/worker";
import { startNotificationOutboxWorkerLoop } from "./modules/notifications/outboxWorker";

describe("API background worker shutdown", () => {
  for (const [name, start] of [
    ["knowledge indexing", startKnowledgeIndexWorkerLoop],
    ["notification outbox", startNotificationOutboxWorkerLoop],
  ] as const) {
    it(`${name} waits for the active database operation and does not claim again`, async () => {
      vi.useFakeTimers();
      let finish!: () => void;
      const active = new Promise<void>(resolve => { finish = resolve; });
      const query = vi.fn(async () => { await active; return { rows: [], rowCount: 0 }; });
      const db = { query } as unknown as Database;
      const stop = start({ db }, 1000);
      let settled = false;
      try {
        expect(query).toHaveBeenCalledOnce();
        const closing = Promise.resolve(stop()).then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        finish();
        await closing;
        expect(settled).toBe(true);
        const calls = query.mock.calls.length;
        await vi.advanceTimersByTimeAsync(3000);
        expect(query).toHaveBeenCalledTimes(calls);
        await stop();
      } finally {
        finish();
        await stop();
        vi.useRealTimers();
      }
    });
  }
});
