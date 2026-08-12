import type {
  LogAnalysisRepository,
  LogDomainCreateInput,
  LogDomainKnowledgeLinksInput,
  LogDomainListQuery,
  LogDomainUpdateInput,
  LogFeedbackInput,
  LogFeedbackInsightsQuery,
  LogJobSnapshot,
  LogListQuery,
  LogRerunInput,
  LogUploadInput
} from "@/application/ports/LogAnalysisRepository";
import type { AppAction } from "@/application/state/appState";
import type { LogDomain, LogDomainKnowledgeLink, LogFeedbackInsight, LogRecord } from "@/domain/logs/types";
import type { PrototypeState } from "@/domain/prototype/types";
import type { WiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";

export const logRuntimeFailureNotification = "日志操作未完成，请稍后重试。";
export const logDomainMockModeNotification = "业务域治理需在 API 模式下使用。";

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
  listLogDomains(query?: LogDomainListQuery): Promise<LogDomain[]>;
  createLogDomain(input: LogDomainCreateInput): Promise<LogDomain | null>;
  updateLogDomain(input: LogDomainUpdateInput): Promise<LogDomain | null>;
  archiveLogDomain(domainId: string): Promise<LogDomain | null>;
  listLogDomainKnowledgeLinks(domainId: string): Promise<LogDomainKnowledgeLink[]>;
  setLogDomainKnowledgeLinks(input: LogDomainKnowledgeLinksInput): Promise<LogDomainKnowledgeLink[] | null>;
  listFeedbackInsights(query?: LogFeedbackInsightsQuery): Promise<LogFeedbackInsight[]>;
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
  /** Fixed poll interval override (tests); absent = adaptive backoff 1s×30 → 2s×45 → 5s. */
  pollIntervalMs?: number;
  /** Attempt-count safety cap; the primary cap is maxPollDurationMs. */
  maxPollAttempts?: number;
  /** Total scheduled polling time cap, aligned to the p95 ≤ 3min SLO plus headroom. */
  maxPollDurationMs?: number;
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
  return error instanceof Error && (error as { alreadyNotified?: unknown }).alreadyNotified === true;
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

/** Adaptive backoff schedule: 1s for 30 attempts, then 2s for 45, then 5s. */
export function adaptivePollDelayMs(attempt: number) {
  if (attempt < 30) {
    return 1000;
  }
  if (attempt < 75) {
    return 2000;
  }
  return 5000;
}

type PollSchedule = {
  pollIntervalMs?: number;
  maxPollAttempts: number;
  maxPollDurationMs: number;
};

async function pollJobUntilTerminal(
  api: LogAnalysisRepository,
  initialJob: LogJobSnapshot,
  dispatch: LogRuntimeOptions["dispatch"],
  schedule: PollSchedule,
  generations: PollGenerationTracker,
  activeGeneration: ActiveLogGeneration
) {
  let job = initialJob;
  if (initialJob.logId !== activeGeneration.logId || !generations.isCurrent(activeGeneration.logId, activeGeneration.generation)) {
    return;
  }

  let scheduledMs = 0;
  for (
    let attempt = 0;
    attempt < schedule.maxPollAttempts && scheduledMs < schedule.maxPollDurationMs && !terminalJobStatuses.has(job.status);
    attempt += 1
  ) {
    const delayMs = schedule.pollIntervalMs ?? adaptivePollDelayMs(attempt);
    if (delayMs > 0) {
      await delay(delayMs);
    }
    scheduledMs += delayMs;
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
  pollIntervalMs,
  maxPollAttempts = 240,
  maxPollDurationMs = 300_000
}: LogRuntimeOptions): LogRuntimeActions {
  const pollSchedule: PollSchedule = { pollIntervalMs, maxPollAttempts, maxPollDurationMs };
  const pollGenerations = new Map<string, number>();
  let nextPollGeneration = 0;
  let nextUploadReservation = 0;
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
      if (isAlreadyNotified(error)) {
        throw error;
      }
      throw notifyFailure(dispatch);
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

      nextUploadReservation += 1;
      const activeGeneration = reserveGeneration(`upload:${nextUploadReservation}`);
      await runApiMutation(async (api) => {
        const result = await api.uploadLog(input);
        if (!generations.bind(activeGeneration, result.log.id)) {
          return;
        }
        dispatch({ type: "UPSERT_LOG_RECORD", log: result.log });
        if (result.job) {
          await pollJobUntilTerminal(api, result.job, dispatch, pollSchedule, generations, activeGeneration);
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
        await pollJobUntilTerminal(api, result.job, dispatch, pollSchedule, generations, activeGeneration);
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
    },
    async listLogDomains(query) {
      if (mode !== "api") {
        return [];
      }

      try {
        const api = requireRepository(repository);
        return (await api.listLogDomains?.(query)) ?? [];
      } catch {
        // Domain listing must never block the upload flow; the selector just falls back to 未分类.
        return [];
      }
    },
    async createLogDomain(input) {
      if (mode !== "api") {
        dispatch({ type: "ADD_NOTIFICATION", message: logDomainMockModeNotification });
        return null;
      }

      let created: LogDomain | null = null;
      await runApiMutation(async (api) => {
        created = (await api.createLogDomain?.(input)) ?? null;
      });
      return created;
    },
    async updateLogDomain(input) {
      if (mode !== "api") {
        dispatch({ type: "ADD_NOTIFICATION", message: logDomainMockModeNotification });
        return null;
      }

      let updated: LogDomain | null = null;
      await runApiMutation(async (api) => {
        updated = (await api.updateLogDomain?.(input)) ?? null;
      });
      return updated;
    },
    async archiveLogDomain(domainId) {
      if (mode !== "api") {
        dispatch({ type: "ADD_NOTIFICATION", message: logDomainMockModeNotification });
        return null;
      }

      let archived: LogDomain | null = null;
      await runApiMutation(async (api) => {
        archived = (await api.archiveLogDomain?.(domainId)) ?? null;
      });
      return archived;
    },
    async listLogDomainKnowledgeLinks(domainId) {
      if (mode !== "api") {
        return [];
      }

      try {
        const api = requireRepository(repository);
        return (await api.listLogDomainKnowledgeLinks?.(domainId)) ?? [];
      } catch {
        // Link listing is a governance read; failures degrade to an empty list.
        return [];
      }
    },
    async setLogDomainKnowledgeLinks(input) {
      if (mode !== "api") {
        dispatch({ type: "ADD_NOTIFICATION", message: logDomainMockModeNotification });
        return null;
      }

      let saved: LogDomainKnowledgeLink[] | null = null;
      await runApiMutation(async (api) => {
        saved = (await api.setLogDomainKnowledgeLinks?.(input)) ?? null;
      });
      return saved;
    },
    async listFeedbackInsights(query) {
      if (mode !== "api") {
        return [];
      }

      try {
        const api = requireRepository(repository);
        return (await api.listFeedbackInsights?.(query)) ?? [];
      } catch {
        // Monitoring reads never block the admin page; failures degrade to the empty state.
        return [];
      }
    }
  };
}
