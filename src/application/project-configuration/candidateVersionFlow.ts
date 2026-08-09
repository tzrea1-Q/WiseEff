import type {
  ActivateParameterFileCandidateResult,
  ParameterFileCandidate,
  ParameterFileRepository
} from "@/application/ports/ParameterFileRepository";

export type CandidateFileRepository = Pick<
  ParameterFileRepository,
  | "createCandidate"
  | "getCandidate"
  | "downloadCandidate"
  | "recomputeCandidate"
  | "abandonCandidate"
  | "activateCandidate"
>;

export type CandidateActivateRole = NonNullable<
  Parameters<ParameterFileRepository["activateCandidate"]>[2]["role"]
>;

export type CandidateVersionFlowSnapshot = {
  candidate: ParameterFileCandidate | null;
  sourceText: string;
  loading: boolean;
  uploading: boolean;
  activating: boolean;
  recomputing: boolean;
  abandoning: boolean;
  error: string;
  activateError: string;
  activateRole: CandidateActivateRole;
  canActivate: boolean;
  canRecompute: boolean;
  canAbandon: boolean;
};

export type CandidateVersionFlow = CandidateVersionFlowSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CandidateVersionFlowSnapshot;
  load(
    projectId: string,
    candidateId: string | null,
    repo: Pick<ParameterFileRepository, "getCandidate" | "downloadCandidate">
  ): Promise<void>;
  clear(): void;
  /** Leave candidate canvas without wiping candidate metadata (inspector may still show it). */
  leaveCanvas(): void;
  create(
    projectId: string,
    input: { file: File; fileId?: string },
    repo: Pick<ParameterFileRepository, "createCandidate">
  ): Promise<ParameterFileCandidate>;
  recompute(
    projectId: string,
    repo: Pick<ParameterFileRepository, "recomputeCandidate">
  ): Promise<ParameterFileCandidate>;
  abandon(
    projectId: string,
    repo: Pick<ParameterFileRepository, "abandonCandidate">
  ): Promise<ParameterFileCandidate>;
  setActivateRole(role: CandidateActivateRole): void;
  activate(
    projectId: string,
    input: { configSetId?: string },
    repo: Pick<ParameterFileRepository, "activateCandidate" | "getCandidate">
  ): Promise<ActivateParameterFileCandidateResult>;
};

function decodeSourceBytes(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function fileToContentBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read candidate file."));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const marker = "base64,";
      const index = result.indexOf(marker);
      resolve(index >= 0 ? result.slice(index + marker.length) : result);
    };
    reader.readAsDataURL(file);
  });
}

function deriveGates(candidate: ParameterFileCandidate | null) {
  const status = candidate?.status;
  return {
    canActivate: status === "ready",
    canRecompute: status === "blocked" || status === "stale",
    canAbandon: status === "ready" || status === "blocked" || status === "failed" || status === "stale"
  };
}

function emptySnapshot(): CandidateVersionFlowSnapshot {
  return {
    candidate: null,
    sourceText: "",
    loading: false,
    uploading: false,
    activating: false,
    recomputing: false,
    abandoning: false,
    error: "",
    activateError: "",
    activateRole: "overlay",
    canActivate: false,
    canRecompute: false,
    canAbandon: false
  };
}

