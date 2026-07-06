import { describe, expect, it, vi } from "vitest";
import { createNotificationQueueRuntime } from "./notificationQueueRuntime";
import type { Database } from "../../shared/database/client";

describe("notification queue runtime", () => {
  it("registers a BullMQ queue and worker for notification delivery", () => {
    const QueueCtor = vi.fn(function Queue(this: unknown) {
      return {
        add: vi.fn(),
        getJobCounts: vi.fn(async () => ({})),
        close: vi.fn(async () => undefined)
      };
    });
    const WorkerCtor = vi.fn(function Worker() {
      return { close: vi.fn(async () => undefined) };
    });

    const runtime = createNotificationQueueRuntime({
      env: {
        REDIS_URL: "redis://127.0.0.1:6379",
        NOTIFICATION_QUEUE_PREFIX: "wiseeff",
        NOTIFICATION_QUEUE_ATTEMPTS: 4,
        NOTIFICATION_QUEUE_BACKOFF_MS: 1000,
        NOTIFICATION_QUEUE_CONCURRENCY: 1
      },
      db: { query: vi.fn() } as unknown as Database,
      QueueCtor: QueueCtor as never,
      WorkerCtor: WorkerCtor as never,
      metrics: { recordNotificationDeliveryResult: vi.fn(), setQueueStats: vi.fn() }
    });

    expect(QueueCtor).toHaveBeenCalledWith("notification-delivery", expect.objectContaining({ prefix: "wiseeff" }));
    expect(WorkerCtor).toHaveBeenCalledWith("notification-delivery", expect.any(Function), expect.objectContaining({ concurrency: 1 }));
    expect(runtime.queue).toBeTruthy();
  });
});
