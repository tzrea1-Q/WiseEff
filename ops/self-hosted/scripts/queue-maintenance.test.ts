import { describe, expect, it } from "vitest";
import { buildQueueMaintenancePlan, parseQueueMaintenanceArgs } from "./queue-maintenance";

describe("self-host queue maintenance", () => {
  it("parses the small maintenance command surface", () => {
    expect(parseQueueMaintenanceArgs(["pause"])).toEqual({ action: "pause", timeoutMs: 30_000 });
    expect(parseQueueMaintenanceArgs(["drain", "--timeout-ms", "5000"])).toEqual({ action: "drain", timeoutMs: 5000 });
    expect(parseQueueMaintenanceArgs(["resume"])).toEqual({ action: "resume", timeoutMs: 30_000 });
  });

  it("only plans durable queues that can be paused globally", () => {
    expect(
      buildQueueMaintenancePlan({
        LOG_ANALYSIS_QUEUE_MODE: "durable",
        LOG_ANALYSIS_QUEUE_PREFIX: "wiseeff",
        NOTIFICATION_DELIVERY_MODE: "async",
        NOTIFICATION_QUEUE_MODE: "durable",
        NOTIFICATION_QUEUE_PREFIX: "wiseeff"
      })
    ).toEqual([
      { name: "log-analysis", prefix: "wiseeff" },
      { name: "notifications", prefix: "wiseeff" }
    ]);
  });

  it("reports polling mode as an explicit no-op plan", () => {
    expect(
      buildQueueMaintenancePlan({
        LOG_ANALYSIS_QUEUE_MODE: "polling",
        NOTIFICATION_DELIVERY_MODE: "sync",
        NOTIFICATION_QUEUE_MODE: "polling"
      })
    ).toEqual([]);
  });
});
