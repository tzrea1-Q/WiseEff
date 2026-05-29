import { describe, expect, it } from "vitest";
import type { QueryResult, Queryable } from "../../shared/database/client";
import { buildWorkerQueueHealth, getWorkerQueueStats } from "./workerHealth";

describe("worker queue health", () => {
  it("reports ready when queue has no dead letters", () => {
    expect(
      buildWorkerQueueHealth({
        queued: 2,
        processing: 1,
        deadLettered: 0,
        oldestQueuedAt: "2026-05-28T00:00:00.000Z",
        now: new Date("2026-05-28T00:00:05.000Z")
      })
    ).toEqual({
      ok: true,
      status: "ready",
      queued: 2,
      processing: 1,
      deadLettered: 0,
      oldestQueuedAgeMs: 5000
    });
  });

  it("reports degraded when dead letters are present", () => {
    expect(
      buildWorkerQueueHealth({
        queued: 0,
        processing: 0,
        deadLettered: 3,
        oldestQueuedAt: null,
        now: new Date("2026-05-28T00:00:05.000Z")
      })
    ).toEqual({
      ok: false,
      status: "degraded",
      queued: 0,
      processing: 0,
      deadLettered: 3,
      oldestQueuedAgeMs: null,
      message: "3 log analysis job(s) are dead-lettered."
    });
  });

  it("queries queue stats from jobs", async () => {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const db: Queryable = {
      async query<Row>(text: string, values: unknown[] = []): Promise<QueryResult<Row>> {
        calls.push({ text: text.replace(/\s+/g, " ").trim(), values });
        return {
          rows: [
            {
              queued: "4",
              processing: "2",
              dead_lettered: "1",
              oldest_queued_at: "2026-05-28T00:00:00.000Z"
            } as Row
          ],
          rowCount: 1
        };
      }
    };

    await expect(getWorkerQueueStats(db)).resolves.toEqual({
      queued: 4,
      processing: 2,
      deadLettered: 1,
      oldestQueuedAt: "2026-05-28T00:00:00.000Z"
    });
    expect(calls[0].text).toContain("from jobs");
    expect(calls[0].text).toContain("dead_lettered_at is not null");
    expect(calls[0].values).toEqual(["log-analysis"]);
  });
});