export function createCandidateVersionFlow(): CandidateVersionFlow {
  const listeners = new Set<() => void>();
  let loadGeneration = 0;
  let candidate: ParameterFileCandidate | null = null;
  let sourceText = "";
  let loading = false;
  let uploading = false;
  let activating = false;
  let recomputing = false;
  let abandoning = false;
  let error = "";
  let activateError = "";
  let activateRole: CandidateActivateRole = "overlay";
  let cachedSnapshot = emptySnapshot();

  function rebuild(): CandidateVersionFlowSnapshot {
    return {
      candidate,
      sourceText,
      loading,
      uploading,
      activating,
      recomputing,
      abandoning,
      error,
      activateError,
      activateRole,
      ...deriveGates(candidate)
    };
  }

  function emit(): void {
    cachedSnapshot = rebuild();
    for (const listener of listeners) listener();
  }

  const flow: CandidateVersionFlow = {
    get candidate() {
      return cachedSnapshot.candidate;
    },
    get sourceText() {
      return cachedSnapshot.sourceText;
    },
    get loading() {
      return cachedSnapshot.loading;
    },
    get uploading() {
      return cachedSnapshot.uploading;
    },
    get activating() {
      return cachedSnapshot.activating;
    },
    get recomputing() {
      return cachedSnapshot.recomputing;
    },
    get abandoning() {
      return cachedSnapshot.abandoning;
    },
    get error() {
      return cachedSnapshot.error;
    },
    get activateError() {
      return cachedSnapshot.activateError;
    },
    get activateRole() {
      return cachedSnapshot.activateRole;
    },
    get canActivate() {
      return cachedSnapshot.canActivate;
    },
    get canRecompute() {
      return cachedSnapshot.canRecompute;
    },
    get canAbandon() {
      return cachedSnapshot.canAbandon;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot() {
      return cachedSnapshot;
    },

    async load(projectId, candidateId, repo) {
      const generation = ++loadGeneration;
      if (!candidateId) {
        if (generation === loadGeneration) {
          sourceText = "";
          loading = false;
          emit();
        }
        return;
      }
      loading = true;
      error = "";
      emit();
      try {
        const [item, downloaded] = await Promise.all([
          repo.getCandidate(projectId, candidateId),
          repo.downloadCandidate(projectId, candidateId)
        ]);
        if (generation !== loadGeneration) return;
        candidate = item;
        sourceText = decodeSourceBytes(downloaded.bytes);
      } catch (err: unknown) {
        if (generation !== loadGeneration) return;
        candidate = null;
        sourceText = "";
        error = err instanceof Error ? err.message : "候选加载失败。";
      } finally {
        if (generation === loadGeneration) {
          loading = false;
          emit();
        }
      }
    },

    clear() {
      loadGeneration += 1;
      candidate = null;
      sourceText = "";
      loading = false;
      uploading = false;
      activating = false;
      recomputing = false;
      abandoning = false;
      error = "";
      activateError = "";
      activateRole = "overlay";
      emit();
    },

    leaveCanvas() {
      if (!sourceText && !loading) return;
      loadGeneration += 1;
      sourceText = "";
      loading = false;
      emit();
    },

    async create(projectId, input, repo) {
      uploading = true;
      error = "";
      emit();
      try {
        const contentBase64 = await fileToContentBase64(input.file);
        const created = await repo.createCandidate(projectId, {
          fileName: input.file.name,
          contentBase64,
          ...(input.fileId ? { fileId: input.fileId } : {})
        });
        candidate = created;
        emit();
        return created;
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : "候选上传失败。";
        emit();
        throw err instanceof Error ? err : new Error(error);
      } finally {
        uploading = false;
        emit();
      }
    },

    async recompute(projectId, repo) {
      if (!candidate) throw new Error("没有可重算的候选。");
      recomputing = true;
      error = "";
      emit();
      try {
        const updated = await repo.recomputeCandidate(projectId, candidate.id);
        candidate = updated;
        emit();
        return updated;
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : "候选重算失败。";
        emit();
        throw err instanceof Error ? err : new Error(error);
      } finally {
        recomputing = false;
        emit();
      }
    },

    async abandon(projectId, repo) {
      if (!candidate) throw new Error("没有可放弃的候选。");
      abandoning = true;
      error = "";
      emit();
      try {
        const abandoned = await repo.abandonCandidate(projectId, candidate.id);
        candidate = abandoned;
        emit();
        return abandoned;
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : "放弃候选失败。";
        emit();
        throw err instanceof Error ? err : new Error(error);
      } finally {
        abandoning = false;
        emit();
      }
    },

    setActivateRole(role) {
      activateRole = role;
      emit();
    },

    async activate(projectId, input, repo) {
      if (!candidate || candidate.status !== "ready") {
        throw new Error("只有 ready 状态的候选可以激活。");
      }
      if (!candidate.fileId && !input.configSetId) {
        const message = "激活新文件需要已选择的配置集。";
        activateError = message;
        error = message;
        emit();
        throw new Error(message);
      }
      activating = true;
      activateError = "";
      error = "";
      emit();
      try {
        const result = await repo.activateCandidate(projectId, candidate.id, {
          expectedCurrentVersionId: candidate.baseVersionId ?? null,
          configSetId: candidate.fileId ? undefined : input.configSetId,
          role: candidate.fileId ? undefined : activateRole
        });
        candidate = result.item;
        emit();
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "激活候选失败。";
        activateError = message;
        error = message;
        if (/stale/i.test(message)) {
          try {
            const refreshed = await repo.getCandidate(projectId, candidate.id);
            candidate = refreshed;
          } catch {
            // keep prior candidate state
          }
        }
        emit();
        throw err instanceof Error ? err : new Error(message);
      } finally {
        activating = false;
        emit();
      }
    }
  };

  cachedSnapshot = rebuild();
  return flow;
}
