import type { AuditEventListResponse, AuditEventView, ListAuditEventsParams } from "@/domain/audit/types";
import { mapApiAuditEventToView } from "@/domain/audit/mapAuditEventView";
import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";

export type WorkbenchActivitySnapshot = {
  activityEvents: AuditEventView[];
  activityLoading: boolean;
  activityError: string;
  activityMissingNotice: string;
  knownCandidateIds: string[];
  activityRefreshToken: number;
};

export type WorkbenchActivitySession = WorkbenchActivitySnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkbenchActivitySnapshot;
  setMissingNotice(message: string): void;
  bumpRefresh(): void;
  /**
   * Load Activity timeline. `apps` is injected by the shell (from workbenchActivityApps)
   * so this session stays free of presentation-layer imports.
   */
  refresh(
    projectId: string,
    apps: string[],
    listAuditEvents: (params?: ListAuditEventsParams) => Promise<AuditEventListResponse>,
    fileRepository: Pick<ParameterFileRepository, "listCandidates">
  ): Promise<void>;
};

function emptySnapshot(): WorkbenchActivitySnapshot {
  return {
    activityEvents: [],
    activityLoading: false,
    activityError: "",
    activityMissingNotice: "",
    knownCandidateIds: [],
    activityRefreshToken: 0
  };
}

export function createWorkbenchActivitySession(): WorkbenchActivitySession {
  const listeners = new Set<() => void>();
  let activityEvents: AuditEventView[] = [];
  let activityLoading = false;
  let activityError = "";
  let activityMissingNotice = "";
  let knownCandidateIds: string[] = [];
  let activityRefreshToken = 0;
  let refreshGeneration = 0;
  let snapshot = emptySnapshot();

  const emit = () => {
    snapshot = {
      activityEvents,
      activityLoading,
      activityError,
      activityMissingNotice,
      knownCandidateIds,
      activityRefreshToken
    };
    for (const listener of listeners) listener();
  };

  const scheduleEmit = () => {
    queueMicrotask(emit);
  };

  const api: WorkbenchActivitySession = {
    get activityEvents() {
      return activityEvents;
    },
    get activityLoading() {
      return activityLoading;
    },
    get activityError() {
      return activityError;
    },
    get activityMissingNotice() {
      return activityMissingNotice;
    },
    get knownCandidateIds() {
      return knownCandidateIds;
    },
    get activityRefreshToken() {
      return activityRefreshToken;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    setMissingNotice(message) {
      activityMissingNotice = message;
      scheduleEmit();
    },
    bumpRefresh() {
      activityRefreshToken += 1;
      scheduleEmit();
    },
    async refresh(projectId, apps, listAuditEvents, fileRepository) {
      const generation = ++refreshGeneration;
      activityLoading = true;
      activityError = "";
      scheduleEmit();
      try {
        const [response, candidates] = await Promise.all([
          listAuditEvents({
            projectId,
            apps,
            limit: 40
          }),
          fileRepository.listCandidates(projectId, { includeAbandoned: false }).catch(() => [])
        ]);
        if (generation !== refreshGeneration) return;
        activityEvents = response.items.map(mapApiAuditEventToView);
        knownCandidateIds = candidates.map((item) => item.id);
      } catch (error: unknown) {
        if (generation !== refreshGeneration) return;
        activityError = error instanceof Error ? error.message : "加载项目活动失败";
        activityEvents = [];
      } finally {
        if (generation === refreshGeneration) {
          activityLoading = false;
          scheduleEmit();
        }
      }
    }
  };

  emit();
  return api;
}
