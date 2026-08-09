import type { ParameterFileRepository } from "@/application/ports/ParameterFileRepository";

export type CanvasHistoryRepository = Pick<ParameterFileRepository, "downloadVersion">;

export type WorkbenchCanvasModeName =
  | "working"
  | "history"
  | "unified-diff"
  | "side-by-side"
  | "candidate";

export type WorkingCanvasSnapshot = {
  fileId: string | null;
  nodePath: string | null;
  propertyName: string | null;
  scrollLine: number | null;
  sourceMode: string | null;
};

export type WorkbenchCanvasHistorySnapshot = {
  historySource: string;
  compareSource: string;
  modeSourceLoading: boolean;
  modeSourceError: string;
  workingSnapshot: WorkingCanvasSnapshot | null;
};

export type WorkbenchCanvasHistorySession = WorkbenchCanvasHistorySnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WorkbenchCanvasHistorySnapshot;
  rememberWorkingSnapshot(snapshot: WorkingCanvasSnapshot): void;
  clearModeSource(): void;
  /**
   * Load history/compare bytes for non-working canvas modes.
   * Candidate mode is owned by CandidateVersionFlow — this clears history state only.
   */
  loadModeSource(input: {
    canvasMode: WorkbenchCanvasModeName;
    projectId: string;
    fileId: string | null;
    versionId: string | null;
    /** Working tip version for compare modes; falls back to `workingSource` text. */
    currentVersionId?: string | null;
    workingSource: string;
    repo: CanvasHistoryRepository;
  }): Promise<void>;
};

function emptySnapshot(): WorkbenchCanvasHistorySnapshot {
  return {
    historySource: "",
    compareSource: "",
    modeSourceLoading: false,
    modeSourceError: "",
    workingSnapshot: null
  };
}

export function createWorkbenchCanvasHistorySession(): WorkbenchCanvasHistorySession {
  const listeners = new Set<() => void>();
  let historySource = "";
  let compareSource = "";
  let modeSourceLoading = false;
  let modeSourceError = "";
  let workingSnapshot: WorkingCanvasSnapshot | null = null;
  let loadGeneration = 0;
  let snapshot = emptySnapshot();

  const emit = () => {
    snapshot = {
      historySource,
      compareSource,
      modeSourceLoading,
      modeSourceError,
      workingSnapshot
    };
    for (const listener of listeners) listener();
  };

  const scheduleEmit = () => {
    queueMicrotask(emit);
  };

  const api: WorkbenchCanvasHistorySession = {
    get historySource() {
      return historySource;
    },
    get compareSource() {
      return compareSource;
    },
    get modeSourceLoading() {
      return modeSourceLoading;
    },
    get modeSourceError() {
      return modeSourceError;
    },
    get workingSnapshot() {
      return workingSnapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    rememberWorkingSnapshot(next) {
      workingSnapshot = next;
      scheduleEmit();
    },
    clearModeSource() {
      historySource = "";
      compareSource = "";
      modeSourceError = "";
      modeSourceLoading = false;
      scheduleEmit();
    },
    async loadModeSource({
      canvasMode,
      projectId,
      fileId,
      versionId,
      currentVersionId,
      workingSource,
      repo
    }) {
      if (canvasMode === "working" || canvasMode === "candidate") {
        loadGeneration += 1;
        historySource = "";
        compareSource = "";
        modeSourceError = "";
        modeSourceLoading = false;
        scheduleEmit();
        return;
      }
      if (!fileId || !versionId) {
        loadGeneration += 1;
        historySource = "";
        compareSource = "";
        modeSourceError = "";
        modeSourceLoading = false;
        scheduleEmit();
        return;
      }
      const generation = ++loadGeneration;
      modeSourceLoading = true;
      modeSourceError = "";
      scheduleEmit();
      try {
        const result = await repo.downloadVersion(projectId, fileId, versionId);
        if (generation !== loadGeneration) return;
        const text = new TextDecoder().decode(result.bytes);
        historySource = text;
        if (canvasMode === "unified-diff" || canvasMode === "side-by-side") {
          if (currentVersionId) {
            const working = await repo.downloadVersion(projectId, fileId, currentVersionId);
            if (generation !== loadGeneration) return;
            compareSource = new TextDecoder().decode(working.bytes);
          } else {
            compareSource = workingSource;
          }
        } else {
          compareSource = "";
        }
      } catch (error: unknown) {
        if (generation !== loadGeneration) return;
        historySource = "";
        compareSource = "";
        modeSourceError = error instanceof Error ? error.message : "历史源码加载失败。";
      } finally {
        if (generation === loadGeneration) {
          modeSourceLoading = false;
          scheduleEmit();
        }
      }
    }
  };

  emit();
  return api;
}
