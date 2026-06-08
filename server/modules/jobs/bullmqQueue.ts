import { randomUUID } from "node:crypto";

import type {
  DurableQueue,
  DurableQueueEnqueueInput,
  DurableQueueHealth,
  DurableQueueJob,
  DurableQueueJobPayload,
  DurableQueueProcessResult,
  DurableQueueStats
} from "./queuePort";

export type InMemoryDurableQueueOptions = {
  name: string;
  maxAttempts?: number;
  retryBackoffMs?: number;
};

type BullMqJob = {
  id?: string | number;
};

type BullMqJobCounts = {
  waiting?: number;
  active?: number;
  completed?: number;
  failed?: number;
  delayed?: number;
  paused?: number;
};

type BullMqQueueLike<TPayload extends DurableQueueJobPayload> = {
  add(
    name: string,
    payload: TPayload,
    options: {
      jobId: string;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
      removeOnComplete: boolean;
      removeOnFail: boolean;
    }
  ): Promise<BullMqJob>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getJobCounts(): Promise<BullMqJobCounts>;
  close(): Promise<void>;
};

export type BullMqDurableQueueOptions<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload> = {
  name: string;
  queue: BullMqQueueLike<TPayload>;
  maxAttempts?: number;
  retryBackoffMs?: number;
};

type QueueEntry<TPayload extends DurableQueueJobPayload> = DurableQueueJob<TPayload> & {
  status: "waiting" | "active" | "completed" | "failed";
};

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function createInMemoryDurableQueue<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload>(
  options: InMemoryDurableQueueOptions
): DurableQueue<TPayload> {
  const jobsByIdempotencyKey = new Map<string, QueueEntry<TPayload>>();
  let paused = false;

  function stats(): DurableQueueStats {
    const entries = [...jobsByIdempotencyKey.values()];
    return {
      waiting: entries.filter((job) => job.status === "waiting").length,
      active: entries.filter((job) => job.status === "active").length,
      completed: entries.filter((job) => job.status === "completed").length,
      failed: entries.filter((job) => job.status === "failed").length,
      delayed: 0,
      paused
    };
  }

  return {
    async enqueue(input: DurableQueueEnqueueInput<TPayload>) {
      const existing = jobsByIdempotencyKey.get(input.idempotencyKey);
      if (existing) return existing;

      const job: QueueEntry<TPayload> = {
        id: randomUUID(),
        name: input.name,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        attempt: 0,
        status: "waiting"
      };
      jobsByIdempotencyKey.set(input.idempotencyKey, job);
      return job;
    },

    async processNext(handler): Promise<DurableQueueProcessResult> {
      if (paused) return { status: "paused" };
      const job = [...jobsByIdempotencyKey.values()].find((entry) => entry.status === "waiting");
      if (!job) return { status: "idle" };

      job.status = "active";
      job.attempt += 1;

      try {
        await handler(job);
        job.status = "completed";
        return { status: "completed", idempotencyKey: job.idempotencyKey };
      } catch (error) {
        const reason = readableError(error);
        if (job.attempt < (options.maxAttempts ?? 4)) {
          job.status = "waiting";
          return {
            status: "retry",
            idempotencyKey: job.idempotencyKey,
            attempt: job.attempt,
            nextRunDelayMs: options.retryBackoffMs ?? 1000,
            reason
          };
        }

        job.status = "failed";
        return {
          status: "dead-lettered",
          idempotencyKey: job.idempotencyKey,
          attempt: job.attempt,
          reason
        };
      }
    },

    async pause() {
      paused = true;
    },

    async resume() {
      paused = false;
    },

    async getStats() {
      return stats();
    },

    async checkHealth(): Promise<DurableQueueHealth> {
      const current = stats();
      if (paused) {
        return {
          ...current,
          ok: false,
          status: "degraded",
          message: `Durable queue ${options.name} is paused.`
        };
      }
      if (current.failed > 0) {
        return {
          ...current,
          ok: false,
          status: "degraded",
          message: `${current.failed} durable queue job(s) are dead-lettered.`
        };
      }
      return {
        ...current,
        ok: true,
        status: "ready"
      };
    }
  };
}

export function createBullMqDurableQueue<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload>(
  options: BullMqDurableQueueOptions<TPayload>
): DurableQueue<TPayload> {
  const maxAttempts = options.maxAttempts ?? 4;
  const retryBackoffMs = options.retryBackoffMs ?? 1000;

  async function getStats(): Promise<DurableQueueStats> {
    const counts = await options.queue.getJobCounts();
    return {
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      paused: (counts.paused ?? 0) > 0
    };
  }

  return {
    async enqueue(input: DurableQueueEnqueueInput<TPayload>) {
      const job = await options.queue.add(input.name, input.payload, {
        jobId: input.idempotencyKey,
        attempts: maxAttempts,
        backoff: { type: "exponential", delay: retryBackoffMs },
        removeOnComplete: false,
        removeOnFail: false
      });

      return {
        id: String(job.id ?? input.idempotencyKey),
        name: input.name,
        payload: input.payload,
        idempotencyKey: input.idempotencyKey,
        attempt: 0
      };
    },

    async processNext(): Promise<DurableQueueProcessResult> {
      return { status: "idle" };
    },

    async pause() {
      await options.queue.pause();
    },

    async resume() {
      await options.queue.resume();
    },

    getStats,

    async checkHealth(): Promise<DurableQueueHealth> {
      try {
        const current = await getStats();
        if (current.paused) {
          return {
            ...current,
            ok: false,
            status: "degraded",
            message: `Durable queue ${options.name} is paused.`
          };
        }
        if (current.failed > 0) {
          return {
            ...current,
            ok: false,
            status: "degraded",
            message: `${current.failed} durable queue job(s) are dead-lettered.`
          };
        }
        return {
          ...current,
          ok: true,
          status: "ready"
        };
      } catch (error) {
        return {
          ok: false,
          status: "failed",
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: false,
          message: readableError(error)
        };
      }
    }
  };
}
