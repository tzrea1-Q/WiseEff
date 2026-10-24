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

async function deliverOutboxRecord(db: Queryable, record: NotificationOutboxRecord, workerId?: string) {
  const current = (await db.query<{ payload: NotificationOutboxPayload; attempts: number }>(`select payload,attempts from notification_outbox
    where id=$1 and (($2::text is null and status='pending') or (status='processing' and lease_owner=$2 and lease_expires_at>clock_timestamp())) for update`, [record.id, workerId ?? null])).rows[0];
  if (!current || current.attempts !== record.attempts) return false;
  const payload = current.payload;
  let sourceOrganizationId = typeof payload.metadata?.feedbackOrganizationId === "string" ? payload.metadata.feedbackOrganizationId : undefined;
  if (payload.sourceKind === "product-feedback" || payload.sourceKind === "product-feedback-progress") {
    const source = (await db.query<{ organization_id: string }>(payload.sourceKind === "product-feedback"
      ? "select organization_id from product_feedback where id::text=$1"
      : "select organization_id from product_feedback_progress_events where id::text=$1", [payload.sourceId ?? ""])).rows[0];
    if (!source || (sourceOrganizationId && source.organization_id !== sourceOrganizationId)) return false;
    sourceOrganizationId = source.organization_id;
  }
  // A foreign recipient Home does not own the feedback content. Hold both
  // organizations through projection; a deleting/missing source cannot reappear.
  for (const id of [...new Set([payload.organizationId, sourceOrganizationId].filter((id): id is string => Boolean(id)))].sort()) {
    if (!(await db.query("select id from organizations where id=$1 and status<>'deleting' for share", [id])).rowCount) return false;
  }
  await insertNotification(db, {
    id: record.id,
    organizationId: payload.organizationId,
    recipientUserIds: [payload.recipientUserId],
    recipientUserId: payload.recipientUserId,
    category: payload.category,
    title: payload.title,
    body: payload.body,
    severity: payload.severity,
    actionUrl: payload.actionUrl,
    sourceKind: payload.sourceKind,
    sourceId: payload.sourceId,
    metadata: payload.metadata
  });
  return true;
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
    const delivered = await options.db.transaction(async (tx) => {
      if (!await deliverOutboxRecord(tx, record, options.workerId)) return false;
      await markNotificationOutboxDelivered(tx, record.id);
      return true;
    });
    if (!delivered) return { status: "idle" };
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
  const deliver = async (tx: Queryable) => {
    const delivered = await deliverOutboxRecord(tx, {
      id: input.outboxId,
      organizationId: input.payload.organizationId,
      idempotencyKey: "",
      payload: input.payload,
      status: "pending",
      attempts: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (delivered) await markNotificationOutboxDelivered(tx, input.outboxId);
  };
  if (!("transaction" in db) || typeof db.transaction !== "function") throw new Error("Synchronous notification delivery requires its write transaction.");
  await (db as Database).transaction(deliver);
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
