import { claimNextJob, completeJob, failJob, updateJobProgress } from "../jobs/repository";
import type { Database } from "../../shared/database/client";
import { createRuleBasedLogAnalyzer, type LogAnalysisAdapter } from "./analyzer";
import type { ObjectStore } from "./objectStore";
import { parseLogText } from "./parser";
import {
  completeRun,
  failRun,
  getLogWorkerRunSnapshot,
  persistLogAnalysisReport,
  updateRunStageProgress
} from "./repository";
import type { LogStage } from "./status";

export type ProcessLogWorkerOptions = {
  db: Database;
  objectStore: ObjectStore;
  analyzer?: LogAnalysisAdapter;
};

type StageStatus = "processing" | "complete" | "failed";

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
  }
) {
  await updateRunStageProgress(options.db, {
    organizationId: input.organizationId,
    runId: input.runId,
    status: input.status === "failed" ? "failed" : "processing",
    stageStatus: input.status === "failed" ? "failed" : input.status,
    stage: input.stage,
    progress: input.progress,
    message: input.message
  });
  await updateJobProgress(options.db, {
    organizationId: input.organizationId,
    jobId: input.jobId,
    progress: input.progress,
    currentStage: input.stage
  });
}

function readableError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function processNextLogAnalysisJob({
  db,
  objectStore,
  analyzer = createRuleBasedLogAnalyzer()
}: ProcessLogWorkerOptions): Promise<"processed" | "idle"> {
  const job = await claimNextJob(db, { kind: "log-analysis" });
  if (!job) return "idle";

  const options = { db, objectStore, analyzer };
  const snapshot = await getLogWorkerRunSnapshot(db, job.id);

  if (!snapshot) {
    await failJob(db, {
      organizationId: job.organizationId,
      jobId: job.id,
      currentStage: "parse",
      error: "Unable to load log analysis job target."
    });
    return "processed";
  }

  let currentStage: LogStage = "parse";

  try {
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "parse",
      status: "processing",
      progress: 10,
      message: "Reading and parsing the uploaded log."
    });

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
      message: "Log parsing complete."
    });

    currentStage = "pattern";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "pattern",
      status: "processing",
      progress: 40,
      message: "Finding known operational patterns."
    });

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
      message: "Pattern analysis complete."
    });

    currentStage = "rootcause";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "processing",
      progress: 65,
      message: "Linking evidence to likely root causes."
    });

    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "rootcause",
      status: "complete",
      progress: 80,
      message: "Root cause evidence prepared."
    });

    currentStage = "report";
    await markProgress(options, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      runId: snapshot.runId,
      stage: "report",
      status: "processing",
      progress: 90,
      message: "Writing report and evidence."
    });

    await persistLogAnalysisReport(db, {
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
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

    await completeRun(db, {
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
      currentStage: "report"
    });
    await completeJob(db, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      currentStage: "report"
    });

    return "processed";
  } catch (error) {
    const message = readableError(error);
    await failRun(db, {
      organizationId: snapshot.organizationId,
      logId: snapshot.logId,
      runId: snapshot.runId,
      currentStage,
      error: message
    });
    await failJob(db, {
      organizationId: snapshot.organizationId,
      jobId: snapshot.jobId,
      currentStage,
      error: message
    });
    return "processed";
  }
}

export function startLogWorkerLoop(options: ProcessLogWorkerOptions, intervalMs = 1000): () => void {
  let stopped = false;
  let running = false;

  const tick = () => {
    if (stopped || running) return;
    running = true;
    void processNextLogAnalysisJob(options).finally(() => {
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
