import type {
  ActivateParameterFileCandidateResult,
  ParameterFileCandidate,
  ParameterFileRepository,
  ParameterFileSourcePreview,
  ParameterFileSourceReviewResult
} from "@/application/ports/ParameterFileRepository";
import { sourceReviewReason } from "./sourceReviewReason";

export type CandidateFileRepository = Pick<
  ParameterFileRepository,
  | "createCandidate"
  | "getCandidate"
  | "downloadCandidate"
  | "recomputeCandidate"
  | "abandonCandidate"
  | "activateCandidate"
> &
  Partial<Pick<ParameterFileRepository, "getCandidateSourcePreview">>;

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
  sourcePreview: ParameterFileSourcePreview | null;
  sourcePreviewLoading: boolean;
  sourcePreviewError: string;
  submittingSourceReview: boolean;
  sourceReviewError: string;
  sourceReviewResult: ParameterFileSourceReviewResult | null;
  activateRole: CandidateActivateRole;
  canActivate: boolean;
  canSubmitSourceReview: boolean;
  canRecompute: boolean;
  canAbandon: boolean;
};

export type CandidateVersionFlow = CandidateVersionFlowSnapshot & {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CandidateVersionFlowSnapshot;
  load(
    projectId: string,
    candidateId: string | null,
    repo: Pick<ParameterFileRepository, "getCandidate" | "downloadCandidate"> &
      Partial<Pick<ParameterFileRepository, "getCandidateSourcePreview">>
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
    repo: Pick<ParameterFileRepository, "recomputeCandidate"> &
      Partial<Pick<ParameterFileRepository, "getCandidateSourcePreview">>
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
  submitSourceReview(
    projectId: string,
    reason: string,
    repo: Pick<ParameterFileRepository, "submitCandidateSourceReview">
  ): Promise<ParameterFileSourceReviewResult>;
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

function deriveGates(
  candidate: ParameterFileCandidate | null,
  sourcePreview: ParameterFileSourcePreview | null,
  sourcePreviewError: string,
  sourcePreviewLoading: boolean
) {
  const status = candidate?.status;
  const sourcePreviewReady =
    Boolean(candidate) &&
    !sourcePreviewLoading &&
    !sourcePreviewError &&
    sourcePreview?.candidateId === candidate?.id;
  const sourceReviewLinked =
    sourcePreviewReady &&
    (sourcePreview?.request?.status === "pending" ||
      sourcePreview?.request?.status === "approved");
  return {
    canActivate:
      status === "ready" &&
      sourcePreviewReady &&
      sourcePreview?.kind === "legacy",
    canSubmitSourceReview:
      status === "ready" &&
      sourcePreviewReady &&
      sourcePreview?.kind === "canonical" &&
      sourcePreview.canSubmit === true &&
      Boolean(sourcePreview.proofToken) &&
      !sourceReviewLinked,
    canRecompute:
      sourcePreviewReady &&
      !sourceReviewLinked &&
      (status === "blocked" || status === "stale"),
    canAbandon:
      sourcePreviewReady &&
      !sourceReviewLinked &&
      (status === "ready" || status === "blocked" || status === "failed" || status === "stale")
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
    sourcePreview: null,
    sourcePreviewLoading: false,
    sourcePreviewError: "",
    submittingSourceReview: false,
    sourceReviewError: "",
    sourceReviewResult: null,
    activateRole: "overlay",
    canActivate: false,
    canSubmitSourceReview: false,
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
  let sourcePreview: ParameterFileSourcePreview | null = null;
  let sourcePreviewLoading = false;
  let sourcePreviewError = "";
  let submittingSourceReview = false;
  let sourceReviewError = "";
  let sourceReviewResult: ParameterFileSourceReviewResult | null = null;
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
      sourcePreview,
      sourcePreviewLoading,
      sourcePreviewError,
      submittingSourceReview,
      sourceReviewError,
      sourceReviewResult,
      activateRole,
      ...deriveGates(candidate, sourcePreview, sourcePreviewError, sourcePreviewLoading)
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
    get sourcePreview() {
      return cachedSnapshot.sourcePreview;
    },
    get sourcePreviewLoading() {
      return cachedSnapshot.sourcePreviewLoading;
    },
    get sourcePreviewError() {
      return cachedSnapshot.sourcePreviewError;
    },
    get submittingSourceReview() {
      return cachedSnapshot.submittingSourceReview;
    },
    get sourceReviewError() {
      return cachedSnapshot.sourceReviewError;
    },
    get sourceReviewResult() {
      return cachedSnapshot.sourceReviewResult;
    },
    get activateRole() {
      return cachedSnapshot.activateRole;
    },
    get canActivate() {
      return cachedSnapshot.canActivate;
    },
    get canSubmitSourceReview() {
      return cachedSnapshot.canSubmitSourceReview;
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
          sourcePreview = null;
          sourcePreviewLoading = false;
          sourcePreviewError = "";
          sourceReviewResult = null;
          loading = false;
          emit();
        }
        return;
      }
      loading = true;
      sourcePreviewLoading = Boolean(repo.getCandidateSourcePreview);
      error = "";
      sourcePreview = null;
      sourcePreviewError = "";
      sourceReviewError = "";
      sourceReviewResult = null;
      emit();
      try {
        const [item, downloaded, previewResult] = await Promise.all([
          repo.getCandidate(projectId, candidateId),
          repo.downloadCandidate(projectId, candidateId),
          repo.getCandidateSourcePreview
            ? repo.getCandidateSourcePreview(projectId, candidateId).then(
                (preview) => ({ preview, error: "" }),
                (previewError: unknown) => ({
                  preview: null,
                  error: previewError instanceof Error ? previewError.message : "来源预览加载失败。"
                })
              )
            : Promise.resolve({ preview: null, error: "" })
        ]);
        if (generation !== loadGeneration) return;
        candidate = item;
        sourceText = decodeSourceBytes(downloaded.bytes);
        sourcePreview = previewResult.preview;
        sourcePreviewError = previewResult.error;
      } catch (err: unknown) {
        if (generation !== loadGeneration) return;
        candidate = null;
        sourceText = "";
        sourcePreview = null;
        error = err instanceof Error ? err.message : "候选加载失败。";
      } finally {
        if (generation === loadGeneration) {
          loading = false;
          sourcePreviewLoading = false;
          emit();
        }
      }
    },

    clear() {
      loadGeneration += 1;
      candidate = null;
      sourceText = "";
      sourcePreview = null;
      sourcePreviewLoading = false;
      sourcePreviewError = "";
      submittingSourceReview = false;
      sourceReviewError = "";
      sourceReviewResult = null;
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
      sourcePreview = null;
      sourcePreviewLoading = false;
      sourcePreviewError = "";
      submittingSourceReview = false;
      sourceReviewError = "";
      sourceReviewResult = null;
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
        sourcePreview = null;
        sourcePreviewError = "";
        sourceReviewResult = null;
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
      if (sourcePreview?.request?.status === "pending" || sourcePreview?.request?.status === "approved") {
        const message =
          sourcePreview.request.status === "approved"
            ? "来源审核已通过，候选仍保留审核关联，不能重算。"
            : "已有待处理的来源审核，不能重算候选。";
        error = message;
        emit();
        throw new Error(message);
      }
      recomputing = true;
      error = "";
      sourcePreview = null;
      sourcePreviewError = "";
      sourceReviewError = "";
      sourceReviewResult = null;
      sourcePreviewLoading = Boolean(repo.getCandidateSourcePreview);
      emit();
      try {
        const updated = await repo.recomputeCandidate(projectId, candidate.id);
        candidate = updated;
        if (repo.getCandidateSourcePreview) {
          try {
            sourcePreview = await repo.getCandidateSourcePreview(projectId, updated.id);
          } catch (previewError: unknown) {
            sourcePreviewError =
              previewError instanceof Error ? previewError.message : "来源预览加载失败。";
          }
        }
        emit();
        return updated;
      } catch (err: unknown) {
        error = err instanceof Error ? err.message : "候选重算失败。";
        emit();
        throw err instanceof Error ? err : new Error(error);
      } finally {
        sourcePreviewLoading = false;
        recomputing = false;
        emit();
      }
    },

    async abandon(projectId, repo) {
      if (!candidate) throw new Error("没有可放弃的候选。");
      if (sourcePreview?.request?.status === "pending" || sourcePreview?.request?.status === "approved") {
        const message =
          sourcePreview.request.status === "approved"
            ? "来源审核已通过，候选仍保留审核关联，不能放弃。"
            : "已有待处理的来源审核，不能放弃候选。";
        error = message;
        emit();
        throw new Error(message);
      }
      abandoning = true;
      error = "";
      emit();
      try {
        const abandoned = await repo.abandonCandidate(projectId, candidate.id);
        candidate = abandoned;
        sourceReviewResult = null;
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
    },

    async submitSourceReview(projectId, reason, repo) {
      if (!candidate || candidate.status !== "ready") {
        throw new Error("只有 ready 状态的候选可以提交来源审核。");
      }
      if (!sourcePreview || sourcePreview.kind !== "canonical" || !sourcePreview.canSubmit) {
        const message = sourceReviewReason(sourcePreview?.reason);
        sourceReviewError = message;
        error = message;
        emit();
        throw new Error(message);
      }
      const expectedCurrentVersionId = sourcePreview.baseVersionId ?? candidate.baseVersionId;
      if (!expectedCurrentVersionId || !sourcePreview.proofToken || !reason.trim()) {
        const message = !expectedCurrentVersionId
          ? "缺少来源基版本，不能提交审核。"
          : !sourcePreview.proofToken
            ? "缺少来源一致性证明，不能提交审核。"
            : "请填写来源变更原因。";
        sourceReviewError = message;
        error = message;
        emit();
        throw new Error(message);
      }
      submittingSourceReview = true;
      sourceReviewError = "";
      error = "";
      emit();
      try {
        const result = await repo.submitCandidateSourceReview(projectId, candidate.id, {
          expectedCurrentVersionId,
          expectedProofToken: sourcePreview.proofToken,
          reason: reason.trim()
        });
        sourceReviewResult = result;
        sourcePreview = {
          ...sourcePreview,
          canSubmit: false,
          request: { id: result.requestId, status: result.status }
        };
        emit();
        return result;
      } catch (err: unknown) {
        sourceReviewError = err instanceof Error ? err.message : "提交来源审核失败。";
        error = sourceReviewError;
        emit();
        throw err instanceof Error ? err : new Error(sourceReviewError);
      } finally {
        submittingSourceReview = false;
        emit();
      }
    }
  };

  cachedSnapshot = rebuild();
  return flow;
}
