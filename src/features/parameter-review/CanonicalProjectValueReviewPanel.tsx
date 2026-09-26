import { useEffect, useRef, useState } from "react";
import type {
  CatalogBatchValueChangeRequestResponse,
  CatalogSourceConflictDecisionResponse,
  CatalogValueChangeSourceDiffResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import {
  canonicalRequestActionLabel,
  canonicalRequestSourceText,
  canonicalStatusLabels,
  isCanonicalHistory,
  isCanonicalPending,
  type CanonicalRequest
} from "./canonicalSubmissionTracking";

type CanonicalProjectValueReviewPanelProps = {
  projectId: string;
  repository?: ParameterCatalogRepository;
  canReview?: boolean;
  currentUserId?: string;
  /** Canonical request id from ?request=. A stale id must not select row 1. */
  initialRequestId?: string;
  /** Keep the selected request shareable when the parent owns the route. */
  onSelectRequest?: (requestId: string | null) => void;
  /** Personal tracking view asks the server for the authenticated user's rows. */
  mineOnly?: boolean;
};

type ReviewView = "pending" | "history";
type SourceDiff = CatalogValueChangeSourceDiffResponse["item"];
type BatchRequest = CatalogBatchValueChangeRequestResponse["item"];
type BatchSourceDiff = Extract<SourceDiff, { kind: "batch" }>;
type ConflictDecision = CatalogSourceConflictDecisionResponse["item"];
type SourceDiffState = "idle" | "loading" | "ready" | "error";

function matchesFrozenConflict(request: CanonicalRequest, diff: SourceDiff | null,
  decision: ConflictDecision | null): boolean {
  if (!decision || !diff || "kind" in diff) return false;
  const frozenBindings = decision.sourceDiff.bindings;
  if (!Array.isArray(frozenBindings) || frozenBindings.length !== diff.bindings.length
    || !diff.bindings.every((binding, index) => {
      const frozen = frozenBindings[index];
      return frozen && typeof frozen === "object"
        && binding.bindingId === frozen.bindingId && binding.oldValueId === frozen.oldValueId
        && binding.sourcePinId === frozen.sourcePinId
        && binding.sourceOccurrenceId === frozen.sourceOccurrenceId
        && binding.definitionId === frozen.definitionId
        && binding.effectiveRevisionId === frozen.effectiveRevisionId
        && binding.catalogReleaseId === frozen.catalogReleaseId
        && binding.configSetId === frozen.configSetId
        && binding.valueKind === frozen.valueKind && binding.valueDigest === frozen.valueDigest
        && JSON.stringify(binding.locator) === JSON.stringify(frozen.locator);
    })) return false;
  return /^[0-9a-f]{64}$/.test(decision.decisionProofDigest)
    && decision.request.id === request.id && decision.request.bindingId === request.bindingId
    && decision.request.targetValue === request.targetValue
    && decision.request.status === request.status
    && decision.request.assignedToUserId === request.assignedToUserId
    && decision.request.submitterUserId === request.submitterUserId
    && decision.sourceCandidateId !== request.candidateId
    && decision.selectedBindingId === request.bindingId && Boolean(decision.selectedDraftId)
    && (decision.choice === "file" || decision.choice === "draft")
    && decision.sourceDiff.requestId === request.id && diff.requestId === request.id
    && decision.sourceDiff.format === request.sourceFormat && diff.format === request.sourceFormat
    && decision.sourceDiff.bindingId === request.bindingId && diff.bindingId === request.bindingId
    && decision.sourceDiff.candidateId === request.candidateId && diff.candidateId === request.candidateId
    && decision.sourceDiff.sourcePinId === request.sourcePinId && diff.sourcePinId === request.sourcePinId
    && decision.sourceDiff.baseDigest === diff.baseDigest
    && decision.sourceDiff.proposedDigest === diff.proposedDigest
    && decision.sourceDiff.diffDigest === diff.diffDigest
    && decision.sourceDiff.before === diff.before && decision.sourceDiff.after === diff.after
    && diff.bindings.filter((binding) => binding.bindingId === request.bindingId).length === 1;
}

function matchesFrozenBatch(request: BatchRequest, diff: BatchSourceDiff): boolean {
  const seen = new Set<string>();
  return diff.requestId === request.id && diff.candidateId === request.candidateId
    && diff.batchProofDigest === request.batchProofDigest && diff.diffDigest === request.batchProofDigest
    && diff.bindings.length === request.cohortCount && diff.targets.length === request.targets.length
    && request.targets.every((target, index) => {
      const source = diff.targets[index];
      if (!source || target.ordinal !== index || source.ordinal !== index || seen.has(target.bindingId)
        || source.bindingId !== target.bindingId || source.sourcePinId !== target.sourcePinId
        || source.action !== target.action) return false;
      seen.add(target.bindingId);
      return target.action === "delete"
        ? target.targetText === null && source.afterText === undefined
        : target.targetText !== null && target.targetText === source.afterText;
    });
}

function idempotencyKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `review-${Date.now()}`;
}

