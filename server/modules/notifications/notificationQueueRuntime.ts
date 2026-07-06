import { Queue, Worker } from "bullmq";

import { createBullMqDurableQueue } from "../jobs/bullmqQueue";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import type { NotificationQueuePayload } from "./notificationQueue";
import { processNotificationOutboxEntryById } from "./outboxWorker";

export type NotificationQueueRuntimeEnv = {
  REDIS_URL: string;
  NOTIFICATION_QUEUE_PREFIX: string;
  NOTIFICATION_QUEUE_ATTEMPTS: number;
  NOTIFICATION_QUEUE_BACKOFF_MS: number;
  NOTIFICATION_QUEUE_CONCURRENCY: number;
};

type BullMqQueueConstructor = new (
  name: string,
  options: { connection: { url: string }; prefix: string }
) => {
  add: (name: string, data: NotificationQueuePayload, options: unknown) => Promise<{ id?: string | number }>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  getJobCounts: () => Promise<{
    waiting?: number;
    active?: number;
    completed?: number;
    failed?: number;
    delayed?: number;
    paused?: number;
  }>;
  close: () => Promise<void>;
};

type BullMqWorkerConstructor = new (
  name: string,
  processor: (job: { data: NotificationQueuePayload }) => Promise<string>,
  options: { connection: { url: string }; prefix: string; concurrency: number; name: string }
) => { close: () => Promise<void> };

type CreateNotificationQueueRuntimeOptions = {
  env: NotificationQueueRuntimeEnv;
  db: Database;
  QueueCtor?: BullMqQueueConstructor;
  WorkerCtor?: BullMqWorkerConstructor;
  workerId?: string;
  metrics?: Pick<MetricsRegistry, "recordNotificationDeliveryResult" | "setQueueStats">;
  tracing?: Pick<TracingBoundary, "withSpan">;
};

export function createNotificationQueueRuntime({
  env,
  db,
  QueueCtor = Queue as unknown as BullMqQueueConstructor,
  WorkerCtor = Worker as unknown as BullMqWorkerConstructor,
  workerId = "wiseeff-notification-worker",
  metrics,
  tracing
}: CreateNotificationQueueRuntimeOptions) {
  const queueName = "notification-delivery";
  const connection = { url: env.REDIS_URL };
  const queue = new QueueCtor(queueName, {
    connection,
    prefix: env.NOTIFICATION_QUEUE_PREFIX
  });
  const durableQueue = createBullMqDurableQueue<NotificationQueuePayload>({
    name: queueName,
    queue,
    maxAttempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
    retryBackoffMs: env.NOTIFICATION_QUEUE_BACKOFF_MS
  });
  const worker = new WorkerCtor(
    queueName,
    async (job) => {
      const attributes: Record<string, string | number | boolean> = { queue: queueName };
      const process = async () => {
        const outboxId = job.data?.outboxId;
        if (!outboxId) {
          throw new Error("BullMQ notification-delivery job payload must include outboxId.");
        }

        const result = await processNotificationOutboxEntryById({
          db,
          outboxId,
          workerId,
          maxAttempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
          retryBaseDelayMs: env.NOTIFICATION_QUEUE_BACKOFF_MS,
          metrics,
          ...(tracing ? { tracing } : {})
        });
        if (result.status === "retry") {
          throw new Error(result.reason);
        }
        attributes.status = result.status;
        return result.status;
      };

      try {
        return tracing ? await tracing.withSpan("notification.queue.process", attributes, process) : await process();
      } catch (error) {
        attributes.status = "failed";
        attributes.errorType = error instanceof Error ? error.name : "unknown";
        throw error;
      }
    },
    {
      connection,
      prefix: env.NOTIFICATION_QUEUE_PREFIX,
      concurrency: env.NOTIFICATION_QUEUE_CONCURRENCY,
      name: workerId
    }
  );

  return {
    queue: durableQueue,
    close: async () => {
      await worker.close();
      await queue.close();
    }
  };
}

export function createNotificationQueueTransport({
  env,
  QueueCtor = Queue as unknown as BullMqQueueConstructor
}: {
  env: NotificationQueueRuntimeEnv;
  QueueCtor?: BullMqQueueConstructor;
}) {
  const queueName = "notification-delivery";
  const queue = new QueueCtor(queueName, {
    connection: { url: env.REDIS_URL },
    prefix: env.NOTIFICATION_QUEUE_PREFIX
  });

  const durableQueue = createBullMqDurableQueue<NotificationQueuePayload>({
    name: queueName,
    queue,
    maxAttempts: env.NOTIFICATION_QUEUE_ATTEMPTS,
    retryBackoffMs: env.NOTIFICATION_QUEUE_BACKOFF_MS
  });

  return {
    queue: durableQueue,
    close: async () => {
      await queue.close();
    }
  };
}
