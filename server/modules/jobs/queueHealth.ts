import type { DurableQueueHealth } from "./queuePort";
import type { WorkerQueueHealth } from "./workerHealth";

export type CombinedDurableQueueHealth = {
  ok: boolean;
  status: "ready" | "degraded" | "failed";
  transport: DurableQueueHealth;
  database: WorkerQueueHealth;
  message?: string;
};

export function buildDurableQueueHealth(input: {
  transport: DurableQueueHealth;
  database: WorkerQueueHealth;
}): CombinedDurableQueueHealth {
  if (input.transport.status === "failed") {
    return {
      ok: false,
      status: "failed",
      transport: input.transport,
      database: input.database,
      message: input.transport.message ?? "Durable queue transport is unavailable."
    };
  }

  if (!input.transport.ok || !input.database.ok) {
    return {
      ok: false,
      status: "degraded",
      transport: input.transport,
      database: input.database,
      message: input.database.message ?? input.transport.message ?? "Durable queue is degraded."
    };
  }

  return {
    ok: true,
    status: "ready",
    transport: input.transport,
    database: input.database
  };
}
