import type { Database } from "../../shared/database/client";

export const LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT = 1000;
export const LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES = 10;
export const LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS = 60_000;

type RetentionLogger = Pick<Console, "info" | "warn">;

type LogWebhookDeliveryRetentionLoopOptions = {
  db: Database;
  keepPerDomain: number;
  logger?: RetentionLogger;
};

export type LogWebhookDeliveryRetentionLoopStarter = (
  options: LogWebhookDeliveryRetentionLoopOptions
) => () => Promise<void>;

/**
 * Prune one bounded maintenance cycle while keeping the newest delivery
 * attempts for every organization-scoped log domain. Timestamp ties resolve
 * by immutable row id. Victims are selected once, then deleted in small
 * batches so one cycle never repeats the ranking scan.
 */
export async function pruneLogWebhookDeliveries(
  db: Database,
  options: { keepPerDomain: number; batchLimit: number }
): Promise<number> {
  if (!Number.isInteger(options.keepPerDomain) || options.keepPerDomain < 1 || options.keepPerDomain > 1_000_000) {
    throw new Error("keepPerDomain must be an integer between 1 and 1000000.");
  }
  if (
    !Number.isSafeInteger(options.batchLimit) ||
    options.batchLimit < 1 ||
    options.batchLimit > LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT
  ) {
    throw new Error("batchLimit must be a positive integer no greater than 1000.");
  }

  return db.transaction(async (tx) => {
    const selectionLimit = options.batchLimit * LOG_WEBHOOK_DELIVERY_RETENTION_MAX_BATCHES;
    const victims = await tx.query<{ id: string }>(
      `with ranked as (
         select
           id,
           organization_id,
           log_domain_id,
           created_at,
           row_number() over (
             partition by organization_id, log_domain_id
             order by created_at desc, id desc
           ) as retention_rank
         from log_webhook_deliveries
       )
       select id
       from ranked
       where retention_rank > $1
       order by organization_id, log_domain_id, created_at desc, id desc
       limit $2`,
      [options.keepPerDomain, selectionLimit]
    );

    let deletedRows = 0;
    for (let offset = 0; offset < victims.rows.length; offset += options.batchLimit) {
      const victimIds = victims.rows
        .slice(offset, offset + options.batchLimit)
        .map((row) => row.id);
      const result = await tx.query<{ id: string }>(
        `delete from log_webhook_deliveries
         where id = any($1::text[])
         returning id`,
        [victimIds]
      );
      deletedRows += result.rowCount ?? result.rows.length;
    }

    return deletedRows;
  });
}

/**
 * Own the shared polling/durable maintenance schedule without coupling cleanup
 * failures to log analysis or webhook delivery.
 */
export function startLogWebhookDeliveryRetentionLoop(
  options: LogWebhookDeliveryRetentionLoopOptions
): () => Promise<void> {
  const logger = options.logger ?? console;
  let stopped = false;
  let running = false;
  let activeRun: Promise<void> | undefined;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    const startedAt = Date.now();

    activeRun = (async () => {
      const deletedRows = await pruneLogWebhookDeliveries(options.db, {
        keepPerDomain: options.keepPerDomain,
        batchLimit: LOG_WEBHOOK_DELIVERY_RETENTION_BATCH_LIMIT
      });

      logger.info({
        event: "log_webhook_delivery_retention",
        status: "succeeded",
        deletedRows,
        durationMs: Math.max(0, Date.now() - startedAt)
      });
    })()
      .catch(() => {
        logger.warn({
          event: "log_webhook_delivery_retention",
          status: "failed",
          errorCode: "LOG_WEBHOOK_DELIVERY_RETENTION_FAILED"
        });
      })
      .finally(() => {
        running = false;
        activeRun = undefined;
      });
  };

  const interval = setInterval(tick, LOG_WEBHOOK_DELIVERY_RETENTION_INTERVAL_MS);
  queueMicrotask(tick);

  return async () => {
    stopped = true;
    clearInterval(interval);
    await activeRun;
  };
}
