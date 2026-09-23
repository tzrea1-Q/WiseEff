import { useEffect, useRef, useState } from "react";
import type { CatalogValueChangeSourceDiffResponse } from "@/infrastructure/http/parameterCatalogDtos";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
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
type SourceDiffState = "idle" | "loading" | "ready" | "error";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SourceDiff | null>(null);
  const [sourceDiffState, setSourceDiffState] = useState<SourceDiffState>("idle");
  const [sourceDiffError, setSourceDiffError] = useState<string | null>(null);
  const [staleRequestId, setStaleRequestId] = useState<string | null>(null);
  const deepLinkRequestRef = useRef<string | null>(initialRequestId ?? null);
  const scopeRef = useRef({ projectId, currentUserId });
  scopeRef.current = { projectId, currentUserId };
  const isCurrentScope = () => scopeRef.current.projectId === projectId && scopeRef.current.currentUserId === currentUserId;
  const selected = requests.find((request) => request.id === selectedId) ?? null;
  const effectiveSelectedId = selected?.id ?? null;
  const canReviewSelected = Boolean(
    !mineOnly && canReview && currentUserId && selected && selected.submitterUserId !== currentUserId
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
      .then((response) => {
        if (cancelled) return;
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
  }, [canonicalRepository, currentUserId, initialRequestId, mineOnly, projectId, view]);

  useEffect(() => {
    const requestId = effectiveSelectedId;
    const loadSourceDiff = canonicalRepository?.getProjectValueChangeSourceDiff;
    setSourceDiff(null);
    setSourceDiffError(null);
    if (!requestId) {
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
  }, [canonicalRepository, projectId, effectiveSelectedId]);

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
    if (decision === "approve" && (sourceDiffState !== "ready" || sourceDiff?.requestId !== selected.id)) return;
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
      const next = requests.filter((request) => request.id !== selected.id);
      const nextId = next[0]?.id ?? null;
      setRequests(next);
      setSelectedId(nextId);
      onSelectRequest?.(nextId);
    } catch (reviewError) {
      if (isCurrentScope()) setError(presentError(reviewError, "软件审核失败，请稍后重试。"));
    } finally {
      if (isCurrentScope()) setBusy(false);
    }
  };
  const sourceDiffReadyForSelected = Boolean(
    selected && sourceDiffState === "ready" && sourceDiff?.requestId === selected.id
  );

  return (
    <section className="canonical-project-value-review" aria-label={mineOnly ? "我的参数提交" : "软件配置审核"}>
      <header>
        <h2>{mineOnly ? "我的参数提交" : "软件配置审核"}</h2>
        <p>{mineOnly ? "追踪本人提交的新版参数请求及其固定来源差异。" : "核对提交时固定的源文件差异，批准后同步更新参数值与源文件。"}</p>
        <div role="tablist" aria-label={mineOnly ? "我的参数提交视角" : "软件配置审核视角"}>
          <button className="button subtle" type="button" role="tab" disabled={busy} aria-selected={view === "pending"} onClick={() => setView("pending")}>
            待审核
          </button>
          <button className="button subtle" type="button" role="tab" disabled={busy} aria-selected={view === "history"} onClick={() => setView("history")}>
            历史
          </button>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {staleRequestId ? (
        <p role="alert">请求「{staleRequestId}」已失效、已归档或不属于当前项目，未自动切换到其他请求。</p>
      ) : null}
      {loading ? <p role="status">正在加载源文件审核请求…</p> : null}
      {!loading && !error && !staleRequestId && requests.length === 0 ? <p role="status">当前没有{mineOnly ? "你的" : view === "pending" ? "待审核" : "历史"}源文件请求。</p> : null}
      {requests.length > 0 ? (
        <div className="canonical-project-value-review__content">
          <div className="table-wrap">
            <table aria-label={mineOnly ? "我的参数提交请求" : "软件配置审核请求"}>
              <thead>
                <tr><th>绑定</th><th>格式</th><th>动作</th><th>状态</th><th>原因</th></tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        aria-current={request.id === selectedId ? "true" : undefined}
                        className="button subtle"
                        onClick={() => {
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
              <p role="note">以下差异固定于提交时，不随当前文件变化。</p>
              {sourceDiffState === "loading" ? <p role="status">正在加载固定源差异…</p> : null}
              {sourceDiffError ? <p role="alert">{sourceDiffError}</p> : null}
              {sourceDiff ? (
                <section aria-label="固定源差异" className="canonical-project-value-review__diff">
                  <dl>
                    <div><dt>源文件</dt><dd><code>{sourceDiff.sourceName}</code></dd></div>
                    <div><dt>格式</dt><dd>{sourceDiff.format.toUpperCase()}</dd></div>
                    <div><dt>受影响绑定</dt><dd>{sourceDiff.bindings.length}</dd></div>
                    <div><dt>原文件校验摘要</dt><dd><code>{sourceDiff.baseDigest}</code></dd></div>
                    <div><dt>候选校验摘要</dt><dd><code>{sourceDiff.proposedDigest}</code></dd></div>
                    <div><dt>差异校验摘要</dt><dd><code>{sourceDiff.diffDigest}</code></dd></div>
                  </dl>
                  <div>
                    <h4>变更前</h4>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更前"
                      className="canonical-project-value-review__diff-text"
                    >{sourceDiff.before}</pre>
                  </div>
                  <div>
                    <h4>变更后</h4>
                    <pre
                      tabIndex={0}
                      aria-label="固定源变更后"
                      className="canonical-project-value-review__diff-text"
                    >{sourceDiff.after}</pre>
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
        </div>
      ) : null}
    </section>
  );
}
