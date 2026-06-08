import { describe, expect, it, vi } from "vitest";

import { createBullMqDurableQueue, createInMemoryDurableQueue } from "./bullmqQueue";

describe("durable queue adapter contract", () => {
  it("deduplicates enqueued jobs by idempotency key", async () => {
    const queue = createInMemoryDurableQueue({ name: "log-analysis" });

    const first = await queue.enqueue({
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1"
    });
    const second = await queue.enqueue({
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1"
    });

    expect(second).toEqual(first);
    await expect(queue.getStats()).resolves.toMatchObject({ waiting: 1, active: 0, failed: 0, paused: false });
  });

  it("processes jobs with retry metadata and records completion", async () => {
    const queue = createInMemoryDurableQueue({ name: "log-analysis", maxAttempts: 3 });
    await queue.enqueue({
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1"
    });

    const processed: string[] = [];
    const result = await queue.processNext(async (job) => {
      processed.push(String(job.payload.jobId));
      return { status: "completed" };
    });

    expect(result).toEqual({ status: "completed", idempotencyKey: "log-analysis:job-1" });
    expect(processed).toEqual(["job-1"]);
    await expect(queue.getStats()).resolves.toMatchObject({ waiting: 0, active: 0, completed: 1, failed: 0 });
  });

  it("schedules retries then dead-letters after max attempts", async () => {
    const queue = createInMemoryDurableQueue({ name: "log-analysis", maxAttempts: 2, retryBackoffMs: 250 });
    await queue.enqueue({
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1"
    });

    const first = await queue.processNext(async () => {
      throw new Error("worker crashed");
    });
    const second = await queue.processNext(async () => {
      throw new Error("worker crashed again");
    });

    expect(first).toEqual({
      status: "retry",
      idempotencyKey: "log-analysis:job-1",
      attempt: 1,
      nextRunDelayMs: 250,
      reason: "worker crashed"
    });
    expect(second).toEqual({
      status: "dead-lettered",
      idempotencyKey: "log-analysis:job-1",
      attempt: 2,
      reason: "worker crashed again"
    });
    await expect(queue.getStats()).resolves.toMatchObject({ waiting: 0, active: 0, completed: 0, failed: 1 });
  });

  it("pauses, resumes, and reports health", async () => {
    const queue = createInMemoryDurableQueue({ name: "log-analysis" });
    await queue.enqueue({
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1"
    });

    await queue.pause();
    await expect(queue.processNext(async () => ({ status: "completed" }))).resolves.toEqual({ status: "paused" });
    await expect(queue.checkHealth()).resolves.toMatchObject({ ok: false, status: "degraded", paused: true });

    await queue.resume();
    await expect(queue.checkHealth()).resolves.toMatchObject({ ok: true, status: "ready", paused: false });
  });
});

describe("BullMQ durable queue wrapper", () => {
  it("maps WiseEff enqueue options to BullMQ job options", async () => {
    const add = vi.fn(async () => ({ id: "bull-job-1" }));
    const queue = createBullMqDurableQueue({
      name: "log-analysis",
      queue: {
        add,
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(),
        close: vi.fn()
      },
      maxAttempts: 4,
      retryBackoffMs: 1500
    });

    await expect(
      queue.enqueue({
        name: "analyze-log",
        payload: { jobId: "job-1" },
        idempotencyKey: "log-analysis:job-1"
      })
    ).resolves.toEqual({
      id: "bull-job-1",
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1",
      attempt: 0
    });
    expect(add).toHaveBeenCalledWith(
      "analyze-log",
      { jobId: "job-1" },
      {
        jobId: "log-analysis:job-1",
        attempts: 4,
        backoff: { type: "exponential", delay: 1500 },
        removeOnComplete: false,
        removeOnFail: false
      }
    );
  });

  it("reports BullMQ stats and safe health failures", async () => {
    const queue = createBullMqDurableQueue({
      name: "log-analysis",
      queue: {
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(async () => ({
          waiting: 2,
          active: 1,
          completed: 3,
          failed: 0,
          delayed: 4,
          paused: 0
        })),
        close: vi.fn()
      }
    });

    await expect(queue.getStats()).resolves.toEqual({
      waiting: 2,
      active: 1,
      completed: 3,
      failed: 0,
      delayed: 4,
      paused: false
    });
    await expect(queue.checkHealth()).resolves.toMatchObject({ ok: true, status: "ready" });
  });

  it("reports failed health when BullMQ counts throw", async () => {
    const queue = createBullMqDurableQueue({
      name: "log-analysis",
      queue: {
        add: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        getJobCounts: vi.fn(async () => {
          throw new Error("ECONNREFUSED 127.0.0.1:6379");
        }),
        close: vi.fn()
      }
    });

    await expect(queue.checkHealth()).resolves.toEqual({
      ok: false,
      status: "failed",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
      message: "ECONNREFUSED 127.0.0.1:6379"
    });
  });
});
