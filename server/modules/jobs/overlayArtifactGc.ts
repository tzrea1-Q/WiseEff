import { randomUUID } from "node:crypto";

import { writePlatformAuditEvent } from "../audit/repository";
import {
  listExpiredReloadArtifactRuns,
  type ExpiredReloadArtifactRow
} from "../dts-reload/repository";
import {
  sweepExpiredReloadArtifacts,
  type SweepReloadArtifactsResult
} from "../dts-reload/service";
import { RELOAD_ARTIFACT_RETENTION_DAYS } from "../dts-reload/types";
import type { ObjectStore } from "../logs/objectStore";
import type { Database, Queryable } from "../../shared/database/client";
import { decideRetry } from "./retryPolicy";
import {
  claimNextOverlayArtifactGcJob,
  completeJob,
  createOverlayArtifactGcJob,
  findLiveOverlayArtifactGcJob,
  markJobDeadLettered,
  markJobRetryScheduled
} from "./repository";
import type { OverlayArtifactGcJobDto } from "./types";

export const OVERLAY_ARTIFACT_GC_JOB_KIND = "overlay-artifact-gc" as const;
export const OVERLAY_ARTIFACT_GC_STAGE = "sweep";

export type ProcessOverlayArtifactGcOptions = {
  db: Database;
  objectStore: ObjectStore;
  workerId?: string;
  leaseTtlMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  now?: () => Date;
  sweep?: (
    db: Database,
    objectStore: ObjectStore,
    options?: { now?: () => Date; batchLimit?: number; organizationId?: string }
  ) => Promise<SweepReloadArtifactsResult>;
};

export type ProcessOverlayArtifactGcResult =
  | { status: "processed"; digest: SweepReloadArtifactsResult }
  | { status: "idle" }
  | { status: "retry"; reason: string }
  | { status: "dead-lettered"; reason: string };

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function retentionCutoffIso(now: Date) {
  const retentionMs = RELOAD_ARTIFACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - retentionMs).toISOString();
}

export async function enqueueOverlayArtifactGcJob(
  db: Queryable,
  input: { organizationId: string; id?: string }
): Promise<OverlayArtifactGcJobDto> {
  const live = await findLiveOverlayArtifactGcJob(db, input.organizationId);
  if (live) {
    return live;
  }

  return createOverlayArtifactGcJob(db, {
    id: input.id ?? randomUUID(),
    organizationId: input.organizationId
  });
}

export async function enqueueOverlayArtifactGcJobsForExpiredArtifacts(
  db: Queryable,
  options: { now?: () => Date; batchLimit?: number } = {}
): Promise<OverlayArtifactGcJobDto[]> {
  const now = options.now ?? (() => new Date());
  const expired = await listExpiredReloadArtifactRuns(db, {
    olderThanIso: retentionCutoffIso(now()),
    limit: options.batchLimit ?? 200
  });
  const organizationIds = uniqueOrganizationIds(expired);
  const jobs: OverlayArtifactGcJobDto[] = [];
  for (const organizationId of organizationIds) {
    jobs.push(await enqueueOverlayArtifactGcJob(db, { organizationId }));
  }
  return jobs;
}

function uniqueOrganizationIds(rows: ExpiredReloadArtifactRow[]) {
  return [...new Set(rows.map((row) => row.organization_id))];
}

export async function processNextOverlayArtifactGcJob(
  options: ProcessOverlayArtifactGcOptions
): Promise<ProcessOverlayArtifactGcResult> {
  const workerId = options.workerId ?? "overlay-artifact-gc-worker";
  const maxAttempts = options.maxAttempts ?? 4;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1000;
  const now = options.now ?? (() => new Date());
  const sweep = options.sweep ?? sweepExpiredReloadArtifacts;

  const job = await claimNextOverlayArtifactGcJob(options.db, {
    leaseOwner: workerId,
    leaseTtlMs: options.leaseTtlMs
  });
  if (!job) {
    return { status: "idle" };
  }

  const leaseOwner = job.leaseOwner ?? workerId;

  try {
    const digest = await sweep(options.db, options.objectStore, {
      now,
      organizationId: job.organizationId
    });

    await writePlatformAuditEvent(options.db, {
      projectId: null,
      actorUserId: null,
      actorType: "system",
      app: "dts-reload",
      kind: OVERLAY_ARTIFACT_GC_JOB_KIND,
      action: "sweep",
      severity: "Low",
      targetType: OVERLAY_ARTIFACT_GC_JOB_KIND,
      targetId: job.id,
      metadata: {
        scannedRuns: digest.scannedRuns,
        reclaimedRuns: digest.reclaimedRuns,
        deletedBlobs: digest.deletedBlobs,
        organizationId: job.organizationId
      },
      traceId: job.id,
      affectedOrganizationIds: [job.organizationId]
    });

    const completed = await completeJob(options.db, {
      organizationId: job.organizationId,
      jobId: job.id,
      currentStage: OVERLAY_ARTIFACT_GC_STAGE,
      leaseOwner
    });
    if (!completed) {
      throw new Error("Overlay artifact GC job lease was lost before completion.");
    }

    return { status: "processed", digest };
  } catch (error) {
    const message = readableError(error);
    const decision = decideRetry({
      attemptCount: job.attemptCount,
      maxAttempts,
      baseDelayMs: retryBaseDelayMs,
      now: now()
    });

    if (decision.action === "retry") {
      await markJobRetryScheduled(options.db, {
        organizationId: job.organizationId,
        jobId: job.id,
        error: message,
        currentStage: OVERLAY_ARTIFACT_GC_STAGE,
        nextRunAt: decision.nextRunAt,
        reason: decision.reason,
        leaseOwner
      });
      return { status: "retry", reason: decision.reason };
    }

    await markJobDeadLettered(options.db, {
      organizationId: job.organizationId,
      jobId: job.id,
      error: message,
      reason: decision.reason,
      currentStage: OVERLAY_ARTIFACT_GC_STAGE,
      leaseOwner
    });
    return { status: "dead-lettered", reason: decision.reason };
  }
}

export async function drainOverlayArtifactGcJobs(
  options: ProcessOverlayArtifactGcOptions
): Promise<ProcessOverlayArtifactGcResult[]> {
  const results: ProcessOverlayArtifactGcResult[] = [];
  for (;;) {
    const result = await processNextOverlayArtifactGcJob(options);
    if (result.status === "idle") {
      break;
    }
    results.push(result);
  }
  return results;
}
