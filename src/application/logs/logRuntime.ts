import type {
  LogAnalysisRepository,
  LogFeedbackInput,
  LogJobSnapshot,
  LogListQuery,
  LogRerunInput,
  LogUploadInput
} from "@/application/ports/LogAnalysisRepository";
import type { AppAction } from "@/App";
import type { LogRecord } from "@/domain/logs/types";
import type { PrototypeState } from "@/mockData";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export const logRuntimeFailureNotification = "日志操作未完成，请稍后重试。";

export type HydrateLogRuntimeAction = {
  type: "HYDRATE_LOG_RUNTIME";
  logs: LogRecord[];
};

export type LogRuntimeActions = {
  refresh(query?: LogListQuery): Promise<void>;
  upload(input: LogUploadInput): Promise<void>;
  rerun(input: LogRerunInput): Promise<void>;
  archive(logId: string): Promise<void>;
  unarchive(logId: string): Promise<void>;
  submitFeedback(input: LogFeedbackInput): Promise<void>;
};

export type LogRuntimeDispatchAction =
  | HydrateLogRuntimeAction
  | { type: "UPSERT_LOG_RECORD"; log: LogRecord }
  | { type: "LOG_JOB_PROGRESS"; job: LogJobSnapshot }
  | Extract<
      AppAction,
      | { type: "SIMULATE_LOG_UPLOAD" }
      | { type: "LOG_ADMIN_REANALYZE_LOG" }
      | { type: "LOG_ADMIN_ARCHIVE_LOG" }
      | { type: "LOG_ADMIN_UNARCHIVE_LOG" }
      | { type: "ADD_NOTIFICATION" }
    >;

