import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterFileRepository, SourceRevisionRequest } from "@/application/ports/ParameterFileRepository";
import { Button } from "@/components/ui/button";
import { SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { ReviewSourceDiff } from "./ReviewSourceDiff";
import { canonicalStatusLabels } from "./canonicalSubmissionTracking";
import { presentError } from "@/infrastructure/http/presentError";

export function SourceRevisionReviewPanel({ projectId, requestId, repository, currentUserId, canReview,
  refreshVersion, onRequestsChanged, onBusyChange }: {
  projectId: string; requestId: string; repository: ParameterFileRepository;
  currentUserId: string; canReview: boolean; refreshVersion: number;
  onRequestsChanged: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [retry, setRetry] = useState(0);
  const scope = useMemo(() => ({ projectId, requestId, repository, refreshVersion, retry }), [projectId, requestId, repository, refreshVersion, retry]);
  const [loaded, setLoaded] = useState<{ scope: typeof scope; request: SourceRevisionRequest | null; error: string } | null>(null);
  const [operation, setOperation] = useState<{ scope: typeof scope; busy: boolean; error: string } | null>(null);
  const [noteState, setNote] = useState<{ scope: typeof scope; text: string } | null>(null);
  const request = loaded?.scope === scope ? loaded.request : null;
  const loading = loaded?.scope !== scope;
  const error = operation?.scope === scope && operation.error ? operation.error : loaded?.scope === scope ? loaded.error : "";
  const busy = operation?.scope === scope && operation.busy;
  const note = noteState?.scope === scope ? noteState.text : "";
  const epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    onBusyChange(false);
    void Promise.resolve().then(() => {
      if (!repository.getSourceRevisionRequest) throw new Error("来源审核读取暂不可用。");
      return repository.getSourceRevisionRequest(projectId, requestId);
    }).then((result) => {
      if (epoch.current === generation) setLoaded({ scope, request: result, error: "" });
    }).catch((cause) => { if (epoch.current === generation) setLoaded({ scope, request: null, error: presentError(cause, "读取 DTS 审核失败。") }); });
    return () => { epoch.current += 1; onBusyChange(false); };
  }, [onBusyChange, projectId, repository, requestId, scope]);

  const decide = async (decision: "approve" | "reject" | "withdraw") => {
    if (!request || busy) return;
    const generation = epoch.current;
    setOperation({ scope, busy: true, error: "" }); onBusyChange(true);
    try {
      const result = decision === "withdraw"
        ? await repository.withdrawSourceRevisionRequest?.(projectId, request.id)
        : await repository.reviewSourceRevisionRequest?.(projectId, request.id, { decision, proofDigest: request.proofDigest, note: note.trim() || undefined });
      if (!result) throw new Error("DTS 审核操作暂不可用。");
      if (epoch.current === generation) {
        setLoaded({ scope, error: "", request: { ...result,
          ...(request.id === result.id && request.proofDigest === result.proofDigest
            ? { before: request.before, after: request.after } : {}) } });
        setOperation({ scope, busy: false, error: "" });
        onRequestsChanged();
      }
    } catch (cause) { if (epoch.current === generation) setOperation({ scope, busy: false, error: presentError(cause, "DTS 审核操作失败，请核对状态后重试。") }); }
    finally { if (epoch.current === generation) onBusyChange(false); }
  };
  if (loading) return <SectionSkeleton label="正在读取 DTS 来源审核…" />;
  if (!request) return <SectionError message={error || "无法读取该来源审核。"} onRetry={() => setRetry((value) => value + 1)} />;
  const pending = request.status === "pending";
  const reviewer = canReview && request.assignedToUserId === currentUserId && request.submitterUserId !== currentUserId;
  const hasSource = request.before !== undefined && request.after !== undefined;
  return <section className="review-inspector" aria-label="DTS 整文件审核" aria-busy={busy}>
    <header><h2>{request.fileName}</h2><p>{canonicalStatusLabels[request.status]} · DTS 来源修改</p></header>
    <p>{request.reason}</p>
    <p>{request.impact.parameterChanges} 项参数变化 · 新增 {request.impact.nodeAdditions} 个节点 · 删除 {request.impact.nodeRemovals} 个节点</p>
    {request.applicationMode === "administrator_direct" ? <>
      <p>管理员本人直接应用 · 未经过独立审核</p><p>操作人：{request.submitterName ?? "管理员"}</p>
    </> : <p>提交人：{request.submitterName ?? "项目成员"} · 审核人：{request.assignedToName ?? "指定软件审核人"}</p>}
    {hasSource ? <ReviewSourceDiff before={request.before!} after={request.after!} label="DTS 来源" virtualized /> : <p role="alert">固定来源差异不可用，不能批准。</p>}
    {error ? <p role="alert">{error}</p> : null}
    {pending && reviewer ? <label>审核说明<textarea aria-label="DTS 审核说明" value={note} maxLength={2000} rows={3} disabled={busy} onChange={(event) => setNote({ scope, text: event.target.value })} /></label> : null}
    {request.reviewerNote ? <p>审核说明：{request.reviewerNote}</p> : null}
    <footer className="dialog-actions">
      {pending && request.submitterUserId === currentUserId ? <Button variant="outline" disabled={busy} onClick={() => void decide("withdraw")}>撤回审核</Button> : null}
      {pending && reviewer ? <><Button variant="outline" disabled={busy} onClick={() => void decide("reject")}>驳回</Button>
        <Button disabled={busy || !hasSource} onClick={() => void decide("approve")}>{busy ? "处理中…" : "批准并应用 DTS"}</Button></> : null}
      <Button variant="ghost" disabled={busy} onClick={() => setRetry((value) => value + 1)}>刷新状态</Button>
    </footer>
  </section>;
}
