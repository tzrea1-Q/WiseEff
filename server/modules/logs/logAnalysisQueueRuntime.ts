import { Queue, RedisConnection, Worker } from "bullmq";

import { createBullMqDurableQueue } from "../jobs/bullmqQueue";
import type { MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import type { Database } from "../../shared/database/client";
import type { LogAnalysisAdapter } from "./analyzer";
import type { ObjectStore } from "./objectStore";
import type { LogAnalysisQueuePayload } from "./logAnalysisQueue";
import { processLogAnalysisJobById, type LogWorkerWebhooks, type ProcessLogWorkerByIdOptions, type ProcessLogWorkerResult } from "./worker";

export type LogAnalysisQueueRuntimeEnv = {
  REDIS_URL: string;
  LOG_ANALYSIS_QUEUE_PREFIX: string;
  LOG_ANALYSIS_QUEUE_ATTEMPTS: number;
  LOG_ANALYSIS_QUEUE_BACKOFF_MS: number;
  LOG_ANALYSIS_QUEUE_CONCURRENCY: number;
};

type BullMqQueueConstructor = new (
  name: string,
  options: { connection: { url: string }; prefix: string },
  Connection?: typeof RedisConnection
) => {
  on: (event: "error", listener: (error: Error) => void) => unknown;
  off: (event: "error", listener: (error: Error) => void) => unknown;
  waitUntilReady: () => Promise<unknown>;
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
  options: { connection: { url: string }; prefix: string; concurrency: number; name: string; autorun: false },
  Connection?: typeof RedisConnection
) => {
  on: (event: "error", listener: (error: Error) => void) => unknown;
  off: (event: "error", listener: (error: Error) => void) => unknown;
  waitUntilReady: () => Promise<unknown>;
  run: () => Promise<void>;
  close: (force?: boolean) => Promise<void>;
};

type CreateLogAnalysisQueueRuntimeOptions = {
  env: LogAnalysisQueueRuntimeEnv;
  db: Database;
  objectStore: ObjectStore;
  analyzer?: LogAnalysisAdapter;
  QueueCtor?: BullMqQueueConstructor;
  WorkerCtor?: BullMqWorkerConstructor;
  processByJobId?: (options: ProcessLogWorkerByIdOptions) => Promise<ProcessLogWorkerResult>;
  workerId?: string;
  metrics?: Pick<MetricsRegistry, "recordLogAnalysisJobResult">;
  tracing?: Pick<TracingBoundary, "withSpan">;
  webhooks?: LogWorkerWebhooks;
};

// BullMQ 5.78's close removes all listeners before its initialization rejection
// handler settles. Use its public Connection extension seam to drain that handler
// while error listeners still exist; otherwise failed AUTH can escape uncaught.
class DrainingRedisConnection extends RedisConnection {
  constructor(...args: ConstructorParameters<typeof RedisConnection>) {
    super(...args);
    DrainingRedisConnection.redactReadiness(this);
  }
  // Worker constructs its blocking RedisConnection without forwarding the public
  // Connection extension argument. Both instances have this same base-class
  // protected client; no RedisConnection private initialization field is read.
  static async drain(connection: RedisConnection) {
    const owned = connection as DrainingRedisConnection;
    if (owned.status === "initializing") {
      owned._client.disconnect();
      await owned.client.catch(() => {});
    }
  }
  static redactReadiness(connection: RedisConnection) {
    const client = (connection as DrainingRedisConnection)._client;
    const info = client.info.bind(client);
    // ioredis invokes this public method in callback form during its loading
    // readiness check and otherwise logs the server's raw NOPERM diagnostic.
    // Keep the check enabled: deny on failure, with a static error in both forms.
    client.info = ((...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback === "function") {
        args[args.length - 1] = (error: unknown, result: unknown) => callback(
          error ? new Error("PCAT-LOG-QUEUE-READINESS-FAILED") : null, result);
      }
      const result = Reflect.apply(info, client, args) as Promise<string>;
      return result.catch(() => {
        if (typeof callback === "function") return undefined;
        throw new Error("PCAT-LOG-QUEUE-READINESS-FAILED");
      });
    }) as typeof client.info;
  }
  override async close(force = false) {
    await DrainingRedisConnection.drain(this);
    await super.close(force);
  }
}

class DrainingWorker extends Worker {
  constructor(...args: ConstructorParameters<typeof Worker>) {
    super(...args);
    DrainingRedisConnection.redactReadiness(this.blockingConnection);
  }
  override async close(force = false) {
    await DrainingRedisConnection.drain(this.blockingConnection);
    await super.close(force);
  }
}

function observeConnectionErrors() {
  let phase: "initializing" | "running" | "closing" = "initializing";
  let closeEventFailed = false;
  let rejectStartup!: (reason: Error) => void;
  const startupFailure = new Promise<never>((_resolve, reject) => { rejectStartup = reject; });
  // BullMQ forwards connection/cleanup errors via EventEmitter and otherwise
  // prints the underlying error. Own that channel throughout resource lifetime.
  void startupFailure.catch(() => {});
  const onError = () => {
    if (phase === "initializing") rejectStartup(new Error("PCAT-LOG-QUEUE-INITIALIZATION-FAILED"));
    else if (phase === "closing") closeEventFailed = true;
    else console.error("PCAT-LOG-QUEUE-CONNECTION-ERROR");
  };
  return {
    onError, startupFailure,
    ready: () => { phase = "running"; },
    closing: () => { phase = "closing"; },
    assertClosed: () => { if (closeEventFailed) throw new Error("PCAT-LOG-QUEUE-CLOSE-FAILED"); }
  };
}

