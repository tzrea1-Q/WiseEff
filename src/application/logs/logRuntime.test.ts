import { describe, expect, it, vi } from "vitest";

import type { LogAnalysisRepository, LogJobSnapshot } from "@/application/ports/LogAnalysisRepository";
import type { LogRecord } from "@/domain/logs/types";
import { initialState } from "@/mockData";
import { createLogRuntimeActions, logRuntimeFailureNotification } from "./logRuntime";

const apiLog: LogRecord = {
  ...initialState.logs[0],
  id: "api-log-1",
  projectId: "api-project",
  fileName: "api-upload.log",
  status: "Processing",
  stage: "parse",
  updatedAtIso: "2026-05-25T08:00:00.000Z"
};

const completedApiLog: LogRecord = {
  ...apiLog,
  status: "Complete",
  stage: "report",
  confidence: 97,
  conclusion: "Analysis completed"
};

const queuedJob: LogJobSnapshot = {
  id: "job-1",
  kind: "log-analysis",
  logId: apiLog.id,
  runId: "run-1",
  status: "queued",
  progress: 0,
  currentStage: "parse",
  error: null,
  updatedAt: "2026-05-25T08:00:00.000Z"
};

const processingJob: LogJobSnapshot = {
  ...queuedJob,
  status: "processing",
  progress: 55,
  currentStage: "pattern",
  updatedAt: "2026-05-25T08:01:00.000Z"
};

const completeJob: LogJobSnapshot = {
  ...queuedJob,
  status: "complete",
  progress: 100,
  currentStage: "report",
  updatedAt: "2026-05-25T08:02:00.000Z"
};

