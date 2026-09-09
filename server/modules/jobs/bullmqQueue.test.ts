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
  function harness() {
    const jobs = new Map<string, { id: string; data: Record<string, unknown> }>();
    const transport = {
      getJob: vi.fn(async (id: string) => jobs.get(id)),
      add: vi.fn(async (_name: string, data: Record<string, unknown>, options: { jobId: string }) => {
        if (!jobs.has(options.jobId)) jobs.set(options.jobId, { id: options.jobId, data });
        return { id: options.jobId, data }; // Native add can return requested, not persisted data.
      }),
      pause: vi.fn(), resume: vi.fn(), close: vi.fn(), getJobCounts: vi.fn()
    };
    return { jobs, transport, queue: createBullMqDurableQueue({ name: "synthetic", queue: transport }) };
  }
  const input = (idempotencyKey: string) => ({ name: "synthetic", payload: { jobId: "job" }, idempotencyKey });

  it("preserves an already persisted colon-key job without adding or renaming it", async () => {
    const h = harness();
    h.jobs.set("log-analysis:job", { id: "log-analysis:job", data: { jobId: "job" } });
    expect((await h.queue.enqueue(input("log-analysis:job"))).id).toBe("log-analysis:job");
    expect(h.transport.add).not.toHaveBeenCalled();
  });

  it("keeps safe existing IDs unchanged and encodes distinct keys without conflating their business payloads", async () => {
    const h = harness();
    const keys = ["safe-job", "log-analysis:job", "notification-outbox:job", "123", "x:\ud800", "x:\ufffd", "0:x:y"];
    const jobs = await Promise.all(keys.map(key => h.queue.enqueue(input(key))));
    expect(jobs[0].id).toBe("safe-job");
    expect(new Set(jobs.map(job => job.id)).size).toBe(keys.length);
    expect(jobs.every(job => !job.id.includes(":"))).toBe(true);
    expect(jobs.map(job => job.idempotencyKey)).toEqual(keys);
    expect(jobs.every(job => Object.keys(job.payload).join() === "jobId")).toBe(true);
    expect((await h.queue.enqueue(input(keys[1]))).id).toBe(jobs[1].id);
    expect((await h.queue.enqueue(input("legacy:three:parts"))).id).toBe("legacy:three:parts");
  });

  it("refuses an unmarked historical collision and a direct request for an encoded job's reserved ID", async () => {
    const h = harness();
    const encoded = (await h.queue.enqueue(input("log-analysis:job"))).id;
    await expect(h.queue.enqueue(input(encoded))).rejects.toThrow("durable-queue-key-collision");
    h.jobs.set(encoded, { id: encoded, data: { jobId: "foreign" } });
    h.transport.add.mockClear();
    await expect(h.queue.enqueue(input("log-analysis:job"))).rejects.toThrow("durable-queue-key-collision");
    expect(h.transport.add).not.toHaveBeenCalled();
  });

  it("checks persisted identity after add instead of trusting its returned Job", async () => {
    const h = harness();
    h.transport.add.mockImplementation(async (_name, data, options) => {
      h.jobs.set(options.jobId, { id: options.jobId, data: { jobId: "foreign" } });
      return { id: options.jobId, data };
    });
    await expect(h.queue.enqueue(input("log-analysis:job"))).rejects.toThrow("durable-queue-key-collision");
  });

  it("refuses new reserved IDs, empty keys and payload metadata spoofing without adding", async () => {
    const h = harness();
    await expect(h.queue.enqueue(input("wiseeff-durable-v1-new"))).rejects.toThrow("durable-queue-key-namespace-reserved");
    await expect(h.queue.enqueue(input(""))).rejects.toThrow("durable-queue-key-invalid");
    await expect(h.queue.enqueue({ ...input("safe"), payload: { $wiseeffDurableKeyV1: "spoof" } }))
      .rejects.toThrow("durable-queue-key-invalid");
    expect(h.transport.add).not.toHaveBeenCalled();
  });

  it("maps WiseEff enqueue options to BullMQ job options", async () => {
    let stored: { id: string; data: Record<string, unknown> } | undefined;
    const add = vi.fn(async (_name, data, options) => (stored = { id: options.jobId, data }));
    const queue = createBullMqDurableQueue({
      name: "log-analysis",
      queue: {
        add,
        getJob: vi.fn(async id => stored?.id === id ? stored : undefined),
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
      id: expect.stringMatching(/^wiseeff-durable-v1-/),
      name: "analyze-log",
      payload: { jobId: "job-1" },
      idempotencyKey: "log-analysis:job-1",
      attempt: 0
    });
    expect(add).toHaveBeenCalledWith(
      "analyze-log",
      { jobId: "job-1", $wiseeffDurableKeyV1: "log-analysis:job-1" },
      {
        jobId: expect.stringMatching(/^wiseeff-durable-v1-/),
        attempts: 4,
        backoff: { type: "exponential", delay: 1500 },
        removeOnComplete: false,
        removeOnFail: false
      }
    );
    expect(Buffer.from(stored!.id.slice("wiseeff-durable-v1-".length), "base64url").toString("utf16le"))
      .toBe("log-analysis:job-1");
  });

  it("reports BullMQ stats and safe health failures", async () => {
    const queue = createBullMqDurableQueue({
      name: "log-analysis",
      queue: {
        getJob: vi.fn(),
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
        getJob: vi.fn(),
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
