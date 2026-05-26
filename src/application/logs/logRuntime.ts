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
  maxPollAttempts: number
) {
  let job = initialJob;

  for (let attempt = 0; attempt < maxPollAttempts && !terminalJobStatuses.has(job.status); attempt += 1) {
    if (pollIntervalMs > 0) {
      await delay(pollIntervalMs);
    }
    job = await api.getJob(job.id);
    dispatch({ type: "LOG_JOB_PROGRESS", job });
  }

  if (terminalJobStatuses.has(job.status)) {
    const latestLog = await api.getLog(job.logId);
    if (latestLog) {
      dispatch({ type: "UPSERT_LOG_RECORD", log: latestLog });
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
    } catch {
      notifyFailure(dispatch);
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

      await runApiMutation(async (api) => {
        const result = await api.uploadLog(input);
        dispatch({ type: "UPSERT_LOG_RECORD", log: result.log });
        if (result.job) {
          await pollJobUntilTerminal(api, result.job, dispatch, pollIntervalMs, maxPollAttempts);
        }
      });
    },
    async rerun(input) {
      if (mode !== "api") {
        dispatch({ type: "LOG_ADMIN_REANALYZE_LOG", logId: input.logId });
        return;
      }

      await runApiMutation(async (api) => {
        const result = await api.rerunLog(input);
        dispatch({ type: "UPSERT_LOG_RECORD", log: result.log });
        await pollJobUntilTerminal(api, result.job, dispatch, pollIntervalMs, maxPollAttempts);
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
        await refresh({ includeArchived: true });
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
