import { claimJobById, claimNextJob, failJob, getJobSnapshot, markJobDeadLettered, markJobRetryScheduled, updateJobProgress } from "../jobs/repository";
import type { ClaimedLogAnalysisJobDto } from "../jobs/types";
import type { Database } from "../../shared/database/client";
import { decideRetry } from "../jobs/retryPolicy";
import { createRuleBasedLogAnalyzer, type LogAnalysisAdapter } from "./analyzer";
import type { ObjectStore } from "./objectStore";
import { parseLogText } from "./parser";
import {
  completeLogAnalysisJobWithReport,
  failRun,
  getLogWorkerRunSnapshot as getActiveLogWorkerRunSnapshot,
  updateRunStageProgress
} from "./repository";
import type { LogStage } from "./status";

export type ProcessLogWorkerOptions = {
  db: Database;
  objectStore: ObjectStore;
  analyzer?: LogAnalysisAdapter;
  workerId?: string;
  leaseTtlMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  now?: () => Date;
};

export type ProcessLogWorkerByIdOptions = ProcessLogWorkerOptions & {
  jobId: string;
};

export type ProcessLogWorkerResult =
  | { status: "processed" }
  | { status: "idle" }
  | { status: "retry"; reason: string }
  | { status: "dead-lettered"; reason: string };

type StageStatus = "processing" | "complete" | "failed";

class JobLeaseLostError extends Error {
  constructor() {
    super("Log analysis job lease was lost before the worker write completed.");
  }
}

function assertActiveJobLease(updated: boolean) {
  if (!updated) {
    throw new JobLeaseLostError();
  }
}

async function markProgress(
  options: ProcessLogWorkerOptions,
  input: {
    organizationId: string;
    jobId: string;
    runId: string;
    stage: LogStage;
    status: StageStatus;
    progress: number;
    message: string;
    leaseOwner: string;
  }
) {
  assertActiveJobLease(
    await updateJobProgress(options.db, {
      organizationId: input.organizationId,
      jobId: input.jobId,
      progress: input.progress,
      currentStage: input.stage,
      leaseOwner: input.leaseOwner
    })
  );
  await updateRunStageProgress(options.db, {
    organizationId: input.organizationId,
    runId: input.runId,
    status: input.status === "failed" ? "failed" : "processing",
    stageStatus: input.status === "failed" ? "failed" : input.status,
    stage: input.stage,
    progress: input.progress,
    message: input.message
  });
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function processClaimedLogAnalysisJob(
  {
    db,
    objectStore,
    analyzer,
    workerId,
    maxAttempts,
    retryBaseDelayMs,
    now
  }: Required<Pick<ProcessLogWorkerOptions, "analyzer" | "workerId" | "maxAttempts" | "retryBaseDelayMs" | "now">> &
    Pick<ProcessLogWorkerOptions, "db" | "objectStore">,
  job: ClaimedLogAnalysisJobDto
): Promise<ProcessLogWorkerResult> {
  const leaseOwner = job.leaseOwner ?? workerId;

  const options = { db, objectStore, analyzer };
  const jobSnapshot = await getJobSnapshot(db, job.id);
  const snapshot = await getActiveLogWorkerRunSnapshot(db, job.id);

  if (!snapshot) {
    const staleReason = jobSnapshot
      ? "Log analysis job is stale because its run is no longer current."
      : "Unable to load log analysis job target.";

    const failedJob = await failJob(db, {
      organizationId: job.organizationId,
      jobId: job.id,
      currentStage: "parse",
      error: staleReason,
      leaseOwner
    });
    if (!failedJob) return { status: "idle" };

    if (jobSnapshot) {
      await updateRunStageProgress(db, {
        organizationId: jobSnapshot.organizationId,
        runId: jobSnapshot.runId,
        status: "failed",
        stageStatus: "failed",
        stage: jobSnapshot.currentStage,
        progress: jobSnapshot.progress,
        message: staleReason
      });
      await failRun(db, {
        organizationId: jobSnapshot.organizationId,
        logId: jobSnapshot.logId,
        runId: jobSnapshot.runId,
        currentStage: jobSnapshot.currentStage,
        error: staleReason
      });
    }
    return { status: "processed" };
  }

  let currentStage: LogStage = "parse";
  let currentProgress = 0;

  try {
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "parse",
      status: "processing",
      progress: 10,
      message: "Reading and parsing the uploaded log.",
      leaseOwner
    });
    currentProgress = 10;

    const bytes = await objectStore.get(snapshot.storageKey);
    const parsed = parseLogText({ fileName: snapshot.fileName, content: bytes });
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "parse",
      status: "complete",
      progress: 30,
      message: "Log parsing complete.",
      leaseOwner
    });
    currentProgress = 30;

    currentStage = "pattern";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "pattern",
      status: "processing",
      progress: 40,
      message: "Finding known operational patterns.",
      leaseOwner
    });
    currentProgress = 40;

    const analysis = await analyzer.analyze({
      parsed,
      analysisQuestion: snapshot.analysisQuestion ?? undefined
    });

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "pattern",
      status: "complete",
      progress: 55,
      message: "Pattern analysis complete.",
      leaseOwner
    });
    currentProgress = 55;

    currentStage = "rootcause";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "processing",
      progress: 65,
      message: "Linking evidence to likely root causes.",
      leaseOwner
    });
    currentProgress = 65;

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "complete",
      progress: 80,
      message: "Root cause evidence prepared.",
      leaseOwner
    });
    currentProgress = 80;

    currentStage = "report";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "report",
      status: "processing",
      progress: 90,
      message: "Writing report and evidence.",
      leaseOwner
    });
    currentProgress = 90;

    const completed = await completeLogAnalysisJobWithReport(db, {
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
      jobId: snapshot.jobId,
      leaseOwner,
      report: {
        confidence: analysis.confidence,
        conclusion: analysis.conclusion,
        impact: analysis.impact,
        severity: analysis.severity,
        suggestedActions: analysis.suggestedActions,
        rawLines: parsed.rawLines
      },
      evidence: analysis.evidence
    });
    if (!completed) return { status: "idle" };

    return { status: "processed" };
  } catch (error) {
    if (error instanceof JobLeaseLostError) {
      return { status: "idle" };
    }
    const message = readableError(error);
    const decision = decideRetry({ attemptCount: job.attemptCount, maxAttempts, baseDelayMs: retryBaseDelayMs, now: now() });
    if (decision.action === "retry") {
      const scheduled = await markJobRetryScheduled(db, {
        organizationId: snapshot.organizationId,
        jobId: snapshot.jobId,
        currentStage,
        error: message,
        nextRunAt: decision.nextRunAt,
        reason: decision.reason,
        leaseOwner
      });
      if (!scheduled) return { status: "idle" };
      return { status: "retry", reason: decision.reason };
    }

    const deadLettered = await markJobDeadLettered(db, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      currentStage,
      error: message,
      reason: decision.reason,
      leaseOwner
    });
    if (!deadLettered) return { status: "idle" };

    await updateRunStageProgress(options.db, {
      organizationId: snapshot.organizationId,
      runId: snapshot.runId,
      status: "failed",
      stageStatus: "failed",
      stage: currentStage,
      progress: currentProgress,
      message
    });
    await failRun(db, {
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
      currentStage,
      error: decision.reason
    });
    return { status: "dead-lettered", reason: decision.reason };
  }
}

