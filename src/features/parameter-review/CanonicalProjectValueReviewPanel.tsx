import { useEffect, useState } from "react";
import type {
  CatalogValueChangeRequestDto,
  CatalogValueChangeSourceDiffResponse
} from "@/infrastructure/http/parameterCatalogDtos";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { presentError } from "@/infrastructure/http/presentError";

type CanonicalProjectValueReviewPanelProps = {
  projectId: string;
  repository?: ParameterCatalogRepository;
  canReview?: boolean;
  currentUserId?: string;
};

type ReviewView = "pending" | "history";
type SourceDiff = CatalogValueChangeSourceDiffResponse["item"];
type SourceDiffState = "idle" | "loading" | "ready" | "error";

function requestSourceText(request: CatalogValueChangeRequestDto): string {
  return request.sourceFormat === "json" && request.sourceTarget
    ? request.sourceTarget.sourceText
    : request.targetValue;
}

function requestActionLabel(request: CatalogValueChangeRequestDto): string {
  return request.action === "delete" ? "删除属性" : "设置属性";
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
  currentUserId
}: CanonicalProjectValueReviewPanelProps) {
  const [view, setView] = useState<ReviewView>("pending");
  const [requests, setRequests] = useState<readonly CatalogValueChangeRequestDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceDiff, setSourceDiff] = useState<SourceDiff | null>(null);
  const [sourceDiffState, setSourceDiffState] = useState<SourceDiffState>("idle");
  const [sourceDiffError, setSourceDiffError] = useState<string | null>(null);
  const selected = requests.find((request) => request.id === selectedId) ?? requests[0] ?? null;
  const effectiveSelectedId = selected?.id ?? null;
  const canReviewSelected = Boolean(canReview && currentUserId && selected?.submitterUserId !== currentUserId);

  useEffect(() => {
    if (!repository?.listProjectValueChangeRequests) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void repository.listProjectValueChangeRequests(
      projectId,
      view === "pending" ? { status: "pending" } : undefined
    )
      .then((response) => {
        if (cancelled) return;
        setRequests(response.items);
        setSelectedId((current) =>
          current && response.items.some((request) => request.id === current)
            ? current
            : response.items[0]?.id ?? null
        );
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
  }, [projectId, repository, view]);

  useEffect(() => {
    const requestId = effectiveSelectedId;
    const loadSourceDiff = repository?.getProjectValueChangeSourceDiff;
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
  }, [projectId, repository, effectiveSelectedId]);

  if (!repository?.listProjectValueChangeRequests || !repository.reviewProjectValueChangeRequest) {
    return null;
  }
  const reviewProjectValueChangeRequest = repository.reviewProjectValueChangeRequest;
  const withdrawSelected = async () => {
    if (!selected || busy || selected.status !== "pending" || selected.submitterUserId !== currentUserId
      || !repository.withdrawProjectValueChangeRequest) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await repository.getCatalog();
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止撤回。");
      await repository.withdrawProjectValueChangeRequest(projectId, selected.id, {
        catalogReleaseId, idempotencyKey: idempotencyKey()
      });
      setRequests((current) => current.filter((request) => request.id !== selected.id));
      setSelectedId(null);
    } catch (withdrawError) {
      setError(presentError(withdrawError, "撤回失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };
  const reviewSelected = async (decision: "approve" | "reject") => {
    if (!selected || busy || view !== "pending" || !canReviewSelected) return;
    if (decision === "approve" && (sourceDiffState !== "ready" || sourceDiff?.requestId !== selected.id)) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await repository.getCatalog();
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 catalog release 不可用，已阻止审核。");
      await reviewProjectValueChangeRequest(
        projectId,
        selected.id,
        { decision },
        { catalogReleaseId, idempotencyKey: idempotencyKey() }
      );
      setRequests((current) => current.filter((request) => request.id !== selected.id));
      setSelectedId(null);
    } catch (reviewError) {
      setError(presentError(reviewError, "软件审核失败，请稍后重试。"));
    } finally {
      setBusy(false);
    }
  };
  const sourceDiffReadyForSelected = Boolean(
    selected && sourceDiffState === "ready" && sourceDiff?.requestId === selected.id
  );

  return (
    <section className="canonical-project-value-review" aria-label="软件配置审核">
      <header>
        <h2>软件配置审核</h2>
        <p>核对提交时固定的源文件差异，批准后同步更新参数值与源文件。</p>
        <div role="tablist" aria-label="软件配置审核视角">
          <button className="button subtle" type="button" role="tab" aria-selected={view === "pending"} onClick={() => setView("pending")}>
            待审核
          </button>
          <button className="button subtle" type="button" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>
            历史
          </button>
        </div>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {loading ? <p role="status">正在加载源文件审核请求…</p> : null}
      {!loading && requests.length === 0 ? <p role="status">当前没有{view === "pending" ? "待审核" : "历史"}源文件请求。</p> : null}
      {requests.length > 0 ? (
        <div className="canonical-project-value-review__content">
          <div className="table-wrap">
            <table aria-label="软件配置审核请求">
              <thead>
                <tr><th>绑定</th><th>格式</th><th>动作</th><th>状态</th><th>原因</th></tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <button type="button" className="button subtle" onClick={() => setSelectedId(request.id)}>
                        查看请求
                      </button>
                    </td>
                    <td>{request.sourceFormat.toUpperCase()}</td>
                    <td>{requestActionLabel(request)}</td>
                    <td>{{ pending: "待审核",approved: "已批准",rejected: "已驳回",withdrawn: "已撤回" }[request.status]}</td>
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
                  ? "删除属性（批准后生效）" : requestActionLabel(selected)}</dd></div>
                <div><dt>修改原因</dt><dd>{selected.reason}</dd></div>
              </dl>
              <pre aria-label="固定源目标内容">{requestSourceText(selected)}</pre>
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
                && repository.withdrawProjectValueChangeRequest ? (
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
