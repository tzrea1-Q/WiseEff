import type { Queryable } from "../../shared/database/client";

export type WorkerQueueHealth = {
  ok: boolean;
  status: "ready" | "degraded" | "failed";
  queued: number;
  processing: number;
  deadLettered: number;
  oldestQueuedAgeMs: number | null;
  message?: string;
};

export type WorkerQueueStats = {
  queued: number;
  processing: number;
  deadLettered: number;
  oldestQueuedAt: string | Date | null;
};

type WorkerQueueStatsRow = {
  queued: number | string;
  processing: number | string;
  dead_lettered: number | string;
  oldest_queued_at: string | Date | null;
};

export async function getWorkerQueueStats(db: Queryable, kind = "log-analysis"): Promise<WorkerQueueStats> {
  const result = await db.query<WorkerQueueStatsRow>(
    `
    select
      count(*) filter (where status = 'queued') as queued,
      count(*) filter (where status = 'processing') as processing,
      count(*) filter (where status = 'failed' and dead_lettered_at is not null) as dead_lettered,
      min(created_at) filter (where status = 'queued') as oldest_queued_at
    from jobs
    where kind = $1
    `,
    [kind]
  );
  const row = result.rows[0] ?? { queued: 0, processing: 0, dead_lettered: 0, oldest_queued_at: null };

  return {
    queued: Number(row.queued),
    processing: Number(row.processing),
    deadLettered: Number(row.dead_lettered),
    oldestQueuedAt: row.oldest_queued_at
  };
}

export function buildWorkerQueueHealth(input: WorkerQueueStats & { now?: Date }): WorkerQueueHealth {
  const now = input.now ?? new Date();
  const oldestQueuedAgeMs = input.oldestQueuedAt ? Math.max(0, now.getTime() - new Date(input.oldestQueuedAt).getTime()) : null;

  if (input.deadLettered > 0) {
    return {
      ok: false,
      status: "degraded",
      queued: input.queued,
      processing: input.processing,
      deadLettered: input.deadLettered,
      oldestQueuedAgeMs,
      message: `${input.deadLettered} log analysis job(s) are dead-lettered.`
    };
  }

  return {
    ok: true,
    status: "ready",
    queued: input.queued,
    processing: input.processing,
    deadLettered: input.deadLettered,
    oldestQueuedAgeMs
  };
}

export async function checkWorkerQueueHealth(db?: Queryable): Promise<WorkerQueueHealth> {
  if (!db) {
    return {
      ok: false,
      status: "failed",
      queued: 0,
      processing: 0,
      deadLettered: 0,
      oldestQueuedAgeMs: null,
      message: "DATABASE_URL is not configured for worker queue health."
    };
  }

  try {
    return buildWorkerQueueHealth(await getWorkerQueueStats(db));
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      queued: 0,
      processing: 0,
      deadLettered: 0,
      oldestQueuedAgeMs: null,
      message: error instanceof Error ? error.message : "Worker queue health check failed."
    };
  }
}