/** Canonical v2 review queue. It deliberately does not translate requests to legacy rounds or IDs. */
export function CanonicalProjectValueReviewPanel({
  projectId,
  repository,
  canReview = true,
  currentUserId,
  initialRequestId,
  onSelectRequest,
  mineOnly = false
}: CanonicalProjectValueReviewPanelProps) {
  const canonicalRepository = repository;
  const [view, setView] = useState<ReviewView>("pending");
  const [requests, setRequests] = useState<readonly CanonicalRequest[]>([]);
  const [batchRequests, setBatchRequests] = useState<readonly BatchRequest[]>([]);
  const [batchRequest, setBatchRequest] = useState<BatchRequest | null>(null);
  const [batchDetailLoadedId, setBatchDetailLoadedId] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState(false);
  const [batchRefresh, setBatchRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SourceDiff | null>(null);
  const [sourceDiffState, setSourceDiffState] = useState<SourceDiffState>("idle");
  const [sourceDiffError, setSourceDiffError] = useState<string | null>(null);
  const [conflictDecision, setConflictDecision] = useState<ConflictDecision | null>(null);
  const [conflictDecisionState, setConflictDecisionState] = useState<"idle" | "loading" | "ordinary" | "ready" | "error">("idle");
  const [conflictDecisionError, setConflictDecisionError] = useState<string | null>(null);
  const [staleRequestId, setStaleRequestId] = useState<string | null>(null);
  const deepLinkRequestRef = useRef<string | null>(initialRequestId ?? null);
  const scopeRef = useRef({ projectId, currentUserId });
  scopeRef.current = { projectId, currentUserId };
  const isCurrentScope = () => scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;
  const selected = batchSelected ? null : requests.find((request) => request.id === selectedId) ?? null;
  const selectedRequestId = selected?.id ?? null;
  const effectiveSelectedId = batchSelected ? batchRequest?.id ?? null : selected?.id ?? null;
  const canReviewSelected = Boolean(
    !mineOnly && canReview && currentUserId && selected && selected.submitterUserId !== currentUserId
      && (conflictDecisionState === "ordinary" || (conflictDecisionState === "ready"
        && selected.assignedToUserId === currentUserId))
  );

  useEffect(() => {
    setBusy(false);
  }, [projectId, currentUserId]);

  useEffect(() => {
    deepLinkRequestRef.current = initialRequestId ?? null;
    setStaleRequestId(null);
    setSelectedId(null);
  }, [initialRequestId, projectId]);

  useEffect(() => {
    if (!canonicalRepository?.listProjectValueChangeRequests) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRequests([]);
    setBatchRequests([]);
    setBatchRequest(null);
    setBatchDetailLoadedId(null);
    setBatchSelected(false);
    setSelectedId(null);
    setStaleRequestId(null);
    setSourceDiff(null);
    setSourceDiffError(null);
    setSourceDiffState("idle");
    const deepLinkRequestId = deepLinkRequestRef.current;
    const query = {
      ...(deepLinkRequestId || view !== "pending" ? {} : { status: "pending" as const }),
      ...(mineOnly ? { mine: true } : {})
    };
    void canonicalRepository.listProjectValueChangeRequests(
      projectId,
      // A deep link is loaded without a status filter so a terminal request can
      // open directly in the history view. Normal queue loads remain bounded.
      Object.keys(query).length > 0 ? query : undefined
    )
      .then(async (response) => {
        if (cancelled) return;
        const batchResponse = canonicalRepository.listProjectValueBatchChangeRequests && (mineOnly || canReview)
          ? await canonicalRepository.listProjectValueBatchChangeRequests(projectId,
            Object.keys(query).length > 0 ? query : undefined)
          : { items: [] as BatchRequest[] };
        if (cancelled) return;
        const nextBatches = batchResponse.items.filter((request) =>
          (!mineOnly || request.submitterUserId === currentUserId)
          && (view === "pending" ? request.status === "pending" : request.status !== "pending"));
        setBatchRequests(nextBatches);
        const nextRequests = response.items.filter((request) =>
          (!mineOnly || request.submitterUserId === currentUserId)
          && (view === "pending" ? isCanonicalPending(request) : isCanonicalHistory(request))
        ) as CanonicalRequest[];
        const requestedCandidate = deepLinkRequestId
          ? (response.items.find((request) => request.id === deepLinkRequestId) as CanonicalRequest | undefined)
          : undefined;
        const requested = requestedCandidate && (!mineOnly || requestedCandidate.submitterUserId === currentUserId)
          ? requestedCandidate
          : undefined;
        if (deepLinkRequestId && !requested) {
          const listedBatch = batchResponse.items.find((request) => request.id === deepLinkRequestId
            && (!mineOnly || request.submitterUserId === currentUserId));
          if (listedBatch) {
            if ((view === "pending") !== (listedBatch.status === "pending")) {
              setView(listedBatch.status === "pending" ? "pending" : "history");
              return;
            }
            setRequests(nextRequests);
            setBatchRequest(listedBatch);
            setBatchDetailLoadedId(mineOnly ? listedBatch.id : null);
            setBatchSelected(true);
            setSelectedId(null);
            deepLinkRequestRef.current = null;
            return;
          }
          if (!mineOnly && canonicalRepository.getProjectValueBatchChangeRequest) {
            try {
              const batch = (await canonicalRepository.getProjectValueBatchChangeRequest(projectId, deepLinkRequestId)).item;
              if (cancelled) return;
              if ((view === "pending") !== (batch.status === "pending")) {
                setView(batch.status === "pending" ? "pending" : "history");
                return;
              }
              setRequests(nextRequests);
              setBatchRequest(batch);
              setBatchDetailLoadedId(batch.id);
              setBatchSelected(true);
              setSelectedId(null);
              deepLinkRequestRef.current = null;
              return;
            } catch (loadError) {
              if (cancelled) return;
              if (!(loadError instanceof WiseEffApiError && loadError.code === "NOT_FOUND")) {
                setError(presentError(loadError, "加载批量审核请求失败，请稍后重试。"));
                return;
              }
            }
          }
          setRequests(nextRequests);
          setSelectedId(null);
          setStaleRequestId(deepLinkRequestId);
          deepLinkRequestRef.current = null;
          return;
        }
        if (requested && ((view === "pending" && isCanonicalHistory(requested)) || (view === "history" && isCanonicalPending(requested)))) {
          setView(isCanonicalPending(requested) ? "pending" : "history");
          return;
        }
        const nextSelectedId = requested && (
          view === "pending" ? isCanonicalPending(requested) : isCanonicalHistory(requested)
        )
          ? requested.id
          : nextRequests[0]?.id ?? null;
        setRequests(nextRequests);
        setSelectedId(nextSelectedId);
        if (!nextSelectedId && nextBatches.length > 0) {
          setBatchRequest(nextBatches[0]);
          setBatchDetailLoadedId(mineOnly ? nextBatches[0].id : null);
          setBatchSelected(true);
        }
        if (deepLinkRequestId) {
          deepLinkRequestRef.current = null;
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(presentError(loadError, "加载软件审核请求失败，请稍后重试。"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [batchRefresh, canReview, canonicalRepository, currentUserId, initialRequestId, mineOnly, projectId, view]);

  useEffect(() => {
    if (!batchSelected || !batchRequest || mineOnly || batchDetailLoadedId === batchRequest.id) return;
    const read = canonicalRepository?.getProjectValueBatchChangeRequest;
    if (!read) return;
    let cancelled = false;
    const requestId = batchRequest.id;
    void read(projectId, requestId).then(({ item }) => {
      if (cancelled) return;
      setBatchRequest(item);
      setBatchDetailLoadedId(requestId);
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载批量请求详情失败，已阻止审核。"));
    });
    return () => { cancelled = true; };
  }, [batchSelected, batchRequest, batchDetailLoadedId, canonicalRepository, mineOnly, projectId]);

  useEffect(() => {
    const requestId = effectiveSelectedId;
    const loadSourceDiff = canonicalRepository?.getProjectValueChangeSourceDiff;
    setSourceDiff(null);
    setSourceDiffError(null);
    if (!requestId || (mineOnly && batchSelected)) {
      setSourceDiffState("idle");
      return undefined;
    }
    if (!loadSourceDiff) {
      setSourceDiffState("error");
      setSourceDiffError("固定源差异接口未配置，已阻止批准。");
      return undefined;
    }
    let cancelled = false;
    setSourceDiffState("loading");
    void loadSourceDiff(projectId, requestId)
      .then((response) => {
        if (cancelled) return;
        setSourceDiff(response.item);
        setSourceDiffState("ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        setSourceDiffState("error");
        setSourceDiffError(presentError(loadError, "加载固定源差异失败，已阻止批准。"));
      });
    return () => {
      cancelled = true;
    };
  }, [canonicalRepository, projectId, effectiveSelectedId, mineOnly, batchSelected, batchRefresh]);

  useEffect(() => {
    setConflictDecision(null);
    setConflictDecisionError(null);
    if (!selectedRequestId || !canonicalRepository?.getProjectValueConflictDecision) {
      setConflictDecisionState(selectedRequestId ? "ordinary" : "idle");
      return;
    }
    let cancelled = false;
    setConflictDecisionState("loading");
    void canonicalRepository.getProjectValueConflictDecision(projectId, selectedRequestId).then(({ item }) => {
      if (cancelled) return;
      setConflictDecision(item);
      setConflictDecisionState("ready");
    }).catch((cause) => {
      if (cancelled) return;
      if (cause instanceof WiseEffApiError && cause.code === "NOT_FOUND") {
        setConflictDecisionState("ordinary");
      } else {
        setConflictDecisionState("error");
        setConflictDecisionError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
          ? "冲突决策来源或证明已过期（409），已阻止批准；请刷新请求状态。"
          : presentError(cause, "读取冲突决策详情失败，已阻止批准。"));
      }
    });
    return () => { cancelled = true; };
  }, [canonicalRepository, projectId, selectedRequestId, batchRefresh]);

  if (!canonicalRepository?.listProjectValueChangeRequests || (!mineOnly && !canonicalRepository.reviewProjectValueChangeRequest)) {
    return (
      <section className="canonical-project-value-review" aria-label={mineOnly ? "我的参数提交" : "软件配置审核"}>
        <p role="alert">新版参数请求暂不可用，请稍后重试。</p>
      </section>
    );
  }
  const reviewProjectValueChangeRequest = canonicalRepository.reviewProjectValueChangeRequest;
  const withdrawSelected = async () => {
    if (!selected || busy || selected.status !== "pending" || selected.submitterUserId !== currentUserId
      || !canonicalRepository.withdrawProjectValueChangeRequest) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await canonicalRepository.getCatalog();
      if (!isCurrentScope()) return;
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止撤回。");
      await canonicalRepository.withdrawProjectValueChangeRequest(projectId, selected.id, {
        catalogReleaseId, idempotencyKey: idempotencyKey()
      });
      if (!isCurrentScope()) return;
      if (conflictDecisionState === "ready") {
        deepLinkRequestRef.current = selected.id;
        onSelectRequest?.(selected.id);
        setView("history");
        setBatchRefresh((value) => value + 1);
        return;
      }
      const next = requests.filter((request) => request.id !== selected.id);
      const nextId = next[0]?.id ?? null;
      setRequests(next);
      setSelectedId(nextId);
      onSelectRequest?.(nextId);
    } catch (withdrawError) {
      if (isCurrentScope()) setError(presentError(withdrawError, "撤回失败，请稍后重试。"));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  };
  const reviewSelected = async (decision: "approve" | "reject") => {
    if (!selected || busy || view !== "pending" || !canReviewSelected || !reviewProjectValueChangeRequest) return;
    if (decision === "approve" && !sourceDiffReadyForSelected) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await canonicalRepository.getCatalog();
      if (!isCurrentScope()) return;
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止审核。");
      await reviewProjectValueChangeRequest(
        projectId,
        selected.id,
        { decision },
        { catalogReleaseId, idempotencyKey: idempotencyKey() }
      );
      if (!isCurrentScope()) return;
      if (conflictDecisionState === "ready") {
        deepLinkRequestRef.current = selected.id;
        onSelectRequest?.(selected.id);
        setView("history");
        setBatchRefresh((value) => value + 1);
        return;
      }
      const next = requests.filter((request) => request.id !== selected.id);
      const nextId = next[0]?.id ?? null;
      setRequests(next);
      setSelectedId(nextId);
      onSelectRequest?.(nextId);
    } catch (reviewError) {
      if (isCurrentScope()) {
        setError(reviewError instanceof WiseEffApiError && reviewError.code === "CONFLICT"
          ? "来源或决策证明已过期（409），审核未应用；请刷新请求状态。"
          : presentError(reviewError, "软件审核失败，请稍后重试。"));
        if (conflictDecisionState === "ready") {
          setConflictDecisionState("error");
          setConflictDecisionError("审核结果待重新核对，已阻止再次批准；请刷新请求状态。");
        }
      }
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  };
  const sourceDiffReadyForSelected = Boolean(
    selected && sourceDiffState === "ready" && sourceDiff?.requestId === selected.id
      && !("kind" in sourceDiff)
      && (conflictDecisionState === "ordinary" || (conflictDecisionState === "ready"
        && matchesFrozenConflict(selected, sourceDiff, conflictDecision)))
  );
  const singleDiff = sourceDiff && !("kind" in sourceDiff) ? sourceDiff : null;
  const batchDiff = sourceDiff && "kind" in sourceDiff ? sourceDiff : null;
  const batchProofReady = Boolean(batchRequest && batchSelected && batchDetailLoadedId === batchRequest.id
    && sourceDiffState === "ready"
    && batchDiff && matchesFrozenBatch(batchRequest, batchDiff));
  const canReviewBatch = Boolean(!mineOnly && canReview && currentUserId && batchRequest
    && batchRequest.submitterUserId !== currentUserId && batchRequest.assignedToUserId === currentUserId);
  const reviewBatch = async (decision: "approve" | "reject") => {
    if (!batchRequest || (decision === "approve" && !batchProofReady) || !canReviewBatch || busy || batchRequest.status !== "pending"
      || !reviewProjectValueChangeRequest || !canonicalRepository.getProjectValueBatchChangeRequest) return;
    setBusy(true);
    setError(null);
    const requestId = batchRequest.id;
    try {
      const catalog = await canonicalRepository.getCatalog();
      if (!isCurrentScope()) return;
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止审核。");
      await reviewProjectValueChangeRequest(projectId, requestId,
        { decision, batchProofDigest: batchRequest.batchProofDigest },
        { catalogReleaseId, idempotencyKey: idempotencyKey() });
      if (!isCurrentScope()) return;
      const refreshed = (await canonicalRepository.getProjectValueBatchChangeRequest(projectId, requestId)).item;
      if (!isCurrentScope()) return;
      if (refreshed.status !== (decision === "approve" ? "approved" : "rejected")
        || refreshed.batchProofDigest !== batchRequest.batchProofDigest
        || refreshed.targets.length !== batchRequest.targets.length
        || refreshed.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== batchRequest.targets[index].bindingId
          || (decision === "approve" && (!target.appliedValueId
            || !target.appliedHistoryEventId || !target.appliedSourcePinId || !target.appliedFileVersionId)))) {
        throw new Error("批量审核结果不完整，已停止展示成功状态。");
      }
      setBatchRequest(refreshed);
      deepLinkRequestRef.current = requestId;
      setView("history");
    } catch (reviewError) {
      if (!isCurrentScope()) return;
      setError(presentError(reviewError, "批量软件审核失败，请刷新状态后重试。"));
      setSourceDiffState("error");
      setSourceDiffError(reviewError instanceof WiseEffApiError && reviewError.code === "CONFLICT"
        ? "来源或审核证明已变化，已阻止再次批准；请刷新请求状态。"
        : "审核结果尚未确认，已阻止再次批准；请刷新请求状态。");
      try {
        const latest = (await canonicalRepository.getProjectValueBatchChangeRequest(projectId, requestId)).item;
        if (!isCurrentScope()) return;
        setBatchRequest(latest);
        if (latest.status !== "pending") {
          deepLinkRequestRef.current = requestId;
          setView("history");
        }
      } catch {
        // Keep the request blocked until a fresh read succeeds.
      }
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  };
  const withdrawBatch = async () => {
    if (!batchRequest || busy || batchRequest.status !== "pending"
      || batchRequest.submitterUserId !== currentUserId
      || !canonicalRepository.withdrawProjectValueChangeRequest) return;
    const requestId = batchRequest.id;
    setBusy(true);
    setError(null);
    try {
      const catalogReleaseId = (await canonicalRepository.getCatalog()).item?.catalogReleaseId;
      if (!isCurrentScope()) return;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止撤回。");
      const response = await canonicalRepository.withdrawProjectValueChangeRequest(projectId, requestId,
        { catalogReleaseId, idempotencyKey: idempotencyKey() });
      if (!isCurrentScope()) return;
      if (!("batchProofDigest" in response.item) || response.item.id !== requestId
        || response.item.status !== "withdrawn" || response.item.batchProofDigest !== batchRequest.batchProofDigest) {
        throw new Error("批量撤回结果不完整，请刷新状态核对。");
      }
      setBatchRequest(response.item);
      deepLinkRequestRef.current = requestId;
      setView("history");
    } catch (withdrawError) {
      if (isCurrentScope()) {
        setError(presentError(withdrawError, "批量撤回失败，请刷新状态后重试。"));
        deepLinkRequestRef.current = requestId;
        setBatchRefresh((value) => value + 1);
      }
    } finally { if (isCurrentScope()) setBusy(false); }
  };

  return (
    <section className="canonical-project-value-review" aria-label={mineOnly ? "我的参数提交" : "软件配置审核"}>
      <header>
        <h2>{mineOnly ? "我的参数提交" : "软件配置审核"}</h2>
        <p>{mineOnly ? "追踪本人提交的新版参数请求及其固定来源差异。" : "核对提交时固定的源文件差异，批准后同步更新参数值与源文件。"}</p>
        <div role="tablist" aria-label={mineOnly ? "我的参数提交视角" : "软件配置审核视角"}>
          <button className="button subtle" type="button" role="tab" disabled={busy} aria-selected={view === "pending"} onClick={() => {
            if (batchSelected) deepLinkRequestRef.current = batchRequest?.id ?? null;
            setView("pending");
          }}>
            待审核
          </button>
          <button className="button subtle" type="button" role="tab" disabled={busy} aria-selected={view === "history"} onClick={() => {
            if (batchSelected) deepLinkRequestRef.current = batchRequest?.id ?? null;
            setView("history");
          }}>
            历史
          </button>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {staleRequestId ? (
        <p role="alert">请求「{staleRequestId}」已失效、已归档或不属于当前项目，未自动切换到其他请求。</p>
      ) : null}
      {loading ? <p role="status">正在加载源文件审核请求…</p> : null}
      {!loading && !error && !staleRequestId && requests.length === 0 && batchRequests.length === 0 && !batchRequest ? <p role="status">当前没有{mineOnly ? "你的" : view === "pending" ? "待审核" : "历史"}源文件请求。</p> : null}
      {requests.length > 0 || batchRequests.length > 0 || batchRequest ? (
        <div className="canonical-project-value-review__content">
          <div className="table-wrap">
            <table aria-label={mineOnly ? "我的参数提交请求" : "软件配置审核请求"}>
              <thead>
                <tr><th>绑定</th><th>格式</th><th>动作</th><th>状态</th><th>原因</th></tr>
              </thead>
              <tbody>
                {(batchRequest && !batchRequests.some((request) => request.id === batchRequest.id)
                  ? [batchRequest, ...batchRequests] : batchRequests).map((request) => (
                  <tr key={request.id}>
                    <td><button type="button" disabled={busy} aria-current={batchSelected && batchRequest?.id === request.id ? "true" : undefined}
                      className="button subtle" onClick={() => {
                        setBatchRequest(request);
                        setBatchDetailLoadedId(mineOnly ? request.id : null);
                        setBatchSelected(true);
                        setSelectedId(null);
                        onSelectRequest?.(request.id);
                      }}>查看批量请求</button></td>
                    <td>批量</td><td>{request.targets.length} 项来源变更</td>
                    <td>{canonicalStatusLabels[request.status]}</td><td>{request.reason}</td>
                  </tr>
                ))}
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        aria-current={request.id === selectedId ? "true" : undefined}
                        className="button subtle"
                        onClick={() => {
                          setBatchSelected(false);
                          setSelectedId(request.id);
                          onSelectRequest?.(request.id);
                        }}
                      >
                        查看请求
                      </button>
                    </td>
                    <td>{request.sourceFormat.toUpperCase()}</td>
                    <td>{canonicalRequestActionLabel(request)}</td>
                    <td>{canonicalStatusLabels[request.status]}</td>
                    <td>{request.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected ? (
            <article aria-label="源文件请求详情">
              <h3>源文件变更详情</h3>
              <dl>
                <div><dt>参数记录</dt><dd><code>{selected.bindingId}</code></dd></div>
                <div><dt>请求 ID</dt><dd><code>{selected.id}</code></dd></div>
                <div><dt>来源快照</dt><dd><code>{selected.sourcePinId ?? "—"}</code></dd></div>
                <div><dt>候选文件</dt><dd><code>{selected.candidateId ?? "—"}</code></dd></div>
                <div><dt>变更动作</dt><dd>{selected.action === "delete" && selected.status === "pending"
                  ? "删除属性（批准后生效）" : canonicalRequestActionLabel(selected)}</dd></div>
                <div><dt>修改原因</dt><dd>{selected.reason}</dd></div>
                <div><dt>提交人 ID</dt><dd><code>{selected.submitterUserId ?? "—"}</code></dd></div>
                <div><dt>指定审核人 ID</dt><dd><code>{selected.assignedToUserId ?? "—"}</code></dd></div>
                <div><dt>{selected.status === "withdrawn" ? "撤回操作人 ID" : "实际审核人 ID"}</dt><dd><code>{selected.reviewerUserId ?? "—"}</code></dd></div>
                <div><dt>提交时间</dt><dd><time dateTime={selected.createdAt}>{selected.createdAt}</time></dd></div>
                <div><dt>状态更新时间</dt><dd><time dateTime={selected.updatedAt}>{selected.updatedAt}</time></dd></div>
                <div><dt>审核结果</dt><dd>{selected.reviewerNote ?? canonicalStatusLabels[selected.status]}</dd></div>
                <div><dt>应用结果</dt><dd>{selected.applyOutcome === "committed" ? "已应用" : selected.applyOutcome === "replayed" ? "已应用（幂等重放）" : "—"}</dd></div>
              </dl>
              <pre aria-label="固定源目标内容">{canonicalRequestSourceText(selected)}</pre>
              {conflictDecisionState === "loading" ? <p role="status">正在核对冲突决策详情…</p> : null}
              {conflictDecisionError ? <p role="alert">{conflictDecisionError}</p> : null}
              {conflictDecisionState !== "ordinary" ? <button type="button" className="button subtle"
                disabled={busy} onClick={() => {
                  deepLinkRequestRef.current = selected.id;
                  setBatchRefresh((value) => value + 1);
                }}>刷新冲突请求与来源</button> : null}
              {conflictDecisionState === "ready" && conflictDecision ? (
                <section aria-label="冻结的单项来源冲突决策">
                  <h4>单项来源冲突决策</h4>
                  <dl>
                    <div><dt>选择</dt><dd>{conflictDecision.choice === "file" ? "文件值" : "界面草稿值"}</dd></div>
                    <div><dt>选中 Binding</dt><dd><code>{conflictDecision.selectedBindingId}</code></dd></div>
                    <div><dt>选中草稿</dt><dd><code>{conflictDecision.selectedDraftId}</code></dd></div>
                    <div><dt>原候选</dt><dd><code>{conflictDecision.sourceCandidateId}</code></dd></div>
                    <div><dt>决策证明</dt><dd><code>{conflictDecision.decisionProofDigest}</code></dd></div>
                    <div><dt>来源格式</dt><dd>{conflictDecision.sourceDiff.format.toUpperCase()}</dd></div>
                  </dl>
                  {matchesFrozenConflict(selected, sourceDiff, conflictDecision) ? <>
                    <p>经验证的冻结来源差异</p>
                    <pre tabIndex={0} aria-label="冲突来源变更前">{conflictDecision.sourceDiff.before}</pre>
                    <pre tabIndex={0} aria-label="冲突来源变更后">{conflictDecision.sourceDiff.after}</pre>
                  </> : <p role="alert">冲突详情、目标、顺序或证明与请求来源不符，已阻止批准。</p>}
                </section>
              ) : null}
              <p role="note">以下差异固定于提交时，不随当前文件变化。</p>
              {sourceDiffState === "loading" ? <p role="status">正在加载固定源差异…</p> : null}
              {sourceDiffError ? <p role="alert">{sourceDiffError}</p> : null}
              {singleDiff ? (
                <section aria-label="固定源差异" className="canonical-project-value-review__diff">
                  <dl>
                    <div><dt>源文件</dt><dd><code>{singleDiff.sourceName}</code></dd></div>
                    <div><dt>格式</dt><dd>{singleDiff.format.toUpperCase()}</dd></div>
                    <div><dt>受影响绑定</dt><dd>{singleDiff.bindings.length}</dd></div>
                    <div><dt>原文件校验摘要</dt><dd><code>{singleDiff.baseDigest}</code></dd></div>
                    <div><dt>候选校验摘要</dt><dd><code>{singleDiff.proposedDigest}</code></dd></div>
                    <div><dt>差异校验摘要</dt><dd><code>{singleDiff.diffDigest}</code></dd></div>
                  </dl>
                  <div>
                    <h4>变更前</h4>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更前"
                      className="canonical-project-value-review__diff-text"
                    >{singleDiff.before}</pre>
                  </div>
                  <div>
                    <h4>变更后</h4>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更后"
                      className="canonical-project-value-review__diff-text"
                    >{singleDiff.after}</pre>
                  </div>
                </section>
              ) : null}
              {view === "pending" && selected.status === "pending" && canReviewSelected ? (
                <div>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !sourceDiffReadyForSelected}
                    onClick={() => void reviewSelected("approve")}
                  >
                    批准软件配置
                  </button>{" "}
                  <button type="button" className="button subtle" disabled={busy} onClick={() => void reviewSelected("reject")}>
                    驳回
                  </button>
                </div>
              ) : view === "pending" && selected.status === "pending" ? (
                <p role="note">{selected.submitterUserId === currentUserId
                  ? "不能审核自己的提交；请由其他合格审核员处理。"
                  : "当前账号不是该项目的软件审核员；审核操作由服务端拒绝。"}</p>
              ) : null}
              {view === "pending" && selected.status === "pending" && selected.submitterUserId === currentUserId
                && canonicalRepository.withdrawProjectValueChangeRequest ? (
                  <button type="button" className="button subtle" disabled={busy} onClick={() => void withdrawSelected()}>
                    撤回我的提交
                  </button>
                ) : null}
            </article>
          ) : null}
          {batchSelected && batchRequest ? (
            <article aria-label="批量源文件请求详情">
              <h3>批量来源变更</h3>
              <dl>
                <div><dt>请求 ID</dt><dd><code>{batchRequest.id}</code></dd></div>
                <div><dt>状态</dt><dd>{canonicalStatusLabels[batchRequest.status]}</dd></div>
                <div><dt>候选文件</dt><dd><code>{batchRequest.candidateId}</code></dd></div>
                <div><dt>基线文件版本</dt><dd><code>{batchRequest.baseVersionId}</code></dd></div>
                <div><dt>配置集</dt><dd><code>{batchRequest.configSetId}</code></dd></div>
                <div><dt>批量证明摘要</dt><dd><code>{batchRequest.batchProofDigest}</code></dd></div>
                {batchDiff ? <div><dt>来源格式</dt><dd>{batchDiff.format.toUpperCase()}</dd></div> : null}
                <div><dt>修改原因</dt><dd>{batchRequest.reason}</dd></div>
                <div><dt>提交人 ID</dt><dd><code>{batchRequest.submitterUserId ?? "—"}</code></dd></div>
                <div><dt>指定审核人 ID</dt><dd><code>{batchRequest.assignedToUserId ?? "—"}</code></dd></div>
                <div><dt>实际审核人 ID</dt><dd><code>{batchRequest.reviewerUserId ?? "—"}</code></dd></div>
              </dl>
              {sourceDiffState === "loading" ? <p role="status">正在加载全部目标的固定源差异…</p> : null}
              {mineOnly ? <p role="note">提交者可查看服务端冻结的全部目标；固定源差异由被指派审核人核对。</p> : null}
              {sourceDiffError ? <p role="alert">{sourceDiffError}</p> : null}
              <button type="button" className="button subtle" disabled={busy} onClick={() => {
                deepLinkRequestRef.current = batchRequest.id;
                setBatchRefresh((value) => value + 1);
              }}>刷新批量请求与来源</button>
              {sourceDiffState === "ready" && !batchProofReady ? (
                <p role="alert">批量请求与来源差异的目标、顺序或证明不一致，已阻止批准。</p>
              ) : null}
              <ol aria-label="批量审核目标">
                {batchRequest.targets.map((target, index) => {
                  const source = batchProofReady ? batchDiff!.targets[index] : null;
                  return (
                    <li key={`${target.ordinal}:${target.bindingId}`}>
                      <h4>目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"}</h4>
                      <dl>
                        <div><dt>绑定</dt><dd><code>{target.bindingId}</code></dd></div>
                        <div><dt>定义</dt><dd><code>{target.definitionId}</code></dd></div>
                        <div><dt>基线值</dt><dd><code>{target.baseCurrentValueId}</code></dd></div>
                        <div><dt>基线修订</dt><dd><code>{target.configRevisionId}</code></dd></div>
                        <div><dt>来源 pin</dt><dd><code>{target.sourcePinId}</code></dd></div>
                        <div><dt>来源引用</dt><dd><code>{target.sourceRef}</code></dd></div>
                        <div><dt>目标</dt><dd>{target.action === "delete" ? "删除（无替换值）" : <pre>{target.targetText}</pre>}</dd></div>
                        {target.appliedValueId ? <div><dt>已应用值</dt><dd><code>{target.appliedValueId}</code></dd></div> : null}
                      </dl>
                      {source ? (
                        <div>
                          <p>来源变更前</p><pre tabIndex={0} aria-label={`目标 ${index + 1} 来源变更前`}>{source.beforeText}</pre>
                          <p>来源变更后</p><pre tabIndex={0} aria-label={`目标 ${index + 1} 来源变更后`}>{source.afterText ?? "删除"}</pre>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {batchProofReady && batchDiff ? (
                <section aria-label="批量固定源差异" className="canonical-project-value-review__diff">
                  <dl>
                    <div><dt>源文件</dt><dd><code>{batchDiff.sourceName}</code></dd></div>
                    <div><dt>原文件校验摘要</dt><dd><code>{batchDiff.baseDigest}</code></dd></div>
                    <div><dt>候选校验摘要</dt><dd><code>{batchDiff.proposedDigest}</code></dd></div>
                  </dl>
                  <div><h4>变更前</h4><pre tabIndex={0} aria-label="批量固定源变更前" className="canonical-project-value-review__diff-text">{batchDiff.before}</pre></div>
                  <div><h4>变更后</h4><pre tabIndex={0} aria-label="批量固定源变更后" className="canonical-project-value-review__diff-text">{batchDiff.after}</pre></div>
                </section>
              ) : null}
              {batchRequest.status === "pending" && canReviewBatch ? (
                <div>
                  <p role="note">批准时服务端会重新核对当前来源，并将全部目标作为一次事务提交。</p>
                  <button type="button" className="button primary" disabled={busy || !batchProofReady}
                    onClick={() => void reviewBatch("approve")}>批准全部 {batchRequest.targets.length} 项</button>{" "}
                  <button type="button" className="button subtle" disabled={busy}
                    onClick={() => void reviewBatch("reject")}>驳回全部 {batchRequest.targets.length} 项</button>
                </div>
              ) : batchRequest.status === "pending" ? (
                <p role="note">{batchRequest.submitterUserId === currentUserId
                  ? "不能审核自己的提交；请由其他合格审核员处理。"
                  : "当前账号不是此请求的被指派审核人；审核操作由服务端拒绝。"}</p>
              ) : null}
              {batchRequest.status === "pending" && batchRequest.submitterUserId === currentUserId
                && canonicalRepository.withdrawProjectValueChangeRequest ? (
                  <button type="button" className="button subtle" disabled={busy} onClick={() => void withdrawBatch()}>
                    撤回我的批量提交
                  </button>
                ) : null}
            </article>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