function createRepository(overrides: Partial<LogAnalysisRepository> = {}): LogAnalysisRepository {
  return {
    listLogs: vi.fn().mockResolvedValue([apiLog]),
    getLog: vi.fn().mockResolvedValue(completedApiLog),
    uploadLog: vi.fn().mockResolvedValue({ log: apiLog, job: queuedJob }),
    getJob: vi.fn().mockResolvedValue(completeJob),
    rerunLog: vi.fn().mockResolvedValue({ log: apiLog, job: queuedJob }),
    archiveLog: vi.fn().mockResolvedValue(undefined),
    unarchiveLog: vi.fn().mockResolvedValue(undefined),
    submitFeedback: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function createFile(name = "api-upload.log") {
  return new File(["hello"], name, { type: "text/plain" });
}

describe("createLogRuntimeActions", () => {
  it("dispatches the existing upload simulation in mock mode", async () => {
    const dispatch = vi.fn();
    const actions = createLogRuntimeActions({ mode: "mock", dispatch, getState: () => initialState });
    const file = createFile("motor.log");

    await actions.upload({ projectId: initialState.activeProjectId, file, analysisQuestion: "Why did it fail?" });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "SIMULATE_LOG_UPLOAD",
      fileName: "motor.log",
      supported: true,
      question: "Why did it fail?"
    });
  });

  it("refreshes api logs through the repository and hydrates runtime state", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => initialState });
    const query = { projectId: "api-project", includeArchived: true };

    await actions.refresh(query);

    expect(repository.listLogs).toHaveBeenCalledWith(query);
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_LOG_RUNTIME", logs: [apiLog] });
  });

  it("uploads api logs, upserts the returned log, and polls the job until terminal", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      getJob: vi.fn().mockResolvedValueOnce(processingJob).mockResolvedValueOnce(completeJob)
    });
    const actions = createLogRuntimeActions({
      mode: "api",
      repository,
      dispatch,
      getState: () => initialState,
      pollIntervalMs: 0
    });
    const input = { projectId: "api-project", file: createFile(), analysisQuestion: "Find root cause" };

    await actions.upload(input);

    expect(repository.uploadLog).toHaveBeenCalledWith(input);
    expect(repository.getJob).toHaveBeenCalledTimes(2);
    expect(repository.getLog).toHaveBeenCalledWith(apiLog.id);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "UPSERT_LOG_RECORD", log: apiLog });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "LOG_JOB_PROGRESS", job: processingJob });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "LOG_JOB_PROGRESS", job: completeJob });
    expect(dispatch).toHaveBeenNthCalledWith(4, { type: "UPSERT_LOG_RECORD", log: completedApiLog });
  });

  it("reruns api log analysis and polls the returned job", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      getJob: vi.fn().mockResolvedValueOnce(completeJob)
    });
    const actions = createLogRuntimeActions({
      mode: "api",
      repository,
      dispatch,
      getState: () => initialState,
      pollIntervalMs: 0
    });
    const input = { logId: apiLog.id, analysisQuestion: "Try again" };

    await actions.rerun(input);

    expect(repository.rerunLog).toHaveBeenCalledWith(input);
    expect(repository.getJob).toHaveBeenCalledWith(queuedJob.id);
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "UPSERT_LOG_RECORD", log: apiLog });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "LOG_JOB_PROGRESS", job: completeJob });
    expect(dispatch).toHaveBeenNthCalledWith(3, { type: "UPSERT_LOG_RECORD", log: completedApiLog });
  });

  it("refreshes after archive, unarchive, and feedback mutations", async () => {
    const dispatch = vi.fn();
    const repository = createRepository();
    const actions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => initialState });

    await actions.archive(apiLog.id);
    await actions.unarchive(apiLog.id);
    await actions.submitFeedback({ logId: apiLog.id, rating: "helpful", note: "Useful" });

    expect(repository.archiveLog).toHaveBeenCalledWith(apiLog.id);
    expect(repository.unarchiveLog).toHaveBeenCalledWith(apiLog.id);
    expect(repository.submitFeedback).toHaveBeenCalledWith({ logId: apiLog.id, rating: "helpful", note: "Useful" });
    expect(repository.listLogs).toHaveBeenCalledTimes(3);
    expect(dispatch).toHaveBeenCalledWith({ type: "HYDRATE_LOG_RUNTIME", logs: [apiLog] });
  });

  it("notifies without optimistic log mutation when an api repository call fails", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      uploadLog: vi.fn().mockRejectedValue(new Error("upload unavailable"))
    });
    const actions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => initialState });

    await actions.upload({ projectId: "api-project", file: createFile() });

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "UPSERT_LOG_RECORD" }));
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "HYDRATE_LOG_RUNTIME" }));
  });

  it("does not duplicate notifications when a mutation succeeds but refresh fails", async () => {
    const dispatch = vi.fn();
    const repository = createRepository({
      listLogs: vi.fn().mockRejectedValue(new Error("refresh unavailable"))
    });
    const actions = createLogRuntimeActions({ mode: "api", repository, dispatch, getState: () => initialState });

    await actions.archive(apiLog.id);

    expect(repository.archiveLog).toHaveBeenCalledWith(apiLog.id);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
  });

  it("ignores stale terminal upserts when a newer poll supersedes the same log", async () => {
    const dispatch = vi.fn();
    const firstLog = { ...apiLog, reportId: "RPT-FIRST" };
    const secondLog = { ...apiLog, reportId: "RPT-SECOND", confidence: 36 };
    const staleTerminalLog = { ...completedApiLog, reportId: "RPT-STALE", conclusion: "Older result" };
    const latestTerminalLog = { ...completedApiLog, reportId: "RPT-LATEST", conclusion: "Newer result" };
    const firstJob: LogJobSnapshot = { ...queuedJob, id: "job-first", runId: "run-first" };
    const secondJob: LogJobSnapshot = { ...queuedJob, id: "job-second", runId: "run-second" };
    const firstCompleteJob: LogJobSnapshot = { ...completeJob, id: firstJob.id, runId: firstJob.runId };
    const secondCompleteJob: LogJobSnapshot = { ...completeJob, id: secondJob.id, runId: secondJob.runId };
    let resolveFirstJob: (job: LogJobSnapshot) => void = () => undefined;
    let resolveSecondJob: (job: LogJobSnapshot) => void = () => undefined;
    const firstJobPromise = new Promise<LogJobSnapshot>((resolve) => {
      resolveFirstJob = resolve;
    });
    const secondJobPromise = new Promise<LogJobSnapshot>((resolve) => {
      resolveSecondJob = resolve;
    });
    const repository = createRepository({
      uploadLog: vi
        .fn()
        .mockResolvedValueOnce({ log: firstLog, job: firstJob })
        .mockResolvedValueOnce({ log: secondLog, job: secondJob }),
      getJob: vi.fn((jobId: string) => {
        if (jobId === firstJob.id) return firstJobPromise;
        if (jobId === secondJob.id) return secondJobPromise;
        throw new Error(`Unexpected job ${jobId}`);
      }),
      getLog: vi.fn((logId: string) => {
        expect(logId).toBe(apiLog.id);
        const progressActions = dispatch.mock.calls
          .map(([action]) => action)
          .filter((action) => action.type === "LOG_JOB_PROGRESS");
        return Promise.resolve(progressActions.at(-1)?.job.id === firstJob.id ? staleTerminalLog : latestTerminalLog);
      })
    });
    const actions = createLogRuntimeActions({
      mode: "api",
      repository,
      dispatch,
      getState: () => initialState,
      pollIntervalMs: 0
    });

    const firstUpload = actions.upload({ projectId: "api-project", file: createFile("first.log") });
    await Promise.resolve();
    const secondUpload = actions.upload({ projectId: "api-project", file: createFile("second.log") });
    await Promise.resolve();

    resolveSecondJob(secondCompleteJob);
    await secondUpload;
    resolveFirstJob(firstCompleteJob);
    await firstUpload;

    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_LOG_RECORD", log: latestTerminalLog });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "UPSERT_LOG_RECORD", log: staleTerminalLog });
  });

  it("ignores older rerun responses that resolve after a newer rerun starts for the same log", async () => {
    const dispatch = vi.fn();
    const staleLog = { ...apiLog, reportId: "RPT-OLDER", conclusion: "Older rerun accepted" };
    const latestLog = { ...apiLog, reportId: "RPT-NEWER", conclusion: "Newer rerun accepted" };
    const olderJob: LogJobSnapshot = { ...queuedJob, id: "job-older", runId: "run-older" };
    const newerJob: LogJobSnapshot = { ...queuedJob, id: "job-newer", runId: "run-newer" };
    let resolveOlderRerun: (result: { log: LogRecord; job: LogJobSnapshot }) => void = () => undefined;
    const olderRerunPromise = new Promise<{ log: LogRecord; job: LogJobSnapshot }>((resolve) => {
      resolveOlderRerun = resolve;
    });
    const repository = createRepository({
      rerunLog: vi
        .fn()
        .mockReturnValueOnce(olderRerunPromise)
        .mockResolvedValueOnce({ log: latestLog, job: newerJob }),
      getJob: vi.fn().mockResolvedValue({ ...completeJob, id: newerJob.id, runId: newerJob.runId }),
      getLog: vi.fn().mockResolvedValue({ ...completedApiLog, reportId: "RPT-NEWER-DONE" })
    });
    const actions = createLogRuntimeActions({
      mode: "api",
      repository,
      dispatch,
      getState: () => initialState,
      pollIntervalMs: 0
    });

    const olderRerun = actions.rerun({ logId: apiLog.id, analysisQuestion: "older" });
    await Promise.resolve();
    const newerRerun = actions.rerun({ logId: apiLog.id, analysisQuestion: "newer" });
    await newerRerun;
    resolveOlderRerun({ log: staleLog, job: olderJob });
    await olderRerun;

    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_LOG_RECORD", log: latestLog });
    expect(dispatch).not.toHaveBeenCalledWith({ type: "UPSERT_LOG_RECORD", log: staleLog });
    expect(repository.getJob).not.toHaveBeenCalledWith(olderJob.id);
  });

  it("notifies and fetches the latest log when polling exhausts max attempts before terminal", async () => {
    const dispatch = vi.fn();
    const stillProcessingJob: LogJobSnapshot = {
      ...processingJob,
      id: queuedJob.id,
      status: "processing",
      currentStage: "pattern"
    };
    const latestProcessingLog = { ...apiLog, stage: "pattern", conclusion: "Still processing" };
    const repository = createRepository({
      getJob: vi.fn().mockResolvedValue(stillProcessingJob),
      getLog: vi.fn().mockResolvedValue(latestProcessingLog)
    });
    const actions = createLogRuntimeActions({
      mode: "api",
      repository,
      dispatch,
      getState: () => initialState,
      pollIntervalMs: 0,
      maxPollAttempts: 1
    });

    await actions.upload({ projectId: "api-project", file: createFile("timeout.log") });

    expect(repository.getJob).toHaveBeenCalledTimes(1);
    expect(repository.getLog).toHaveBeenCalledWith(apiLog.id);
    expect(dispatch).toHaveBeenCalledWith({ type: "LOG_JOB_PROGRESS", job: stillProcessingJob });
    expect(dispatch).toHaveBeenCalledWith({ type: "UPSERT_LOG_RECORD", log: latestProcessingLog });
    expect(dispatch).toHaveBeenCalledWith({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
  });
});