export async function createLogAnalysisQueueRuntime({
  env,
  db,
  objectStore,
  analyzer,
  QueueCtor = Queue as unknown as BullMqQueueConstructor,
  WorkerCtor = DrainingWorker as unknown as BullMqWorkerConstructor,
  processByJobId = processLogAnalysisJobById,
  workerId = "wiseeff-log-worker",
  metrics,
  tracing,
  webhooks
}: CreateLogAnalysisQueueRuntimeOptions) {
  const queueName = "log-analysis";
  const connection = { url: env.REDIS_URL };
  const errors = observeConnectionErrors();
  const { onError, startupFailure } = errors;
  const queue = new QueueCtor(queueName, {
    connection,
    prefix: env.LOG_ANALYSIS_QUEUE_PREFIX
  }, DrainingRedisConnection);
  queue.on("error", onError);
  let worker: InstanceType<BullMqWorkerConstructor> | undefined;
  try {
    const durableQueue = createBullMqDurableQueue<LogAnalysisQueuePayload>({
      name: queueName,
      queue,
      maxAttempts: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
      retryBackoffMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS
    });
    worker = new WorkerCtor(
      queueName,
      async (job) => {
        const attributes: Record<string, string | number | boolean> = { queue: queueName };
        const process = async () => {
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
            retryBaseDelayMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS,
            metrics,
            ...(analyzer ? { analyzer } : {}),
            ...(tracing ? { tracing } : {}),
            ...(webhooks ? { webhooks } : {})
          });
          if (result.status === "retry") {
            throw new Error(result.reason);
          }
          attributes.status = result.status;
          return result.status;
        };

        try {
          return tracing ? await tracing.withSpan("log_analysis.queue.process", attributes, process) : await process();
        } catch (error) {
          attributes.status = "failed";
          attributes.errorType = error instanceof Error ? error.name : "unknown";
          throw error;
        }
      },
      {
        connection,
        prefix: env.LOG_ANALYSIS_QUEUE_PREFIX,
        concurrency: env.LOG_ANALYSIS_QUEUE_CONCURRENCY,
        name: workerId,
        autorun: false
      },
      DrainingRedisConnection
    );
    worker.on("error", onError);
    try {
      await Promise.race([Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]), startupFailure]);
    } catch { throw new Error("PCAT-LOG-QUEUE-INITIALIZATION-FAILED"); }
    errors.ready();
    void worker.run().catch(onError);
    const activeWorker = worker;

    let closing: Promise<void> | undefined;
    return {
      queue: durableQueue,
      close: () => {
        closing ??= (async () => {
          errors.closing();
          const results = await Promise.allSettled([
            Promise.resolve().then(() => activeWorker.close()),
            Promise.resolve().then(() => queue.close())
          ]);
          activeWorker.off("error", onError);
          queue.off("error", onError);
          errors.assertClosed();
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        })();
        return closing;
      }
    };
  } catch (error) {
    errors.closing();
    await Promise.allSettled([
      Promise.resolve().then(() => worker?.close(true)),
      Promise.resolve().then(() => queue.close())
    ]);
    worker?.off("error", onError);
    queue.off("error", onError);
    throw error;
  }
}

export async function createLogAnalysisQueueTransport({
  env,
  QueueCtor = Queue as unknown as BullMqQueueConstructor
}: {
  env: LogAnalysisQueueRuntimeEnv;
  QueueCtor?: BullMqQueueConstructor;
}) {
  const queueName = "log-analysis";
  const errors = observeConnectionErrors();
  const queue = new QueueCtor(queueName, {
    connection: { url: env.REDIS_URL },
    prefix: env.LOG_ANALYSIS_QUEUE_PREFIX
  }, DrainingRedisConnection);
  queue.on("error", errors.onError);
  try {
    try { await Promise.race([queue.waitUntilReady(), errors.startupFailure]); }
    catch { throw new Error("PCAT-LOG-QUEUE-INITIALIZATION-FAILED"); }
    const durableQueue = createBullMqDurableQueue<LogAnalysisQueuePayload>({
      name: queueName, queue,
      maxAttempts: env.LOG_ANALYSIS_QUEUE_ATTEMPTS,
      retryBackoffMs: env.LOG_ANALYSIS_QUEUE_BACKOFF_MS
    });
    errors.ready();
    let closing: Promise<void> | undefined;
    return {
      queue: durableQueue,
      close: () => {
        closing ??= (async () => {
          errors.closing();
          try { await queue.close(); }
          finally { queue.off("error", errors.onError); }
          errors.assertClosed();
        })();
        return closing;
      }
    };
  } catch (error) {
    errors.closing();
    try { await queue.close(); } catch { /* Keep the original initialization refusal. */ }
    queue.off("error", errors.onError);
    throw error;
  }
}