type LogRuntimeOptions = {
  mode: WiseEffRuntimeMode;
  dispatch: (action: LogRuntimeDispatchAction) => void;
  getState: () => PrototypeState;
  repository?: LogAnalysisRepository;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

const terminalJobStatuses = new Set<LogJobSnapshot["status"]>(["complete", "failed"]);
const supportedMockUploadExtensions = new Set(["log", "txt", "json"]);
export type LogRuntimeNotifiedFailure = Error & { alreadyNotified: true };
type PollGenerationTracker = {
  begin(logId: string): number;
  bind(activeGeneration: ActiveLogGeneration, logId: string): boolean;
  isCurrent(logId: string, generation: number): boolean;
};
type ActiveLogGeneration = {
  logId: string;
  generation: number;
};

function requireRepository(repository?: LogAnalysisRepository): LogAnalysisRepository {
  if (!repository) {
    throw new Error("Log analysis repository is required in api runtime mode.");
  }
  return repository;
}

function notifyFailure(dispatch: LogRuntimeOptions["dispatch"]): LogRuntimeNotifiedFailure {
  dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
  return Object.assign(new Error(logRuntimeFailureNotification), { alreadyNotified: true as const });
}

function isAlreadyNotified(error: unknown): error is LogRuntimeNotifiedFailure {
  return error instanceof Error && "alreadyNotified" in error;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isSupportedMockUpload(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension ? supportedMockUploadExtensions.has(extension) : false;
}

async function pollJobUntilTerminal(
  api: LogAnalysisRepository,
  initialJob: LogJobSnapshot,
  dispatch: LogRuntimeOptions["dispatch"],
  pollIntervalMs: number,
  maxPollAttempts: number,
  generations: PollGenerationTracker,
  activeGeneration: ActiveLogGeneration
) {
  let job = initialJob;
  if (initialJob.logId !== activeGeneration.logId || !generations.isCurrent(activeGeneration.logId, activeGeneration.generation)) {
    return;
  }

  for (let attempt = 0; attempt < maxPollAttempts && !terminalJobStatuses.has(job.status); attempt += 1) {
    if (pollIntervalMs > 0) {
      await delay(pollIntervalMs);
    }
    job = await api.getJob(job.id);
    if (!generations.isCurrent(job.logId, activeGeneration.generation)) {
      return;
    }
    dispatch({ type: "LOG_JOB_PROGRESS", job });
  }

  if (terminalJobStatuses.has(job.status) && generations.isCurrent(job.logId, activeGeneration.generation)) {
    const latestLog = await api.getLog(job.logId);
    if (latestLog && generations.isCurrent(job.logId, activeGeneration.generation)) {
      dispatch({ type: "UPSERT_LOG_RECORD", log: latestLog });
    }
    return;
  }

  if (generations.isCurrent(job.logId, activeGeneration.generation)) {
    const latestLog = await api.getLog(job.logId);
    if (latestLog && generations.isCurrent(job.logId, activeGeneration.generation)) {
      dispatch({ type: "UPSERT_LOG_RECORD", log: latestLog });
    }
    if (generations.isCurrent(job.logId, activeGeneration.generation)) {
      dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
    }
  }
}

export function createLogRuntimeActions({
  mode,
  repository,
  dispatch,
  getState,
  pollIntervalMs = 1000,
  maxPollAttempts = 60
}: LogRuntimeOptions): LogRuntimeActions {
  const pollGenerations = new Map<string, number>();
  let nextPollGeneration = 0;
  const generations: PollGenerationTracker = {
    begin(logId) {
      const next = nextPollGeneration + 1;
      nextPollGeneration = next;
      pollGenerations.set(logId, next);
      return next;
    },
    bind(activeGeneration, logId) {
      if (!generations.isCurrent(activeGeneration.logId, activeGeneration.generation)) {
        return false;
      }
      const currentGeneration = pollGenerations.get(logId);
      if (currentGeneration !== undefined && currentGeneration > activeGeneration.generation) {
        return false;
      }
      if (activeGeneration.logId !== logId) {
        pollGenerations.delete(activeGeneration.logId);
      }
      activeGeneration.logId = logId;
      pollGenerations.set(logId, activeGeneration.generation);
      return true;
    },
    isCurrent(logId, generation) {
      return pollGenerations.get(logId) === generation;
    }
  };
  const reserveGeneration = (logId: string): ActiveLogGeneration => ({
    logId,
    generation: generations.begin(logId)
  });

  const refresh = async (query?: LogListQuery) => {
    if (mode !== "api") {
      return;
    }

    try {
      const logs = await requireRepository(repository).listLogs(query);
      dispatch({ type: "HYDRATE_LOG_RUNTIME", logs });
    } catch {
      throw notifyFailure(dispatch);
    }
  };

  const runApiMutation = async (mutation: (api: LogAnalysisRepository) => Promise<void>) => {
    try {
      await mutation(requireRepository(repository));
    } catch (error) {
      if (!isAlreadyNotified(error)) {
        notifyFailure(dispatch);
      }
    }
  };

  return {
    refresh,
    async upload(input) {
      if (mode !== "api") {
        dispatch({
          type: "SIMULATE_LOG_UPLOAD",
          fileName: input.file.name,
          supported: isSupportedMockUpload(input.file.name),
          question: input.analysisQuestion
        });
        return;
      }

      const activeGeneration = reserveGeneration(`upload:${input.projectId}:${input.file.name}`);
      await runApiMutation(async (api) => {
        const result = await api.uploadLog(input);
        if (!generations.bind(activeGeneration, result.log.id)) {
          return;
        }
        dispatch({ type: "UPSERT_LOG_RECORD", log: result.log });
        if (result.job) {
          await pollJobUntilTerminal(api, result.job, dispatch, pollIntervalMs, maxPollAttempts, generations, activeGeneration);
        }
      });
    },
    async rerun(input) {
      if (mode !== "api") {
        dispatch({ type: "LOG_ADMIN_REANALYZE_LOG", logId: input.logId });
        return;
      }

      const activeGeneration = reserveGeneration(input.logId);
      await runApiMutation(async (api) => {
        const result = await api.rerunLog(input);
        if (!generations.isCurrent(input.logId, activeGeneration.generation)) {
          return;
        }
        dispatch({ type: "UPSERT_LOG_RECORD", log: result.log });
        await pollJobUntilTerminal(api, result.job, dispatch, pollIntervalMs, maxPollAttempts, generations, activeGeneration);
      });
    },
    async archive(logId) {
      if (mode !== "api") {
        dispatch({ type: "LOG_ADMIN_ARCHIVE_LOG", logId });
        return;
      }

      await runApiMutation(async (api) => {
        await api.archiveLog(logId);
        await refresh();
      });
    },
    async unarchive(logId) {
      if (mode !== "api") {
        dispatch({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId });
        return;
      }

      await runApiMutation(async (api) => {
        await api.unarchiveLog(logId);
        await refresh();
      });
    },
    async submitFeedback(input) {
      if (mode !== "api") {
        const log = getState().logs.find((item) => item.id === input.logId);
        dispatch({ type: "ADD_NOTIFICATION", message: log ? `${log.fileName} 反馈已记录` : "日志反馈已记录" });
        return;
      }

      await runApiMutation(async (api) => {
        await api.submitFeedback(input);
        await refresh();
      });
    }
  };
}
