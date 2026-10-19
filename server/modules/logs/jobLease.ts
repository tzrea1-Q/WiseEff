import type { Readable } from "node:stream";
import type { Database } from "../../shared/database/client";
import { renewJobLease } from "../jobs/repository";
import type { ObjectStore } from "./objectStore";

export class JobLeaseLostError extends Error {
  constructor() { super("Log analysis job lease was lost before the worker write completed."); }
}

export function logJobLimits(env: NodeJS.ProcessEnv = process.env) {
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 2_147_483_647 ? parsed : fallback;
  };
  return { maxJobMs: positive(env.LOG_ANALYSIS_JOB_MAX_MS, 600_000),
    preprocessingMs: positive(env.LOG_ANALYSIS_PREPROCESS_MAX_MS, 20_000) };
}

/** One claimed attempt: renewal never resets its wall deadline or preprocessing allowance. */
export function keepLogJobLease(db: Database, store: ObjectStore, input: {
  jobId: string; leaseOwner: string; leaseMs: number; maxJobMs: number;
}) {
  if (![input.leaseMs, input.maxJobMs].every((value) => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647)) {
    throw new RangeError("Log job and lease durations must be positive timer-safe integers.");
  }
  const controller = new AbortController();
  const { signal } = controller;
  const started = process.hrtime.bigint();
  const remainingMs = () => Math.max(0, input.maxJobMs - Number(process.hrtime.bigint() - started) / 1e6);
  let rejectStopped!: (reason: unknown) => void;
  const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject; });
  void stopped.catch(() => undefined);
  const streams = new Set<Readable>();
  signal.addEventListener("abort", () => {
    rejectStopped(signal.reason);
    for (const stream of streams) stream.destroy(signal.reason);
  }, { once: true });
  let finished = false;
  let heartbeat: ReturnType<typeof setTimeout> | undefined;
  let expires = setTimeout(() => controller.abort(new JobLeaseLostError()), input.leaseMs);
  const deadline = setTimeout(() => controller.abort(new Error("Log analysis job exceeded LOG_ANALYSIS_JOB_MAX_MS.")), input.maxJobMs);
  const renew = async () => {
    if (finished || signal.aborted) return;
    const requestedAt = process.hrtime.bigint();
    try {
      if (!await renewJobLease(db, input)) throw new JobLeaseLostError();
      if (finished || signal.aborted) return;
      clearTimeout(expires);
      const remainingLease = input.leaseMs - Number(process.hrtime.bigint() - requestedAt) / 1e6;
      if (remainingLease <= 0) throw new JobLeaseLostError();
      expires = setTimeout(() => controller.abort(new JobLeaseLostError()), remainingLease);
      heartbeat = setTimeout(() => { void renew(); }, Math.max(1, Math.floor(input.leaseMs / 3)));
    } catch {
      if (!finished) controller.abort(new JobLeaseLostError());
    }
  };
  heartbeat = setTimeout(() => { void renew(); }, Math.max(1, Math.floor(input.leaseMs / 3)));
  const run = async <T>(operation: () => Promise<T>): Promise<T> => {
    signal.throwIfAborted();
    const result = await Promise.race([operation(), stopped]);
    signal.throwIfAborted();
    return result;
  };
  const objectStore: ObjectStore = {
    ...store,
    get: (key) => run(() => store.get(key)),
    put: (value) => run(() => store.put(value)),
    ...(store.delete ? { delete: (key: string) => store.delete!(key) } : {}),
    ...(store.getBounded ? { getBounded: (key: string, max: number) => run(() => store.getBounded!(key, max)) } : {}),
    ...(store.getStream ? { getStream: (key: string, range?: { start: number; end?: number }) => run(async () => {
      const stream = await store.getStream!(key, range);
      if (signal.aborted) { stream.destroy(); signal.throwIfAborted(); }
      streams.add(stream);
      stream.once("close", () => streams.delete(stream));
      return stream;
    }) } : {})
  };
  return { signal, run, objectStore, remainingMs,
    stop() { finished = true; clearTimeout(heartbeat); clearTimeout(expires); clearTimeout(deadline); }
  };
}

export type LogJobLease = ReturnType<typeof keepLogJobLease>;
