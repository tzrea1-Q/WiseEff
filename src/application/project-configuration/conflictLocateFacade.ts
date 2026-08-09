import type {
  ParameterFileRepository,
  ParameterFileSyncConflict
} from "@/application/ports/ParameterFileRepository";

export type ConflictLocateRepository = Pick<ParameterFileRepository, "listConflicts">;

export type ConflictLocateTarget = {
  fileId: string;
  nodePath: string | null;
  propertyName: string | null;
  focusLine: number | null;
};

export type ConflictLocateFacadeSnapshot = {
  conflicts: ParameterFileSyncConflict[];
  loading: boolean;
  error: string;
  /** Pending source locate for the shell to apply after structure/navigation settle. */
  locateTarget: ConflictLocateTarget | null;
};

export type ConflictLocateFacade = ConflictLocateFacadeSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ConflictLocateFacadeSnapshot;
  load(projectId: string, repo: ConflictLocateRepository): Promise<void>;
  /** Replace the open queue (e.g. dock resolution updates). Non-open rows are dropped. */
  setOpenConflicts(conflicts: ParameterFileSyncConflict[]): void;
  /**
   * Project locate intent from a conflict. Does not navigate; the shell applies
   * selectStructureTarget / focus using the returned target (also stored as locateTarget).
   */
  locate(conflict: ParameterFileSyncConflict): ConflictLocateTarget | null;
  /**
   * Refresh open conflicts for arbitration (task dock). Optionally seeds a locate
   * target when activity/deep-link already knows the file/node/property.
   */
  openArbitration(
    projectId: string,
    repo: ConflictLocateRepository,
    seed?: {
      fileId?: string | null;
      nodePath?: string | null;
      propertyName?: string | null;
      focusLine?: number | null;
    }
  ): Promise<void>;
  clearLocateTarget(): void;
  /** Clear locateTarget once the shell has applied focus (matched selection). */
  consumeLocateTargetIfMatched(selection: {
    fileId: string | null;
    nodePath: string | null;
    propertyName: string | null;
  }): ConflictLocateTarget | null;
};

function openOnly(conflicts: ParameterFileSyncConflict[]): ParameterFileSyncConflict[] {
  return conflicts.filter((item) => item.status === "open");
}

function projectLocate(conflict: ParameterFileSyncConflict): ConflictLocateTarget | null {
  if (!conflict.fileId) return null;
  const nodePath = conflict.nodePath ?? conflict.sourceNodePath ?? null;
  const propertyName = conflict.propertyName ?? null;
  const focusLine = conflict.source?.startLine ?? null;
  return { fileId: conflict.fileId, nodePath, propertyName, focusLine };
}

function emptySnapshot(): ConflictLocateFacadeSnapshot {
  return {
    conflicts: [],
    loading: false,
    error: "",
    locateTarget: null
  };
}

export function createConflictLocateFacade(): ConflictLocateFacade {
  const listeners = new Set<() => void>();
  let conflicts: ParameterFileSyncConflict[] = [];
  let loading = false;
  let error = "";
  let locateTarget: ConflictLocateTarget | null = null;
  let loadGeneration = 0;
  let emitScheduled = false;
  let cached = emptySnapshot();

  function rebuild(): ConflictLocateFacadeSnapshot {
    return { conflicts, loading, error, locateTarget };
  }

  function emit(): void {
    cached = rebuild();
    if (emitScheduled) return;
    emitScheduled = true;
    queueMicrotask(() => {
      emitScheduled = false;
      cached = rebuild();
      for (const listener of listeners) listener();
    });
  }

  const facade: ConflictLocateFacade = {
    get conflicts() {
      return cached.conflicts;
    },
    get loading() {
      return cached.loading;
    },
    get error() {
      return cached.error;
    },
    get locateTarget() {
      return cached.locateTarget;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cached;
    },

    async load(projectId, repo) {
      const generation = ++loadGeneration;
      loading = true;
      error = "";
      emit();
      try {
        const items = await repo.listConflicts(projectId);
        if (generation !== loadGeneration) return;
        conflicts = openOnly(items);
      } catch (err: unknown) {
        if (generation !== loadGeneration) return;
        conflicts = [];
        error = err instanceof Error ? err.message : "冲突列表加载失败。";
      } finally {
        if (generation === loadGeneration) {
          loading = false;
          emit();
        }
      }
    },

    setOpenConflicts(next) {
      conflicts = openOnly(next);
      emit();
    },

    locate(conflict) {
      const target = projectLocate(conflict);
      locateTarget = target;
      emit();
      return target;
    },

    async openArbitration(projectId, repo, seed) {
      await facade.load(projectId, repo);
      if (seed?.fileId) {
        locateTarget = {
          fileId: seed.fileId,
          nodePath: seed.nodePath ?? null,
          propertyName: seed.propertyName ?? null,
          focusLine: seed.focusLine ?? null
        };
        emit();
      }
    },

    clearLocateTarget() {
      if (!locateTarget) return;
      locateTarget = null;
      emit();
    },

    consumeLocateTargetIfMatched(selection) {
      const pending = locateTarget;
      if (!pending) return null;
      const matched =
        selection.fileId === pending.fileId &&
        selection.nodePath === pending.nodePath &&
        selection.propertyName === pending.propertyName;
      if (!matched) return null;
      locateTarget = null;
      emit();
      return pending;
    }
  };

  cached = rebuild();
  return facade;
}
