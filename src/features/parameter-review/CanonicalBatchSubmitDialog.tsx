import { useEffect, useMemo, useState } from "react";
import type { ParameterFileCandidate, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";

export function CanonicalBatchSubmitDialog({ projectId, currentUserId, candidate, preview, repository,
  onDismiss, onSubmitted, governanceClient }: {
  projectId: string;
  currentUserId: string;
  candidate: ParameterFileCandidate;
  preview: ParameterFileSourcePreview;
  repository?: ParameterCatalogRepository;
  onDismiss: () => void;
  onSubmitted: (requestId: string) => void;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bindings = preview.bindings ?? [];
  const ready = candidate.status === "ready" && preview.kind === "canonical"
    && preview.candidateId === candidate.id && preview.format.toLowerCase() === "json"
    && Boolean(preview.proofToken) && bindings.length >= 2 && !preview.request
    && new Set(bindings.map((binding) => binding.bindingId)).size === bindings.length
    && bindings.every((binding) => binding.bindingId && binding.sourcePinId
      && (binding.action === "delete" || binding.afterText !== undefined));

  useEffect(() => {
    let cancelled = false;
    void client.getProjectWorkflowRoleBindings(projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载项目软件审核人失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, currentUserId, projectId]);

  const submit = async () => {
    if (!ready || busy || loading || !reviewerId || !reason.trim()
      || !repository?.submitProjectValueBatchChangeRequest) return;
    setBusy(true);
    setError(null);
    try {
      const catalog = await repository.getCatalog();
      const catalogReleaseId = catalog.item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 Catalog release 不可用，已阻止提交。");
      const { item } = await repository.submitProjectValueBatchChangeRequest(projectId, {
        candidateId: candidate.id, expectedProofToken: preview.proofToken!,
        reason: reason.trim(), assignedToUserId: reviewerId
      }, { catalogReleaseId, idempotencyKey: crypto.randomUUID() });
      if (item.status !== "pending" || item.candidateId !== candidate.id
        || item.assignedToUserId !== reviewerId || item.submitterUserId !== currentUserId
        || !/^[0-9a-f]{64}$/.test(item.batchProofDigest)
        || item.cohortCount !== bindings.length || item.targets.length !== bindings.length
        || item.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== bindings[index].bindingId || target.action !== bindings[index].action
          || target.sourcePinId !== bindings[index].sourcePinId
          || target.targetText !== (bindings[index].action === "delete" ? null : bindings[index].afterText))) {
        throw new Error("服务端冻结目标、顺序或证明与预览不一致；请从提交记录刷新核对。");
      }
      onSubmitted(item.id);
    } catch (cause) {
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新候选来源后重试。")}`
        : presentError(cause, "提交 JSON 批量审核失败。"));
    } finally { setBusy(false); }
  };

  return <ModalDialog open className="submission-dialog canonical-batch-submit-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>提交 JSON 批量来源审核</h2>
      <p id={descriptionId}>候选「{candidate.fileName}」的完整有序目标。提交后服务端冻结 batchProofDigest；另一名被指派人只审核一次，批准后全部目标在一次事务中应用。</p>
      <p>候选 ID：<code>{candidate.id}</code>；预览证明：<code>{preview.proofToken ?? "缺失"}</code></p>
      <ol className="canonical-batch-submit-dialog__targets" aria-label="提交前批量目标">{bindings.map((binding, index) => <li key={binding.bindingId}>
        <strong>目标 {index + 1}：{binding.action === "delete" ? "删除" : "设置"}</strong>
        <div>Binding <code>{binding.bindingId}</code> · 来源 pin <code>{binding.sourcePinId}</code> · 路径 <code>{binding.locator}</code></div>
        <div>基线 <code>{binding.beforeText}</code> → {binding.action === "delete" ? "删除（无替换值）" : <code>{binding.afterText}</code>}</div>
      </li>)}</ol>
      <label>修改原因<textarea value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy} /></label>
      <label>指定软件审核人<select value={reviewerId} disabled={busy || loading}
        onChange={(event) => setReviewerId(event.target.value)}>
        {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
          : <option value="">没有可用的另一名软件审核人</option>}
      </select></label>
      {loading ? <p role="status">正在加载可指派审核人…</p> : null}
      {!ready || !repository?.submitProjectValueBatchChangeRequest ? <p role="alert">批量来源证明或提交接口不可用，已阻止提交。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onDismiss}>取消</button>
        <button type="button" disabled={busy || loading || !ready || !reviewerId || !reason.trim()
          || !repository?.submitProjectValueBatchChangeRequest} onClick={() => void submit()}>
          {busy ? "提交中…" : `一次提交全部 ${bindings.length} 项`}
        </button></div>
    </>}
  </ModalDialog>;
}
