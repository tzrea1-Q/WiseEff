import { Queue, Worker } from "bullmq";

import { createBullMqDurableQueue } from "../jobs/bullmqQueue";
import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "./objectStore";
import type { LogAnalysisQueuePayload } from "./logAnalysisQueue";
import { processLogAnalysisJobById, type ProcessLogWorkerByIdOptions, type ProcessLogWorkerResult } from "./worker";

export type LogAnalysisQueueRuntimeEnv = {
  REDIS_URL: string;
  LOG_ANALYSIS_QUEUE_PREFIX: string;
  LOG_ANALYSIS_QUEUE_ATTEMPTS: number;
  LOG_ANALYSIS_QUEUE_BACKOFF_MS: number;
  LOG_ANALYSIS_QUEUE_CONCURRENCY: number;
};

type BullMqQueueConstructor = new (
  name: string,
  options: { connection: { url: string }; prefix: string }
) => {
  add: (name: string, data: LogAnalysisQueuePayload, options: unknown) => Promise<{ id?: string | number }>;
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
  processor: (job: { data: LogAnalysisQueuePayload }) => Promise<"processed" | "idle" | "dead-lettered">,
  options: { connection: { url: string }; prefix: string; concurrency: number; name: string }
) => { close: () => Promise<void> };

type CreateLogAnalysisQueueRuntimeOptions = {
  env: LogAnalysisQueueRuntimeEnv;
  db: Database;
  objectStore: ObjectStore;
  QueueCtor?: BullMqQueueConstructor;
  WorkerCtor?: BullMqWorkerConstructor;
  processByJobId?: (options: ProcessLogWorkerByIdOptions) => Promise<ProcessLogWorkerResult>;
  workerId?: string;
};

export function createLogAnalysisQueueRuntime({
  env,
  db,
  objectStore,
  QueueCtor = Queue as unknown as BullMqQueueConstructor,
  WorkerCtor = Worker as unknown as BullMqWorkerConstructor,
  processByJobId = processLogAnalysisJobById,
  workerId = "wiseeff-log-worker"
}: CreateLogAnalysisQueueRuntimeOptions) {
  const queueName = "log-analysis";
  const connection = { url: env.REDIS_URL };
  const queue = new QueueCtor(queueName, {
    connection,
    prefix: env.LOG_ANALYSIS_QUEUE_PREFIX
  });
  const durableQueue = createBullMqDurableQueue<LogAnalysisQueuePayload>({
    name: queueName,
    queue,
    maxAttempts: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
    retryBackoffMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS
  });
  const worker = new WorkerCtor(
    queueName,
    async (job) => {
      const jobId = job.data?.jobId;
      if (!jobId) {
        throw new Error("BullMQ log-analysis job payload must include jobId.");
      }

      const result = await processByJobId({
        db,
        objectStore,
        jobId,
        workerId,
        maxAttempts: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
        retryBaseDelayMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS
      });
      if (result.status === "retry") {
        throw new Error(result.reason);
      }
      return result.status;
    },
    {
      connection,
      prefix: env.LOG_ANALYSIS_QUEUE_PREFIX,
      concurrency: env.LOG_ANALYSIS_QUEUE_CONCURRENCY,
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

export function createLogAnalysisQueueTransport({
  env,
  QueueCtor = Queue as unknown as BullMqQueueConstructor
}: {
  env: LogAnalysisQueueRuntimeEnv;
  QueueCtor?: BullMqQueueConstructor;
}) {
  const queueName = "log-analysis";
  const queue = new QueueCtor(queueName, {
    connection: { url: env.REDIS_URL },
    prefix: env.LOG_ANALYSIS_QUEUE_PREFIX
  });

  const durableQueue = createBullMqDurableQueue<LogAnalysisQueuePayload>({
    name: queueName,
    queue,
    maxAttempts: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
    retryBackoffMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS
  });

  return {
    queue: durableQueue,
    close: async () => {
      await queue.close();
    }
  };
}
