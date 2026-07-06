import type { Database, Queryable } from "../../shared/database/client";
import { decideRetry } from "../jobs/retryPolicy";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { insertNotification } from "./repository";
import {
  claimNextNotificationOutboxEntry,
  claimNotificationOutboxEntryById,
  getNotificationOutboxStats,
  markNotificationOutboxDeadLettered,
  markNotificationOutboxDelivered,
  markNotificationOutboxRetry
} from "./outboxRepository";
import type { NotificationOutboxPayload, NotificationOutboxRecord } from "./outboxTypes";

export type ProcessNotificationOutboxOptions = {
  db: Database;
  workerId?: string;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  now?: () => Date;
  metrics?: Pick<MetricsRegistry, "recordNotificationDeliveryResult" | "setQueueStats">;
  tracing?: Pick<TracingBoundary, "withSpan">;
};

export type ProcessNotificationOutboxResult =
  | { status: "processed" }
  | { status: "idle" }
  | { status: "retry"; reason: string }
  | { status: "dead-lettered"; reason: string };

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function deliverOutboxRecord(db: Queryable, record: NotificationOutboxRecord) {
  await insertNotification(db, {
    id: record.id,
    organizationId: record.payload.organizationId,
    recipientUserIds: [record.payload.recipientUserId],
    recipientUserId: record.payload.recipientUserId,
    category: record.payload.category,
    title: record.payload.title,
    body: record.payload.body,
    severity: record.payload.severity,
    actionUrl: record.payload.actionUrl,
    sourceKind: record.payload.sourceKind,
    sourceId: record.payload.sourceId,
    metadata: record.payload.metadata
  });
}

async function processClaimedOutboxRecord(
  options: Required<Pick<ProcessNotificationOutboxOptions, "db" | "workerId" | "maxAttempts" | "retryBaseDelayMs" | "now">> &
    Pick<ProcessNotificationOutboxOptions, "metrics">,
  record: NotificationOutboxRecord
): Promise<ProcessNotificationOutboxResult> {
  const startedAtMs = options.now().getTime();
  const recordMetric = (status: "delivered" | "retry" | "dead_lettered" | "failed") => {
    options.metrics?.recordNotificationDeliveryResult({
      status,
      durationMs: Math.max(0, options.now().getTime() - startedAtMs)
    });
  };

  try {
    await options.db.transaction(async (tx) => {
      await deliverOutboxRecord(tx, record);
      await markNotificationOutboxDelivered(tx, record.id);
    });
    recordMetric("delivered");
    return { status: "processed" };
  } catch (error) {
    const message = readableError(error);
    const decision = decideRetry({
      attemptCount: record.attempts,
      maxAttempts: options.maxAttempts,
      baseDelayMs: options.retryBaseDelayMs,
      now: options.now()
    });

    if (decision.action === "retry") {
      await markNotificationOutboxRetry(options.db, {
        outboxId: record.id,
        error: message,
        nextAttemptAt: decision.nextRunAt,
        reason: decision.reason
      });
      recordMetric("retry");
      return { status: "retry", reason: decision.reason };
    }

    await markNotificationOutboxDeadLettered(options.db, {
      outboxId: record.id,
      error: message,
      reason: decision.reason
    });
    recordMetric("dead_lettered");
    return { status: "dead-lettered", reason: decision.reason };
  }
}

async function refreshOutboxQueueMetrics(
  db: Queryable,
  metrics?: Pick<MetricsRegistry, "setQueueStats">
) {
  if (!metrics) return;
  const stats = await getNotificationOutboxStats(db);
  const oldestQueuedAgeMs = stats.oldestQueuedAt
    ? Math.max(0, Date.now() - new Date(stats.oldestQueuedAt).getTime())
    : null;
  metrics.setQueueStats({
    queue: "notification-outbox",
    queued: stats.queued,
    processing: stats.processing,
    deadLettered: stats.deadLettered,
    oldestQueuedAgeMs
  });
}

export async function processNextNotificationOutboxEntry(
  options: ProcessNotificationOutboxOptions
): Promise<"processed" | "idle"> {
  const workerId = options.workerId ?? "wiseeff-notification-worker";
  const record = await claimNextNotificationOutboxEntry(options.db, { leaseOwner: workerId });
  if (!record) {
    await refreshOutboxQueueMetrics(options.db, options.metrics);
    return "idle";
  }

  const process = async () =>
    processClaimedOutboxRecord(
      {
        db: options.db,
        workerId,
        maxAttempts: options.maxAttempts ?? 4,
        retryBaseDelayMs: options.retryBaseDelayMs ?? 1000,
        now: options.now ?? (() => new Date()),
        metrics: options.metrics
      },
      record
    );

  const result = options.tracing
    ? await options.tracing.withSpan("notification.outbox.process", { outboxId: record.id }, process)
    : await process();

  await refreshOutboxQueueMetrics(options.db, options.metrics);
  return result.status === "idle" ? "idle" : "processed";
}

export async function processNotificationOutboxEntryById(
  options: ProcessNotificationOutboxOptions & { outboxId: string }
): Promise<ProcessNotificationOutboxResult> {
  const workerId = options.workerId ?? "wiseeff-notification-worker";
  const record = await claimNotificationOutboxEntryById(options.db, { outboxId: options.outboxId, leaseOwner: workerId });
  if (!record) {
    await refreshOutboxQueueMetrics(options.db, options.metrics);
    return { status: "idle" };
  }

  const result = await processClaimedOutboxRecord(
    {
      db: options.db,
      workerId,
      maxAttempts: options.maxAttempts ?? 4,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 1000,
      now: options.now ?? (() => new Date()),
      metrics: options.metrics
    },
    record
  );
  await refreshOutboxQueueMetrics(options.db, options.metrics);
  return result;
}

export async function deliverNotificationPayload(
  db: Queryable,
  input: { outboxId: string; payload: NotificationOutboxPayload }
) {
  await deliverOutboxRecord(db, {
    id: input.outboxId,
    organizationId: input.payload.organizationId,
    idempotencyKey: "",
    payload: input.payload,
    status: "pending",
    attempts: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await markNotificationOutboxDelivered(db, input.outboxId);
}

export function startNotificationOutboxWorkerLoop(options: ProcessNotificationOutboxOptions, intervalMs = 1000) {
  let stopped = false;
  let running = false;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextNotificationOutboxEntry(options)
      .catch(() => undefined)
      .finally(() => {
        running = false;
      });
  };

  const intervalId = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(intervalId);
  };
}