export async function processNextLogAnalysisJob({
  db,
  objectStore,
  analyzer = createRuleBasedLogAnalyzer(),
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  maxAttempts = 4,
  retryBaseDelayMs = 1000,
  now = () => new Date()
}: ProcessLogWorkerOptions): Promise<"processed" | "idle"> {
  const job = await claimNextJob(db, { kind: "log-analysis", leaseOwner: workerId, leaseTtlMs });
  if (!job) return "idle";
  const result = await processClaimedLogAnalysisJob({ db, objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, now }, job);
  return result.status === "idle" ? "idle" : "processed";
}

export async function processLogAnalysisJobById({
  db,
  objectStore,
  jobId,
  analyzer = createRuleBasedLogAnalyzer(),
  workerId = "wiseeff-log-worker",
  leaseTtlMs = 60_000,
  maxAttempts = 4,
  retryBaseDelayMs = 1000,
  now = () => new Date()
}: ProcessLogWorkerByIdOptions): Promise<ProcessLogWorkerResult> {
  const job = await claimJobById(db, { kind: "log-analysis", jobId, leaseOwner: workerId, leaseTtlMs });
  if (!job) return { status: "idle" };
  return processClaimedLogAnalysisJob({ db, objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, now }, job);
}

export function startLogWorkerLoop(options: ProcessLogWorkerOptions, intervalMs = 1000): () => void {
  let stopped = false;
  let running = false;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextLogAnalysisJob(options)
      .catch(() => {
        // Intentionally swallow unexpected loop-level failures after they have been surfaced by the worker tests.
      })
      .finally(() => {
        running = false;
      });
  };

  const interval = setInterval(tick, intervalMs);
  tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}
