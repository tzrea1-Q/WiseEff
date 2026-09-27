import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterFileCandidate, ParameterFileRepository, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { candidateReceiptMessage, permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { createCanonicalConflictClient, type CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";

export function CanonicalBatchSubmitDialog({ projectId, currentUserId, candidate, preview, repository,
  fileRepository, conflictClient, onDismiss, onSubmitted, governanceClient }: {
  projectId: string;
  currentUserId: string;
  candidate: ParameterFileCandidate;
  preview: ParameterFileSourcePreview;
  repository?: ParameterCatalogRepository;
  fileRepository?: Pick<ParameterFileRepository, "getCandidateSourcePreview">;
  conflictClient?: ReturnType<typeof createCanonicalConflictClient>;
  onDismiss: () => void;
  onSubmitted: (requestId: string) => void;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const sourceConflicts = useMemo(() => conflictClient ?? createCanonicalConflictClient(), [conflictClient]);
  const [freshPreview, setFreshPreview] = useState<ParameterFileSourcePreview | null>(null);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [refresh, setRefresh] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [stale, setStale] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const frozenBody = useRef<Parameters<NonNullable<ParameterCatalogRepository["submitProjectValueBatchChangeRequest"]>>[1] | null>(null);
  const frozenReleaseId = useRef<string | null>(null);
  const current = freshPreview;
  const bindings = current?.bindings ?? [];
  const receiptsMatch = Boolean(current && conflicts && (current.request
    ? conflicts.request?.id === current.request.id
      && conflicts.request.status === current.request.status
      && conflicts.request.kind === current.request.kind
    : !conflicts.request));
  const usableConflicts = Boolean(conflicts && current && conflicts.items.every((item) => {
    const binding = bindings.find((entry) => entry.bindingId === item.selectedBindingId);
    const choice = item.choices.file;
    return binding && choice.candidateId === candidate.id && choice.selectedBindingId === binding.bindingId
      && choice.selectedDraftId === item.selectedDraftId && choice.sourceProofToken === current.proofToken
      && choice.fileId === candidate.fileId && choice.baseVersionId === candidate.baseVersionId
      && choice.selectedSourcePinId === binding.sourcePinId
      && choice.selectedBaseValueId === binding.baseCurrentValueId
      && choice.selectedRevisionId === binding.configRevisionId
      && choice.action === binding.action && choice.targetText === binding.afterText
      && /^[0-9a-f]{64}$/.test(choice.decisionProofDigest);
  }) && new Set(conflicts.items.map((item) => `${item.selectedBindingId}:${item.selectedDraftId}`)).size === conflicts.items.length
    && conflicts.ineligible.every((entry) => entry.reason === "selected-draft-stale"));
  const ready = candidate.status === "ready" && current?.kind === "canonical"
    && current.candidateId === candidate.id && ["json", "dts"].includes(current.format.toLowerCase())
    && Boolean(current.proofToken) && bindings.length >= 2
    && permitsFreshBatchRequest(current.request) && receiptsMatch && usableConflicts
    && conflicts?.items.every((item) => confirmed[item.selectedBindingId])
    && new Set(bindings.map((binding) => binding.bindingId)).size === bindings.length
    && bindings.every((binding) => binding.bindingId && binding.sourcePinId
      && (binding.action === "delete" || binding.afterText !== undefined));

  useEffect(() => {
    let cancelled = false;
    void Promise.all([client.getProjectWorkflowRoleBindings(projectId),
      fileRepository?.getCandidateSourcePreview(projectId, candidate.id) ?? Promise.resolve(preview),
      sourceConflicts.listCandidateSourceConflicts(projectId, candidate.id)]).then(([result, latest, discovered]) => {
      if (cancelled) return;
      setFreshPreview(latest);
      setConflicts(discovered);
      setConfirmed({});
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载最新候选、冲突证明或软件审核人失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidate.id, client, currentUserId, fileRepository, preview, projectId, refresh, sourceConflicts]);

  const submit = async () => {
    if (!ready || stale || busy || loading || !reviewerId || !reason.trim() || !current || !conflicts
      || !repository?.submitProjectValueBatchChangeRequest) return;
    setBusy(true);
    setError(null);
    setAttempted(true);
    try {
      const catalogReleaseId = frozenReleaseId.current
        ?? (await repository.getCatalog()).item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前 Catalog release 不可用，已阻止提交。");
      frozenReleaseId.current = catalogReleaseId;
      const body = frozenBody.current ?? {
        candidateId: candidate.id, expectedProofToken: current.proofToken!,
        reason: reason.trim(), assignedToUserId: reviewerId,
        targetDecisions: bindings.map((binding) => ({ bindingId: binding.bindingId, choice: "file" as const,
          expectedConflictProofs: conflicts.items.filter((entry) => entry.selectedBindingId === binding.bindingId)
            .map((entry) => ({ draftId: entry.selectedDraftId,
              decisionProofDigest: entry.choices.file.decisionProofDigest })) }))
      };
      frozenBody.current = body;
      const { item } = await repository.submitProjectValueBatchChangeRequest(projectId, body,
        { catalogReleaseId, idempotencyKey: requestId.current });
      if (item.status !== "pending" || item.candidateId !== candidate.id
        || item.assignedToUserId !== reviewerId || item.submitterUserId !== currentUserId
        || !/^[0-9a-f]{64}$/.test(item.batchProofDigest)
        || item.cohortCount < bindings.length || item.targets.length !== bindings.length
        || item.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== bindings[index].bindingId || target.action !== bindings[index].action
          || target.sourcePinId !== bindings[index].sourcePinId
          || target.targetText !== (bindings[index].action === "delete" ? null : bindings[index].afterText))) {
        throw new Error("服务端冻结目标、顺序或证明与预览不一致；请从提交记录刷新核对。");
      }
      onSubmitted(item.id);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setStale(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新候选来源后重试。")}`
        : presentError(cause, "提交批量审核失败；网络结果不明时可用同一请求重试。"));
    } finally { setBusy(false); }
  };

  return <ModalDialog open className="submission-dialog canonical-batch-submit-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>提交 {preview.format.toUpperCase()} 批量来源审核</h2>
      <p id={descriptionId}>候选「{candidate.fileName}」的完整有序目标。提交后服务端冻结 batchProofDigest；另一名被指派人只审核一次，批准后全部目标在一次事务中应用。</p>
      <p>候选 ID：<code>{candidate.id}</code>；最新预览证明：<code>{current?.proofToken ?? "加载中"}</code></p>
      {current?.request ? <p role="status">{candidateReceiptMessage(current.request)}</p> : null}
      {conflicts && !receiptsMatch ? <p role="alert">候选与冲突回执不一致，请刷新后重新核对。</p> : null}
      {conflicts?.ineligible.some((entry) => entry.reason !== "selected-draft-stale") ? <p role="alert">存在不可处理的竞争草稿，不能提交；请刷新来源。</p> : null}
      <ol className="canonical-batch-submit-dialog__targets" aria-label="提交前批量目标">{bindings.map((binding, index) => <li key={binding.bindingId}>
        <strong>目标 {index + 1}：{binding.action === "delete" ? "删除" : "设置"}</strong>
        <div>Binding <code>{binding.bindingId}</code> · 来源 pin <code>{binding.sourcePinId}</code> · 路径 <code>{binding.locator}</code></div>
        <div>基线 <code>{binding.beforeText}</code> → {binding.action === "delete" ? "删除（无替换值）" : <code>{binding.afterText}</code>}</div>
        {conflicts?.items.some((item) => item.selectedBindingId === binding.bindingId) ? <>
          <p>此目标有竞争草稿；当前批量入口采用文件值，草稿会保留并预计过期。</p>
          <ul>{conflicts.items.filter((item) => item.selectedBindingId === binding.bindingId).map((item) =>
            <li key={item.selectedDraftId}>草稿 <code>{item.selectedDraftId}</code> · 作者 <code>{item.authorUserId}</code> · 草稿值 {item.choices.draft.action === "delete"
              ? "删除" : <code>{item.choices.draft.targetText}</code>}</li>)}</ul>
          <label><input type="checkbox" checked={Boolean(confirmed[binding.bindingId])} disabled={busy || attempted}
            onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null;
              frozenReleaseId.current = null; setConfirmed((value) => ({ ...value, [binding.bindingId]: event.target.checked })); }} />
            确认此目标采用文件值并保留竞争草稿</label>
        </> : null}
      </li>)}</ol>
      <label>修改原因<textarea value={reason} onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReason(event.target.value); }} disabled={busy || attempted} /></label>
      <label>指定软件审核人<select value={reviewerId} disabled={busy || loading || attempted}
        onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReviewerId(event.target.value); }}>
        {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
          : <option value="">没有可用的另一名软件审核人</option>}
      </select></label>
      {loading ? <p role="status">正在加载可指派审核人…</p> : null}
      {current?.request && (current.request.status === "pending" || current.request.status === "approved") ?
        <button type="button" className="button subtle" onClick={() => onSubmitted(current.request!.id)}>查看已有审核</button> : null}
      {(!attempted || stale) ? <button type="button" className="button subtle" disabled={loading || busy}
        onClick={() => { setFreshPreview(null); setConflicts(null); setLoading(true); setError(null);
          setStale(false); setAttempted(false);
          requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null;
          setRefresh((value) => value + 1); }}>刷新来源与冲突证明</button> : null}
      {!ready || !repository?.submitProjectValueBatchChangeRequest ? <p role="alert">批量来源证明或提交接口不可用，已阻止提交。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={onDismiss}>取消</button>
        <button type="button" disabled={busy || loading || stale || !ready || !reviewerId || !reason.trim()
          || !repository?.submitProjectValueBatchChangeRequest} onClick={() => void submit()}>
          {busy ? "提交中…" : `一次提交全部 ${bindings.length} 项`}
        </button></div>
    </>}
  </ModalDialog>;
}
