import { randomUUID } from "node:crypto";
import type pg from "pg";

import type { CatalogInstaller } from "../../catalog-kernel/install/installer";
import type { Database } from "../../../shared/database/client";
import { withPublicationCoordinator } from "../coordinator";
import { claimPublicationJob } from "./claim";
import {
  executeClaimedPublicationJob,
  recoverPublicationJobFromReceipt,
  type ResolvePublisherActor,
} from "./execute";

export type PublicationManagerEnv = {
  readonly WISEEFF_PUBLICATION_MANAGER_LEASE_MS?: string;
  readonly WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET?: string;
  readonly WISEEFF_PUBLICATION_MANAGER_POLL_INTERVAL_MS?: string;
  readonly WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS?: string;
};

export function assertPublicationManagerProcessFence(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): void {
  if (env.WISEEFF_CATALOG_SYNCHRONIZER_DATABASE_URL && env.WISEEFF_API_PROCESS === "1") {
    throw new Error("publication manager must not share the API process identity");
  }
}

export type PublicationManagerOptions = {
  readonly db: Database;
  readonly pool: pg.Pool;
  readonly installer: CatalogInstaller;
  readonly resolvePublisherActor: ResolvePublisherActor;
  readonly leaseMs?: number;
  readonly retryBudget?: number;
  readonly pollIntervalMs?: number;
  readonly activationTimeoutMs?: number;
  readonly ownerId?: string;
  readonly now?: () => number;
  readonly log?: (fields: Record<string, string | number | boolean | null>) => void;
};

export type PublicationManagerHealth = {
  readonly live: true;
  readonly oldestQueuedAgeSeconds: number | null;
  readonly runningCount: number;
  readonly queuedCount: number;
  readonly attemptSum: number;
  readonly rebaseCount: number;
};

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_RETRY_BUDGET = 5;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_ACTIVATION_TIMEOUT_MS = 60_000;

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("publication manager env integer must be a positive integer");
  }
  return value;
};

export function resolvePublicationManagerOptions(env: PublicationManagerEnv): {
  readonly leaseMs: number;
  readonly retryBudget: number;
  readonly pollIntervalMs: number;
  readonly activationTimeoutMs: number;
} {
  return {
    leaseMs: parsePositiveInt(env.WISEEFF_PUBLICATION_MANAGER_LEASE_MS, DEFAULT_LEASE_MS),
    retryBudget: parsePositiveInt(env.WISEEFF_PUBLICATION_MANAGER_RETRY_BUDGET, DEFAULT_RETRY_BUDGET),
    pollIntervalMs: parsePositiveInt(
      env.WISEEFF_PUBLICATION_MANAGER_POLL_INTERVAL_MS,
      DEFAULT_POLL_INTERVAL_MS,
    ),
    activationTimeoutMs: parsePositiveInt(
      env.WISEEFF_PUBLICATION_MANAGER_ACTIVATION_TIMEOUT_MS,
      DEFAULT_ACTIVATION_TIMEOUT_MS,
    ),
  };
}

export async function readPublicationManagerHealth(db: Database): Promise<PublicationManagerHealth> {
  return withPublicationCoordinator(db, async (tx) => {
    const result = await tx.query<{
      oldest_queued_age_seconds: string | null;
      running_count: string;
      queued_count: string;
      attempt_sum: string;
      rebase_count: string;
    }>(
      `select
         extract(epoch from (now() - min(created_at) filter (where status = 'queued')))::text
           as oldest_queued_age_seconds,
         count(*) filter (where status = 'running')::text as running_count,
         count(*) filter (where status = 'queued')::text as queued_count,
         coalesce(sum(attempt_count), 0)::text as attempt_sum,
         count(*) filter (where status = 'needs-rebase')::text as rebase_count
       from catalog_publication.publication_jobs`,
    );
    const row = result.rows[0];
    return {
      live: true,
      oldestQueuedAgeSeconds:
        row?.oldest_queued_age_seconds === null || row?.oldest_queued_age_seconds === undefined
          ? null
          : Number(row.oldest_queued_age_seconds),
      runningCount: Number(row?.running_count ?? 0),
      queuedCount: Number(row?.queued_count ?? 0),
      attemptSum: Number(row?.attempt_sum ?? 0),
      rebaseCount: Number(row?.rebase_count ?? 0),
    };
  });
}

export async function runPublicationManagerOnce(options: PublicationManagerOptions): Promise<"claimed" | "idle"> {
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  const retryBudget = options.retryBudget ?? DEFAULT_RETRY_BUDGET;
  const ownerId = options.ownerId ?? `mgr_${randomUUID().slice(0, 8)}`;
  const leaseSeconds = Math.max(1, Math.ceil(leaseMs / 1000));
  const log = options.log ?? (() => undefined);

  const claimed = await withPublicationCoordinator(options.db, (tx) =>
    claimPublicationJob(tx, { leaseOwner: ownerId, leaseSeconds }),
  );
  if (!claimed.ok) {
    return "idle";
  }

  log({
    jobId: claimed.value.id,
    fence: claimed.value.fencingToken,
    attempt: claimed.value.attemptCount,
    event: "claimed",
  });

  const activationTimeoutMs = options.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS;
  let executed: Awaited<ReturnType<typeof executeClaimedPublicationJob>>;
  try {
    executed = await Promise.race([
      executeClaimedPublicationJob({
        db: options.db,
        pool: options.pool,
        installer: options.installer,
        claimed: claimed.value,
        resolvePublisherActor: options.resolvePublisherActor,
        retryBudget,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("activation-timeout")), activationTimeoutMs);
      }),
    ]);
  } catch {
    const recovered = await withPublicationCoordinator(options.db, (tx) =>
      recoverPublicationJobFromReceipt(tx, options.pool, claimed.value),
    );
    executed = recovered ?? { kind: "settled", job: claimed.value };
    log({
      jobId: claimed.value.id,
      fence: claimed.value.fencingToken,
      attempt: claimed.value.attemptCount,
      event: "activation-timeout",
      reasonClass: "timeout",
    });
  }

  if (executed.kind === "activated") {
    log({
      jobId: executed.job.id,
      fence: executed.job.fencingToken,
      attempt: executed.job.attemptCount,
      event: "activated",
      currentness: executed.currentness,
      recoveredFromReceipt: executed.recoveredFromReceipt,
    });
  } else if (executed.kind === "stale-fence") {
    log({
      jobId: executed.job.id,
      fence: executed.job.fencingToken,
      attempt: executed.job.attemptCount,
      event: "stale-fence",
      reasonClass: "fence",
    });
  } else if (executed.kind === "settled") {
    log({
      jobId: executed.job.id,
      fence: executed.job.fencingToken,
      attempt: executed.job.attemptCount,
      event: "settled",
      status: executed.job.status,
      reasonClass: executed.job.lastErrorClass,
    });
  }
  return "claimed";
}

export function startPublicationManagerLoop(
  options: PublicationManagerOptions,
): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async () => {
    if (stopped) {
      return;
    }
    try {
      const result = await runPublicationManagerOnce(options);
      if (stopped) {
        return;
      }
      const delay = result === "claimed" ? 0 : pollIntervalMs;
      timer = setTimeout(() => {
        void tick();
      }, delay);
    } catch (error) {
      options.log?.({
        event: "manager-tick-error",
        reasonClass: error instanceof Error ? error.name : "unknown",
      });
      if (!stopped) {
        timer = setTimeout(() => {
          void tick();
        }, pollIntervalMs);
      }
    }
  };

  void tick();
  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
