export type DurableQueueJobPayload = Record<string, unknown>;

export type DurableQueueJob<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload> = {
  id: string;
  name: string;
  payload: TPayload;
  idempotencyKey: string;
  attempt: number;
};

export type DurableQueueEnqueueInput<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload> = {
  name: string;
  payload: TPayload;
  idempotencyKey: string;
};

export type DurableQueueProcessResult =
  | { status: "completed"; idempotencyKey: string }
  | { status: "retry"; idempotencyKey: string; attempt: number; nextRunDelayMs: number; reason: string }
  | { status: "dead-lettered"; idempotencyKey: string; attempt: number; reason: string }
  | { status: "idle" }
  | { status: "paused" };

export type DurableQueueStats = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
};

export type DurableQueueHealth = DurableQueueStats & {
  ok: boolean;
  status: "ready" | "degraded" | "failed";
  message?: string;
};

export type DurableQueue<TPayload extends DurableQueueJobPayload = DurableQueueJobPayload> = {
  enqueue(input: DurableQueueEnqueueInput<TPayload>): Promise<DurableQueueJob<TPayload>>;
  processNext(handler: (job: DurableQueueJob<TPayload>) => Promise<{ status: "completed" }>): Promise<DurableQueueProcessResult>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  getStats(): Promise<DurableQueueStats>;
  checkHealth(): Promise<DurableQueueHealth>;
};
