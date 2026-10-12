import { TabPanel } from "@/components/ui/tab-panel";
import { Badge } from "@/components/ui/badge";
import { useEffect, useId, useRef, useState } from "react";
import { ViewSwitch } from "@/components/ui/view-switch";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { formatAbsolute, formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { ReviewProvenance } from "./ReviewProvenance";
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
  detailOnly?: boolean;
  externalView?: "pending" | "history";
  onRequestsChanged?: () => void;
  users?: Array<{ id: string; name: string }>;
};

type ReviewView = "pending" | "history";
type SourceDiff = CatalogValueChangeSourceDiffResponse["item"];
type BatchRequest = CatalogBatchValueChangeRequestResponse["item"];
type BatchSourceDiff = Extract<SourceDiff, { kind: "batch" }>;
type ConflictDecision = NonNullable<CatalogSourceConflictDecisionResponse["item"]>;
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
  if (!request.draftImpact || !/^[0-9a-f]{64}$/.test(request.draftImpactDigest ?? "")
    || request.draftImpact.length !== request.cohortCount
    || request.draftImpact.some((entry, index) => {
      const binding = diff.bindings[index];
      const target = request.targets.find((row) => row.bindingId === entry.bindingId);
      return !binding || entry.ordinal !== index || entry.bindingId !== binding.bindingId
        || entry.baseCurrentValueId !== binding.oldValueId || entry.sourcePinId !== binding.sourcePinId
        || (target ? entry.role !== "target" || entry.decision !== target.decision
          || entry.selectedDraftId !== (target.draftId ?? undefined)
          : entry.role !== "sibling" || entry.decision !== "re-pin" || entry.selectedDraftId !== undefined);
    })) return false;
  const composition = request.compositionProof;
  const hasComposition = Boolean(request.uploadCandidateId || request.decisionProofDigest || composition);
  if (hasComposition && (!composition || !request.uploadCandidateId || !request.decisionProofDigest
    || !request.draftImpactDigest || !request.draftImpact || !diff.draftImpact
    || !/^[0-9a-f]{64}$/.test(request.draftImpactDigest)
    || !/^[0-9a-f]{64}$/.test(request.decisionProofDigest)
    || diff.uploadCandidateId !== request.uploadCandidateId
    || diff.decisionProofDigest !== request.decisionProofDigest || !diff.uploadAfter
    || composition.projectId !== request.projectId || composition.fileId !== request.fileId
    || composition.baseVersionId !== request.baseVersionId
    || composition.configSetId !== request.configSetId || composition.format !== diff.format
    || composition.cohortProofToken !== request.cohortProofToken
    || composition.uploadCandidateId !== request.uploadCandidateId
    || composition.composedCandidateId !== request.candidateId
    || composition.batchProofDigest !== request.batchProofDigest
    || composition.draftImpactDigest !== request.draftImpactDigest
    || composition.decisionProofDigest !== request.decisionProofDigest
    || composition.cohort.length !== request.cohortCount
    || composition.targetDecisions.length !== request.targets.length
    || JSON.stringify(diff.draftImpact) !== JSON.stringify(request.draftImpact)
    || composition.cohort.some((entry, index) => {
      const binding = diff.bindings[index];
      return !binding || binding.bindingId !== entry.bindingId
        || binding.oldValueId !== entry.oldValueId || binding.sourcePinId !== entry.sourcePinId
        || binding.sourceOccurrenceId !== entry.sourceOccurrenceId
        || binding.definitionId !== entry.definitionId
        || binding.effectiveRevisionId !== entry.effectiveRevisionId
        || binding.catalogReleaseId !== entry.catalogReleaseId
        || binding.valueDigest !== entry.valueDigest
        || binding.configSetId !== entry.configSetId
        || JSON.stringify(binding.locator) !== JSON.stringify(entry.locator);
    }))) return false;
  if (!hasComposition && (diff.uploadCandidateId || diff.decisionProofDigest || composition)) return false;
  return diff.requestId === request.id && diff.candidateId === request.candidateId
    && diff.batchProofDigest === request.batchProofDigest && diff.diffDigest === request.batchProofDigest
    && diff.bindings.length === request.cohortCount && diff.targets.length === request.targets.length
    && (!diff.draftImpact || JSON.stringify(diff.draftImpact) === JSON.stringify(request.draftImpact))
    && request.targets.every((target, index) => {
      const source = diff.targets[index];
      if (!source || target.ordinal !== index || source.ordinal !== index || seen.has(target.bindingId)
        || source.bindingId !== target.bindingId || source.sourcePinId !== target.sourcePinId
        || source.action !== target.action || source.decision !== target.decision
        || source.draftId !== target.draftId) return false;
      if (composition) {
        const chosen = composition.targetDecisions[index];
        if (!chosen || chosen.ordinal !== index || chosen.bindingId !== target.bindingId
          || chosen.choice !== target.decision || chosen.action !== target.action
          || chosen.targetText !== target.targetText
          || (chosen.draft?.id ?? null) !== target.draftId) return false;
      }
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
  mineOnly = false,
  detailOnly = false,
  externalView,
  onRequestsChanged,
  users = []
}: CanonicalProjectValueReviewPanelProps) {
  const canonicalRepository = repository;
  const tabsId = useId();
  const [view, setView] = useState<ReviewView>(externalView ?? "pending");
  const [requests, setRequests] = useState<readonly CanonicalRequest[]>([]);
  const [batchRequests, setBatchRequests] = useState<readonly BatchRequest[]>([]);
  const [batchRequest, setBatchRequest] = useState<BatchRequest | null>(null);
  const [batchDetailLoadedId, setBatchDetailLoadedId] = useState<string | null>(null);
  const [batchSelected, setBatchSelected] = useState(false);
  const [batchRefresh, setBatchRefresh] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectRequestId, setRejectRequestId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SourceDiff | null>(null);
  const [sourceDiffState, setSourceDiffState] = useState<SourceDiffState>("idle");
  const [sourceDiffError, setSourceDiffError] = useState<string | null>(null);
  const [conflictDecision, setConflictDecision] = useState<ConflictDecision | null>(null);
  const [conflictDecisionState, setConflictDecisionState] = useState<"idle" | "loading" | "ordinary" | "ready" | "error">("idle");
  const [conflictDecisionError, setConflictDecisionError] = useState<string | null>(null);
  const [staleRequestId, setStaleRequestId] = useState<string | null>(null);
  const deepLinkRequestRef = useRef<string | null>(initialRequestId ?? null);
  const mountedRef = useRef(false);
  const scopeRef = useRef({ projectId, currentUserId });
  scopeRef.current = { projectId, currentUserId };
  const isCurrentScope = () => mountedRef.current && scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const userName = (id: string | null | undefined) => users.find((user) => user.id === id)?.name ?? id ?? "未指派";
  const selected = batchSelected ? null : requests.find((request) => request.id === selectedId) ?? null;
  const selectedRequestId = selected?.id ?? null;
  const effectiveSelectedId = batchSelected ? batchRequest?.id ?? null : selected?.id ?? null;
  useEffect(() => {
    setRejectRequestId(null);
    setRejectReason("");
  }, [effectiveSelectedId, projectId, currentUserId, view]);
  const canReviewSelected = Boolean(
    !mineOnly && canReview && currentUserId && selected && selected.submitterUserId !== currentUserId
      && (conflictDecisionState === "ordinary" || (conflictDecisionState === "ready"
        && selected.assignedToUserId === currentUserId))
  );

  useEffect(() => {
    setBusy(false);
  }, [projectId, currentUserId]);

  useEffect(() => {
    if (externalView) {
      deepLinkRequestRef.current = initialRequestId ?? null;
      setView(externalView);
    }
  }, [externalView, initialRequestId]);

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
    const deepLinkRequestId = deepLinkRequestRef.current ?? (detailOnly ? initialRequestId ?? null : null);
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
            setBatchDetailLoadedId(null);
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
          setBatchDetailLoadedId(null);
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
  }, [batchRefresh, canReview, canonicalRepository, currentUserId, detailOnly, initialRequestId, mineOnly, projectId, view]);

  useEffect(() => {
    if (!batchSelected || !batchRequest || batchDetailLoadedId === batchRequest.id) return;
    const read = canonicalRepository?.getProjectValueBatchChangeRequest;
    if (!read) return;
    let cancelled = false;
    const requestId = batchRequest.id;
    void read(projectId, requestId).then(({ item }) => {
      if (cancelled) return;
      if (item.id !== requestId || item.projectId !== projectId
        || (mineOnly && item.submitterUserId !== currentUserId)) {
        throw new Error("请求详情与本人提交身份不一致，已阻止显示固定源差异。");
      }
      setBatchRequest(item);
      setBatchDetailLoadedId(requestId);
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载批量请求详情失败，已阻止审核。"));
    });
    return () => { cancelled = true; };
  }, [batchSelected, batchRequest, batchDetailLoadedId, canonicalRepository, currentUserId, mineOnly, projectId]);

  useEffect(() => {
    const requestId = effectiveSelectedId;
    const loadSourceDiff = canonicalRepository?.getProjectValueChangeSourceDiff;
    setSourceDiff(null);
    setSourceDiffError(null);
    if (!requestId || (batchSelected && batchDetailLoadedId !== requestId)) {
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
  }, [canonicalRepository, projectId, effectiveSelectedId, batchSelected, batchDetailLoadedId, batchRefresh]);

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
      setConflictDecisionState(item ? "ready" : "ordinary");
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
      onRequestsChanged?.();
      if (conflictDecisionState === "ready" || detailOnly) {
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
  const reviewSelected = async (decision: "approve" | "reject", note = "") => {
    if (!selected || busy || view !== "pending" || !canReviewSelected || !reviewProjectValueChangeRequest) return;
    if (decision === "approve" && !sourceDiffReadyForSelected) return;
    if (decision === "reject" && !note.trim()) return;
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
        { decision, ...(decision === "reject" ? { note: note.trim() } : {}) },
        { catalogReleaseId, idempotencyKey: idempotencyKey() }
      );
      if (!isCurrentScope()) return;
      setRejectRequestId(null);
      onRequestsChanged?.();
      if (conflictDecisionState === "ready" || detailOnly) {
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
  const reviewBatch = async (decision: "approve" | "reject", note = "") => {
    if (!batchRequest || (decision === "approve" && !batchProofReady) || !canReviewBatch || busy || batchRequest.status !== "pending"
      || !reviewProjectValueChangeRequest || !canonicalRepository.getProjectValueBatchChangeRequest) return;
    if (decision === "reject" && !note.trim()) return;
    setBusy(true);
    setError(null);
    const requestId = batchRequest.id;
    try {
      const catalog = await canonicalRepository.getCatalog();
      if (!isCurrentScope()) return;
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止审核。");
      await reviewProjectValueChangeRequest(projectId, requestId,
        { decision, ...(decision === "reject" ? { note: note.trim() } : {}), batchProofDigest: batchRequest.batchProofDigest,
          ...(batchRequest.draftImpactDigest ? { draftImpactDigest: batchRequest.draftImpactDigest } : {}),
          ...(batchRequest.decisionProofDigest ? { decisionProofDigest: batchRequest.decisionProofDigest } : {}) },
        { catalogReleaseId, idempotencyKey: idempotencyKey() });
      if (!isCurrentScope()) return;
      const refreshed = (await canonicalRepository.getProjectValueBatchChangeRequest(projectId, requestId)).item;
      if (!isCurrentScope()) return;
      if (refreshed.id !== requestId || refreshed.projectId !== projectId
        || refreshed.status !== (decision === "approve" ? "approved" : "rejected")
        || refreshed.batchProofDigest !== batchRequest.batchProofDigest
        || refreshed.targets.length !== batchRequest.targets.length
        || refreshed.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== batchRequest.targets[index].bindingId
          || (decision === "approve" && (!target.appliedValueId
            || !target.appliedHistoryEventId || !target.appliedSourcePinId || !target.appliedFileVersionId)))) {
        throw new Error("批量审核结果不完整，已停止展示成功状态。");
      }
      setBatchRequest(refreshed);
      setRejectRequestId(null);
      onRequestsChanged?.();
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
        if (latest.id !== requestId || latest.projectId !== projectId) return;
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
      onRequestsChanged?.();
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
      {!detailOnly ? <header>
        <h2>{mineOnly ? "我的参数提交" : "软件配置审核"}</h2>
        <p>{mineOnly ? "追踪本人提交的新版参数请求及其固定来源差异。" : "核对提交时固定的源文件差异，批准后同步更新参数值与源文件。"}</p>
        <ViewSwitch variant="tabs" ariaLabel={mineOnly ? "我的参数提交视角" : "软件配置审核视角"} value={view}
          onValueChange={(value) => {
            if (batchSelected) deepLinkRequestRef.current = batchRequest?.id ?? null;
            setView(value as ReviewView);
          }} items={[
            { value: "pending", label: "待审核", id: `${tabsId}-pending-tab`, panelId: `${tabsId}-pending-panel`, disabled: busy },
            { value: "history", label: "历史", id: `${tabsId}-history-tab`, panelId: `${tabsId}-history-panel`, disabled: busy }
          ]} />
      </header> : null}
      <TabPanel role={detailOnly ? undefined : "tabpanel"} id={detailOnly ? undefined : `${tabsId}-${view}-panel`} aria-labelledby={detailOnly ? undefined : `${tabsId}-${view}-tab`}>
      {error ? <p role="alert">{error}</p> : null}
      {staleRequestId ? (
        <p role="alert">请求「{staleRequestId}」已失效、已归档或不属于当前项目，未自动切换到其他请求。</p>
      ) : null}
      {loading ? <p role="status">正在加载源文件审核请求…</p> : null}
      {!detailOnly && !loading && !error && !staleRequestId && requests.length === 0 && batchRequests.length === 0 && !batchRequest ? <p role="status">当前没有{mineOnly ? "你的" : view === "pending" ? "待审核" : "历史"}源文件请求。</p> : null}
      {requests.length > 0 || batchRequests.length > 0 || batchRequest ? (
        <div className="canonical-project-value-review__content">
          {!detailOnly ? <div className="table-wrap">
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
                        setBatchDetailLoadedId(null);
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
          </div> : null}
          {selected ? (
            <article aria-label="源文件请求详情">
              <header className="review-inspector__header">
                <p className="review-inspector__eyebrow">软件配置 · {selected.sourceFormat.toUpperCase()}</p>
                <div className="review-inspector__title">
                  <h3>{selected.reason}</h3><Badge variant="secondary">{canonicalStatusLabels[selected.status]}</Badge>
                </div>
                <dl className="review-inspector__meta">
                  <div><dt>提交人</dt><dd>{userName(selected.submitterUserId)}</dd></div>
                  <div><dt>指定审核人</dt><dd>{userName(selected.assignedToUserId)}</dd></div>
                  <div><dt>提交时间</dt><dd><time dateTime={selected.createdAt} title={formatAbsolute(selected.createdAt)}>{formatRelativeOrAbsolute(selected.createdAt)}</time></dd></div>
                  {selected.reviewerUserId ? <div><dt>实际审核人</dt><dd>{userName(selected.reviewerUserId)}</dd></div> : null}
                </dl>
                {selected.reviewerNote ? <p>{selected.reviewerNote}</p> : null}
                <div className="review-inspector__actions">
                  {view === "pending" && selected.status === "pending" && canReviewSelected ? (
                    <>
                      <button type="button" className="button primary" disabled={busy || !sourceDiffReadyForSelected}
                        onClick={() => void reviewSelected("approve")}>批准软件配置</button>
                      <button type="button" className="button subtle" disabled={busy} onClick={() => setRejectRequestId(selected.id)}>驳回</button>
                    </>
                  ) : view === "pending" && selected.status === "pending" ? (
                    <p role="note">{selected.submitterUserId === currentUserId
                      ? "不能审核自己的提交；请由其他合格审核员处理。"
                      : "当前账号不是该项目的软件审核员；审核操作由服务端拒绝。"}</p>
                  ) : null}
                  {view === "pending" && selected.status === "pending" && selected.submitterUserId === currentUserId
                    && canonicalRepository.withdrawProjectValueChangeRequest ? (
                      <button type="button" className="button subtle" disabled={busy} onClick={() => void withdrawSelected()}>撤回我的提交</button>
                    ) : null}
                </div>
              </header>
              <dl aria-label="请求标识与更新时间">
                <div><dt>参数记录</dt><dd><code>{selected.bindingId}</code></dd></div>
                <div><dt>请求 ID</dt><dd><code>{selected.id}</code></dd></div>
                <div><dt>来源快照</dt><dd><code>{selected.sourcePinId ?? "—"}</code></dd></div>
                <div><dt>候选文件</dt><dd><code>{selected.candidateId ?? "—"}</code></dd></div>
                <div><dt>状态更新时间</dt><dd><time dateTime={selected.updatedAt} title={formatAbsolute(selected.updatedAt)}>{formatRelativeOrAbsolute(selected.updatedAt)}</time></dd></div>
              </dl>
              <section aria-label="变更摘要"><h4>变更摘要</h4>
                <p>{singleDiff?.sourceName ?? selected.sourceFormat.toUpperCase()}：<span>{selected.action === "delete" && selected.status === "pending"
                  ? "删除属性（批准后生效）" : canonicalRequestActionLabel(selected)}</span></p>
                <pre aria-label="固定源目标内容">{canonicalRequestSourceText(selected)}</pre>
              </section>
              <section aria-label="前后对比"><h4>前后对比</h4>
              <p role="note">以下差异固定于提交时，不随当前文件变化。</p>
              {sourceDiffState === "loading" ? <p role="status">正在加载固定源差异…</p> : null}
              {sourceDiffError ? <p role="alert">{sourceDiffError}</p> : null}
              {singleDiff ? (
                <section aria-label="固定源差异" className="canonical-project-value-review__diff">

                  <div>
                    <p>变更前</p>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更前"
                      className="canonical-project-value-review__diff-text"
                    >{singleDiff.before}</pre>
                  </div>
                  <div>
                    <p>变更后</p>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更后"
                      className="canonical-project-value-review__diff-text"
                    >{singleDiff.after}</pre>
                  </div>
                </section>
              ) : null}
              </section>
              <section aria-label="影响范围"><h4>影响范围</h4>
                <p>{singleDiff?.sourceName ?? "固定来源"} · 受影响绑定 {singleDiff?.bindings.length ?? "待核对"} 项</p>
                {singleDiff ? <ol aria-label="受影响绑定">{singleDiff.bindings.map((binding, index) =>
                  <li key={binding.bindingId}>Binding {index + 1} · {JSON.stringify(binding.locator)}</li>)}</ol> : null}
                <p>应用结果：{selected.applyOutcome === "committed" ? "已应用" : selected.applyOutcome === "replayed" ? "已应用（幂等重放）" : "—"}</p>
              {conflictDecisionState === "loading" ? <p role="status">正在核对冲突决策详情…</p> : null}
              {conflictDecisionError ? <p role="alert">{conflictDecisionError}</p> : null}
              {conflictDecisionState !== "ordinary" ? <button type="button" className="button subtle"
                disabled={busy} onClick={() => {
                  deepLinkRequestRef.current = selected.id;
                  setBatchRefresh((value) => value + 1);
                }}>刷新冲突请求与来源</button> : null}
              {conflictDecisionState === "ready" && conflictDecision ? (
                <section aria-label="冻结的单项来源冲突决策">
                  <h5>单项来源冲突决策</h5>
                  <p><span>{conflictDecision.choice === "file" ? "文件值" : "界面草稿值"}</span> · {conflictDecision.sourceDiff.format.toUpperCase()}</p>
                  {matchesFrozenConflict(selected, sourceDiff, conflictDecision) ? <>
                    <p>经验证的冻结来源差异</p>
                    <pre tabIndex={0} aria-label="冲突来源变更前">{conflictDecision.sourceDiff.before}</pre>
                    <pre tabIndex={0} aria-label="冲突来源变更后">{conflictDecision.sourceDiff.after}</pre>
                  </> : <p role="alert">冲突详情、目标、顺序或证明与请求来源不符，已阻止批准。</p>}
                </section>
              ) : null}
              </section>
              <ReviewProvenance key={selected.id} entries={[
                { label: "请求 ID", value: selected.id },
                ...Object.entries(selected).filter(([key]) => !["id", "reason", "status", "reviewerNote", "targetValue", "sourceTarget"].includes(key))
                  .map(([label, value]) => ({ label, value })),
                { label: "固定来源元数据", value: singleDiff && Object.fromEntries(Object.entries(singleDiff).filter(([key]) => !["before", "after"].includes(key))) },
                { label: "冲突决策证明", value: conflictDecision }
              ]} />
            </article>
          ) : null}
          {batchSelected && batchRequest ? (
            <article aria-label="批量源文件请求详情">
              <header className="review-inspector__header">
                <p className="review-inspector__eyebrow">软件配置 · 批量来源变更 · <span>{batchDiff?.format.toUpperCase()}</span></p>
                <div className="review-inspector__title">
                  <h3>{batchRequest.reason}</h3><Badge variant="secondary">{canonicalStatusLabels[batchRequest.status]}</Badge>
                </div>
                <dl className="review-inspector__meta">
                  <div><dt>提交人</dt><dd>{userName(batchRequest.submitterUserId)}</dd></div>
                  <div><dt>指定审核人</dt><dd>{userName(batchRequest.assignedToUserId)}</dd></div>
                  <div><dt>提交时间</dt><dd>{batchRequest.createdAt ? <time dateTime={batchRequest.createdAt} title={formatAbsolute(batchRequest.createdAt)}>
                    {formatRelativeOrAbsolute(batchRequest.createdAt)}
                  </time> : "提交时间未记录"}</dd></div>
                  {batchRequest.reviewerUserId ? <div><dt>实际审核人</dt><dd>{userName(batchRequest.reviewerUserId)}</dd></div> : null}
                </dl>
                {batchRequest.reviewerNote ? <p>{batchRequest.reviewerNote}</p> : null}
                <div className="review-inspector__actions">
                  {batchRequest.status === "pending" && canReviewBatch ? (
                    <>
                      <p role="note">批准时服务端会重新核对当前来源，并将全部目标作为一次事务提交。</p>
                      <button type="button" className="button primary" disabled={busy || !batchProofReady}
                        onClick={() => void reviewBatch("approve")}>批准全部 {batchRequest.targets.length} 项</button>
                      <button type="button" className="button subtle" disabled={busy}
                        onClick={() => setRejectRequestId(batchRequest.id)}>驳回全部 {batchRequest.targets.length} 项</button>
                    </>
                  ) : batchRequest.status === "pending" ? (
                    <p role="note">{batchRequest.submitterUserId === currentUserId
                      ? "不能审核自己的提交；请由其他合格审核员处理。"
                      : "当前账号不是此请求的被指派审核人；审核操作由服务端拒绝。"}</p>
                  ) : null}
                  {batchRequest.status === "pending" && batchRequest.submitterUserId === currentUserId
                    && canonicalRepository.withdrawProjectValueChangeRequest ? (
                      <button type="button" className="button subtle" disabled={busy} onClick={() => void withdrawBatch()}>撤回我的批量提交</button>
                    ) : null}
                </div>
              </header>
              <section aria-label="变更摘要"><h4>变更摘要</h4>
                <p>将 {batchDiff?.sourceName ?? "固定来源"} 的 {batchRequest.targets.length} 项变更作为一次事务提交，核对完整 {batchRequest.cohortCount} 项 Binding 来源。</p>
              </section>
              {sourceDiffState === "loading" ? <p role="status">正在加载全部目标的固定源差异…</p> : null}
              {mineOnly ? <p role="note">这里显示本人提交时冻结的目标与源差异；审核仍由被指派审核人处理。</p> : null}
              {sourceDiffError ? <p role="alert">{sourceDiffError}</p> : null}
              <button type="button" className="button subtle" disabled={busy} onClick={() => {
                deepLinkRequestRef.current = batchRequest.id;
                setBatchRefresh((value) => value + 1);
              }}>刷新批量请求与来源</button>
              {sourceDiffState === "ready" && !batchProofReady ? (
                <p role="alert">批量请求与来源差异的目标、顺序或证明不一致，已阻止批准。</p>
              ) : null}
              <section aria-label="前后对比"><h4>前后对比</h4>
                <p role="note">以下差异固定于提交时，不随当前文件变化。</p>
              {batchProofReady && batchDiff ? (
                <section aria-label="批量固定源差异" className="canonical-project-value-review__diff">

                  <div><p>变更前</p><pre tabIndex={0} aria-label="批量固定源变更前" className="canonical-project-value-review__diff-text">{batchDiff.before}</pre></div>
                  {batchDiff.uploadAfter ? <div><p>原上传候选</p><pre tabIndex={0} aria-label="批量原上传来源" className="canonical-project-value-review__diff-text">{batchDiff.uploadAfter}</pre></div> : null}
                  <div><p>变更后</p><pre tabIndex={0} aria-label="批量固定源变更后" className="canonical-project-value-review__diff-text">{batchDiff.after}</pre></div>
                </section>
              ) : null}
              </section>
              <section aria-label="影响范围"><h4>影响范围</h4>
              <ol aria-label="批量审核目标">
                {batchRequest.targets.map((target, index) => {
                  const source = batchProofReady ? batchDiff!.targets[index] : null;
                  return (
                    <li key={`${target.ordinal}:${target.bindingId}`}>
                      <h5>目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"}</h5>
                      <dl>
                        <div><dt>最终选择</dt><dd>{target.decision === "draft" ? "界面草稿值" : target.decision === "file" ? "文件值" : "未验证的草稿"}</dd></div>
                        {target.draftId ? <div><dt>选中草稿</dt><dd>作者 <span>{userName(batchRequest.draftImpact?.find((entry) =>
                          entry.bindingId === target.bindingId)?.drafts.find((draft) => draft.draftId === target.draftId)?.authorUserId)}</span></dd></div> : null}
                        <div><dt>目标</dt><dd>{target.action === "delete" ? "删除（无替换值）" : <pre>{target.targetText}</pre>}</dd></div>
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
              {batchRequest.draftImpact ? <section aria-label="完整草稿影响">
                <h5>完整 cohort 与草稿预计效果</h5>
                <ol>{batchRequest.draftImpact.map((entry) => <li key={entry.bindingId}>
                  <strong>{entry.role === "sibling" ? "兄弟 Binding · 结构性 re-pin" : "变更目标"}</strong> · {entry.decision}
                  {entry.drafts.length ? <ul>{entry.drafts.map((draft) => <li key={draft.draftId}>
                    草稿 · 作者 <span>{userName(draft.authorUserId)}</span>
                    {entry.selectedDraftId === draft.draftId ? " · 本次选中" : " · 未选中，保留并预计过期"}
                    {draft.currentlyStale ? "（当前已过期）" : ""}
                    <div>动作：{draft.action === "delete" ? "删除" : "设置"}；原因：{draft.reason}；预计效果：保留并过期</div>
                    <pre>{typeof draft.targetValue === "string" ? draft.targetValue : JSON.stringify(draft.targetValue)}</pre>
                  </li>)}</ul> : " · 无竞争草稿"}
                </li>)}</ol>
              </section> : null}
              </section>
              <ReviewProvenance key={batchRequest.id} entries={[
                { label: "请求 ID", value: batchRequest.id }, { label: "批量证明摘要", value: batchRequest.batchProofDigest },
                ...Object.entries(batchRequest).filter(([key]) => !["id", "reason", "status", "reviewerNote", "batchProofDigest"].includes(key))
                  .map(([label, value]) => ({ label, value })),
                { label: "来源元数据", value: batchDiff && Object.fromEntries(Object.entries(batchDiff).filter(([key]) => !["before", "after", "uploadAfter"].includes(key))) }
              ]} />
            </article>
          ) : null}
        </div>
      ) : null}
      </TabPanel>
      <ConfirmDialog open={Boolean(rejectRequestId && rejectRequestId === effectiveSelectedId)}
        title="驳回请求" description="请说明驳回原因，方便提交人补充依据或调整变更。"
        confirmLabel="确认驳回" pending={busy} confirmDisabled={!rejectReason.trim()}
        error={error} onCancel={() => { setRejectRequestId(null); setRejectReason(""); }}
        extra={<label>驳回原因<textarea required rows={4} value={rejectReason} disabled={busy}
          onChange={(event) => setRejectReason(event.target.value)} /></label>}
        onConfirm={() => { void (batchSelected ? reviewBatch("reject", rejectReason) : reviewSelected("reject", rejectReason)); }} />
      {!detailOnly ? <div role="tabpanel" id={`${tabsId}-${view === "pending" ? "history" : "pending"}-panel`}
        aria-labelledby={`${tabsId}-${view === "pending" ? "history" : "pending"}-tab`} hidden /> : null}
    </section>
  );
}
