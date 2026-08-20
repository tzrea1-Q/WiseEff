import { Queue } from "bullmq";
import pg from "pg";

export type QueueMaintenanceAction = "pause" | "drain" | "resume" | "status";

export type QueueMaintenanceArgs = {
  action: QueueMaintenanceAction;
  timeoutMs: number;
};

export type QueueMaintenanceEnv = {
  LOG_ANALYSIS_QUEUE_MODE?: string;
  LOG_ANALYSIS_QUEUE_PREFIX?: string;
  NOTIFICATION_DELIVERY_MODE?: string;
  NOTIFICATION_QUEUE_MODE?: string;
  NOTIFICATION_QUEUE_PREFIX?: string;
};

export type QueueMaintenancePlanEntry = {
  name: "log-analysis" | "notifications";
  prefix: string;
};

export function parseQueueMaintenanceArgs(args: readonly string[]): QueueMaintenanceArgs {
  const action = args[0] as QueueMaintenanceAction | undefined;
  if (!action || !["pause", "drain", "resume", "status"].includes(action)) {
    throw new Error("Usage: queue-maintenance.ts <pause|drain|resume|status> [--timeout-ms N]");
  }

  let timeoutMs = 30_000;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--timeout-ms") {
      const value = Number(args[index + 1]);
      if (!Number.isInteger(value) || value <= 0) throw new Error("--timeout-ms must be a positive integer.");
      timeoutMs = value;
      index += 1;
    } else {
      throw new Error(`Unknown queue maintenance argument: ${arg}`);
    }
  }

  return { action, timeoutMs };
}

export function buildQueueMaintenancePlan(env: QueueMaintenanceEnv): QueueMaintenancePlanEntry[] {
  const plan: QueueMaintenancePlanEntry[] = [];
  if (env.LOG_ANALYSIS_QUEUE_MODE === "durable") {
    plan.push({ name: "log-analysis", prefix: env.LOG_ANALYSIS_QUEUE_PREFIX?.trim() || "wiseeff" });
  }
  if (env.NOTIFICATION_DELIVERY_MODE === "async" && env.NOTIFICATION_QUEUE_MODE === "durable") {
    plan.push({ name: "notifications", prefix: env.NOTIFICATION_QUEUE_PREFIX?.trim() || "wiseeff" });
  }
  return plan;
}

type QueueLike = {
  pause(): Promise<void>;
  resume(): Promise<void>;
  getJobCounts(): Promise<Record<string, number | undefined>>;
  close(): Promise<void>;
};

type QueueConstructor = new (name: string, options: { connection: { url: string }; prefix: string }) => QueueLike;

type QueueMaintenanceDependencies = {
  QueueCtor?: QueueConstructor;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export async function runQueueMaintenance(
  args: QueueMaintenanceArgs,
  {
    env = process.env,
    dependencies = {}
  }: { env?: NodeJS.ProcessEnv; dependencies?: QueueMaintenanceDependencies } = {}
) {
  const plan = buildQueueMaintenancePlan(env);
  if (plan.length === 0) {
    if (args.action === "drain") await waitForPollingDrain(args.timeoutMs, env, dependencies);
    return { mode: "polling", queues: [], drained: true } as const;
  }

  const QueueCtor = dependencies.QueueCtor ?? (Queue as unknown as QueueConstructor);
  const redisUrl = env.REDIS_URL?.trim();
  if (!redisUrl) throw new Error("REDIS_URL is required for durable queue maintenance.");

  const queues = plan.map((entry) => ({ entry, queue: new QueueCtor(entry.name, { connection: { url: redisUrl }, prefix: entry.prefix }) }));
  try {
    if (args.action === "pause") {
      await Promise.all(queues.map(({ queue }) => queue.pause()));
    } else if (args.action === "resume") {
      await Promise.all(queues.map(({ queue }) => queue.resume()));
    } else if (args.action === "drain") {
      await waitForDurableDrain(queues.map(({ entry, queue }) => ({ entry, queue })), args.timeoutMs, dependencies);
    }

    const stats = await Promise.all(
      queues.map(async ({ entry, queue }) => ({ entry, counts: await queue.getJobCounts() }))
    );
    return { mode: "durable", queues: stats, drained: stats.every(({ counts }) => (counts.active ?? 0) === 0) } as const;
  } finally {
    await Promise.all(queues.map(({ queue }) => queue.close()));
  }
}

async function waitForDurableDrain(
  queues: Array<{ entry: QueueMaintenancePlanEntry; queue: QueueLike }>,
  timeoutMs: number,
  dependencies: QueueMaintenanceDependencies
) {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  while (true) {
    const counts = await Promise.all(queues.map(async ({ queue }) => queue.getJobCounts()));
    if (counts.every((current) => (current.active ?? 0) === 0)) return;
    if (now() >= deadline) throw new Error("Timed out waiting for durable queues to drain.");
    await sleep(250);
  }
}

async function waitForPollingDrain(timeoutMs: number, env: NodeJS.ProcessEnv, dependencies: QueueMaintenanceDependencies) {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return;
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  try {
    while (true) {
      const result = await pool.query<{ processing: string }>(
        "select count(*) filter (where status = 'processing')::text as processing from jobs where kind = $1",
        ["log-analysis"]
      );
      if (Number(result.rows[0]?.processing ?? 0) === 0) return;
      if (now() >= deadline) throw new Error("Timed out waiting for polling workers to drain.");
      await sleep(250);
    }
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = parseQueueMaintenanceArgs(process.argv.slice(2));
  const result = await runQueueMaintenance(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1]?.endsWith("queue-maintenance.ts")) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${redactOperationalMessage(message)}\n`);
    process.exitCode = 1;
  }
}

function redactOperationalMessage(message: string) {
  return message
    .replace(/([a-z]+:\/\/)[^\s/]+(?::[^\s/@]+)?@/gi, "$1<redacted>@")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1<redacted>")
    .replace(/(api[_-]?key|secret|password)([=:])[^\s]+/gi, "$1$2<redacted>");
}
