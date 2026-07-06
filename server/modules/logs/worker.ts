import { claimJobById, claimNextJob, failJob, getJobSnapshot, markJobDeadLettered, markJobRetryScheduled, updateJobProgress } from "../jobs/repository";
import type { ClaimedLogAnalysisJobDto } from "../jobs/types";
import type { Database } from "../../shared/database/client";
import { decideRetry } from "../jobs/retryPolicy";
import type { LogAnalysisJobFailureReason, MetricsRegistry } from "../../observability/metrics";
import type { TracingBoundary } from "../../observability/tracing";
import { createRuleBasedLogAnalyzer, type LogAnalysisAdapter } from "./analyzer";
import type { ObjectStore } from "./objectStore";
import { parseLogText } from "./parser";
import {
  completeLogAnalysisJobWithReport,
  failRun,
  getLogWorkerRunSnapshot as getActiveLogWorkerRunSnapshot,
  updateRunStageProgress
} from "./repository";
import { notifyLogAnalysisCompleted, notifyLogAnalysisFailed } from "../notifications/producers";
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
  metrics?: Pick<MetricsRegistry, "recordLogAnalysisJobResult">;
  tracing?: Pick<TracingBoundary, "withSpan">;
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

async function traceLogAnalysisJob(
  tracing: Pick<TracingBoundary, "withSpan"> | undefined,
  trigger: "polling" | "queue",
  fn: () => Promise<ProcessLogWorkerResult>
): Promise<ProcessLogWorkerResult> {
  const attributes: Record<string, string | number | boolean> = { trigger };
  const execute = async () => {
    try {
      const result = await fn();
      attributes.status = result.status;
      return result;
    } catch (error) {
      attributes.status = "failed";
      attributes.errorType = error instanceof Error ? error.name : "unknown";
      throw error;
    }
  };

  return tracing ? tracing.withSpan("log_analysis.job", attributes, execute) : execute();
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
    now,
    metrics
  }: Required<Pick<ProcessLogWorkerOptions, "analyzer" | "workerId" | "maxAttempts" | "retryBaseDelayMs" | "now">> &
    Pick<ProcessLogWorkerOptions, "db" | "objectStore" | "metrics">,
  job: ClaimedLogAnalysisJobDto
): Promise<ProcessLogWorkerResult> {
  const leaseOwner = job.leaseOwner ?? workerId;
  const startedAtMs = now().getTime();

  const options = { db, objectStore, analyzer };
  const jobSnapshot = await getJobSnapshot(db, job.id);
  const snapshot = await getActiveLogWorkerRunSnapshot(db, job.id);
  const recordMetric = (input: {
    status: "complete" | "retry" | "dead_lettered" | "failed";
    stage: LogStage;
    failureReason?: LogAnalysisJobFailureReason;
    endedAt?: Date;
  }) => {
    metrics?.recordLogAnalysisJobResult({
      status: input.status,
      stage: input.stage,
      durationMs: Math.max(0, (input.endedAt ?? now()).getTime() - startedAtMs),
      ...(input.failureReason ? { failureReason: input.failureReason } : {})
    });
  };

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
    recordMetric({ status: "failed", stage: jobSnapshot?.currentStage ?? "parse", failureReason: "stale_run" });
    return { status: "processed" };
  }

  let currentStage: LogStage = "parse";
  let currentProgress = 0;
  let currentFailureReason: LogAnalysisJobFailureReason = "unknown";

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

    currentFailureReason = "object_store_error";
    const bytes = await objectStore.get(snapshot.storageKey);
    currentFailureReason = "parse_error";
    const parsed = parseLogText({ fileName: snapshot.fileName, content: bytes });
    if (!parsed.ok) {
      throw new Error(parsed.reason);
    }
    currentFailureReason = "unknown";

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

    if (snapshot.submittedByUserId) {
      await notifyLogAnalysisCompleted(db, {
        organizationId: snapshot.organizationId,
        projectId: snapshot.projectId,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        recipientUserId: snapshot.submittedByUserId,
        conclusion: analysis.conclusion
      });
    }

    recordMetric({ status: "complete", stage: "report" });
    return { status: "processed" };
  } catch (error) {
    if (error instanceof JobLeaseLostError) {
      return { status: "idle" };
    }
    const message = readableError(error);
    const endedAt = now();
    const decision = decideRetry({ attemptCount: job.attemptCount, maxAttempts, baseDelayMs: retryBaseDelayMs, now: endedAt });
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
      recordMetric({ status: "retry", stage: currentStage, failureReason: currentFailureReason, endedAt });
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
    if (snapshot.submittedByUserId) {
      await notifyLogAnalysisFailed(db, {
        organizationId: snapshot.organizationId,
        projectId: snapshot.projectId,
        logId: snapshot.logId,
        runId: snapshot.runId,
        fileName: snapshot.fileName,
        recipientUserId: snapshot.submittedByUserId,
        failureReason: decision.reason
      });
    }
    recordMetric({ status: "dead_lettered", stage: currentStage, failureReason: currentFailureReason, endedAt });
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
  now = () => new Date(),
  metrics,
  tracing
}: ProcessLogWorkerOptions): Promise<"processed" | "idle"> {
  const job = await claimNextJob(db, { kind: "log-analysis", leaseOwner: workerId, leaseTtlMs });
  if (!job) return "idle";
  const process = async () => processClaimedLogAnalysisJob({ db, objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, now, metrics }, job);
  const result = await traceLogAnalysisJob(tracing, "polling", process);
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
  now = () => new Date(),
  metrics,
  tracing
}: ProcessLogWorkerByIdOptions): Promise<ProcessLogWorkerResult> {
  const job = await claimJobById(db, { kind: "log-analysis", jobId, leaseOwner: workerId, leaseTtlMs });
  if (!job) return { status: "idle" };
  const process = async () => processClaimedLogAnalysisJob({ db, objectStore, analyzer, workerId, maxAttempts, retryBaseDelayMs, now, metrics }, job);
  return traceLogAnalysisJob(tracing, "queue", process);
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
