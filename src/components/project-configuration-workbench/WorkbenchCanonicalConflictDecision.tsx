import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ParameterFileCandidate,
  ParameterFileSourcePreview
} from "@/application/ports/ParameterFileRepository";
import { createCanonicalConflictClient, type CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { candidateReceiptMessage } from "@/application/project-configuration/candidateRequestReceipt";
import { reviewLocator } from "@/features/parameter-review/ReviewSourceDiff";

type Conflict = CanonicalSourceConflictList["items"][number];
type Choice = "file" | "draft";

export function conflictProofReady(candidate: ParameterFileCandidate, preview: ParameterFileSourcePreview,
  item: Conflict, choice: Choice): boolean {
  const proof = item.choices[choice];
  const other = item.choices[choice === "file" ? "draft" : "file"];
  return candidate.status === "ready" && preview.kind === "canonical"
    && preview.candidateId === candidate.id && proof.candidateId === candidate.id
    && proof.selectedBindingId === item.selectedBindingId && proof.selectedDraftId === item.selectedDraftId
    && proof.choice === choice && proof.fileId === candidate.fileId
    && proof.baseVersionId === candidate.baseVersionId && proof.sourceProofToken === preview.proofToken
    && /^[0-9a-f]{64}$/.test(proof.decisionProofDigest)
    && proof.members.length > 0 && proof.cohort.length > 0
    && new Set(proof.members.map((member) => member.memberId)).size === proof.members.length
    && new Set(proof.cohort.map((member) => member.bindingId)).size === proof.cohort.length
    && proof.cohort.some((member) => member.bindingId === item.selectedBindingId
      && member.sourcePinId === proof.selectedSourcePinId && member.oldValueId === proof.selectedBaseValueId)
    && (proof.action === "delete" ? proof.targetText === undefined : proof.targetText !== undefined)
    && JSON.stringify(proof.members) === JSON.stringify(other.members)
    && JSON.stringify(proof.cohort) === JSON.stringify(other.cohort);
}

export function WorkbenchCanonicalConflictDecision({ projectId, currentUserId, candidate, preview, repository,
  allowed, onSubmitted, governanceClient, inlineTarget, onSubmitWithoutConflict, blockedReason, onReturnToBatch }: {
  projectId: string;
  currentUserId: string;
  candidate: ParameterFileCandidate;
  preview: ParameterFileSourcePreview;
  repository?: ReturnType<typeof createCanonicalConflictClient>;
  allowed: boolean;
  onSubmitted: (requestId: string) => void;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  inlineTarget?: HTMLElement | null;
  blockedReason?: string;
  onSubmitWithoutConflict?: (reason: string, reviewerId: string) => Promise<void>;
  onReturnToBatch?: () => void;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const conflictClient = useMemo(() => repository ?? createCanonicalConflictClient(), [repository]);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [selected, setSelected] = useState<{ bindingId: string; draftId: string; choice: Choice } | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [reviewerError, setReviewerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingReviewers(true);
    setReviewerError("");
    setConflicts(null);
    setSelected(null);
    setError("");
    void conflictClient.listCandidateSourceConflicts(projectId, candidate.id).then((next) => {
      if (cancelled) return;
      setConflicts(next);
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载来源冲突失败，请重新核对。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    void client.getProjectWorkflowRoleBindings(projectId).then((roles) => {
      if (cancelled) return;
      const eligible = roles.bindings.filter((binding) => binding.isActive
        && binding.userId !== currentUserId && binding.roles.includes("software-committer"))
        .map((binding) => ({ userId: binding.userId, name: binding.name }));
      setReviewers(eligible);
      setReviewerId((current) => eligible.some((reviewer) => reviewer.userId === current) ? current : eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setReviewerError(presentError(cause, "加载软件审核人失败，请重新核对。"));
    }).finally(() => { if (!cancelled) setLoadingReviewers(false); });
    return () => { cancelled = true; };
  }, [candidate.id, client, conflictClient, currentUserId, projectId, reload]);

  const item = conflicts?.items.find((entry) => entry.selectedBindingId === selected?.bindingId
    && entry.selectedDraftId === selected?.draftId);
  const ready = Boolean(allowed && !conflicts?.request && selected && item && conflictProofReady(candidate, preview, item, selected.choice)
    && reviewerId && reason.trim() && !loading && !loadingReviewers && !reviewerError && !busy);
  const inline = inlineTarget !== undefined;
  const receipt = inline ? preview.request ?? conflicts?.request : conflicts?.request;
  const hasConflicts = Boolean(conflicts?.items.length || conflicts?.ineligible.length);
  const noConflicts = Boolean(conflicts && !hasConflicts && !loading && !loadingReviewers && !error && !reviewerError);
  const singleReady = Boolean(inline && onSubmitWithoutConflict && noConflicts && !receipt && allowed
    && candidate.status === "ready" && preview.kind === "canonical" && preview.canSubmit
    && preview.candidateId === candidate.id && preview.proofToken && reviewerId && reason.trim() && !busy);
  const submitWithoutConflict = async () => {
    if (!singleReady || !onSubmitWithoutConflict) return;
    setBusy(true);
    setError("");
    try {
      await onSubmitWithoutConflict(reason.trim(), reviewerId);
    } catch (cause) {
      setError(presentError(cause, "提交来源审核失败，请重新核对后重试。"));
    } finally { setBusy(false); }
  };
  const submit = async () => {
    if (!ready || !selected || !item) return;
    setBusy(true);
    setError("");
    try {
      const result = await conflictClient.submitCandidateSourceConflict(projectId, candidate.id, {
        selectedBindingId: selected.bindingId,
        selectedDraftId: selected.draftId,
        choice: selected.choice,
        expectedDecisionProofDigest: item.choices[selected.choice].decisionProofDigest,
        reason: reason.trim(),
        assignedToUserId: reviewerId
      });
      if (!result.requestId || !["pending", "approved", "rejected", "withdrawn"].includes(result.status)) {
        throw new Error("服务端未返回可追踪的审核请求，请刷新候选状态核对。");
      }
      onSubmitted(result.requestId);
    } catch (cause) {
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源或选择证明已过期（409）：${presentError(cause, "请刷新候选与冲突证明后重试。")}`
        : presentError(cause, "提交单项来源冲突决策失败。"));
    } finally { setBusy(false); }
  };

  const body = <section aria-label={inline ? "来源变更审核" : "来源冲突单项决策"} className="configuration-workbench__canonical-conflicts">
    {inline && onReturnToBatch ? <button type="button" className="button subtle" disabled={busy}
      onClick={onReturnToBatch}>返回整批更新</button> : null}
    {inline && receipt && (receipt.status === "pending" || receipt.status === "approved") ? <>
      <p role="status">{candidateReceiptMessage(receipt)}</p>
      <button type="button" className="button subtle" onClick={() => onSubmitted(receipt.id)}>查看已有审核</button>
    </> : <>
    {!inline || hasConflicts ? <><h4>来源冲突：一次选择一项</h4>
    <p>对一项参数选择文件值或界面草稿值，再提交审核。其他草稿保留。</p>
    </> : null}
    {!inline || hasConflicts || error || reviewerError ? <button type="button" className="button subtle" disabled={busy || loading || loadingReviewers} onClick={() => setReload((value) => value + 1)}>重新核对冲突</button> : null}
    {blockedReason ? <p role="alert">{blockedReason}</p> : null}
    {loading ? <p role="status">正在读取来源冲突…</p> : null}
    {loadingReviewers ? <p role="status">正在加载审核人…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {reviewerError ? <p role="alert">{reviewerError}</p> : null}
    {receipt ? <p role="status">{candidateReceiptMessage(receipt)}</p> : null}
    {!inline && !loading && conflicts?.items.length === 0 && conflicts.ineligible.length === 0 ? <p>当前候选没有来源冲突。</p> : null}
    {conflicts?.ineligible.map((entry) => <div role="status" key={`${entry.selectedBindingId}:${entry.selectedDraftId}`}>
      参数绑定 <code>{entry.selectedBindingId}</code> · 草稿 <code>{entry.selectedDraftId}</code> 暂不可选，请重新核对来源与候选。<details><summary>核对详情</summary>{entry.reason}</details>
    </div>)}
    {conflicts?.items.map((entry) => <fieldset key={`${entry.selectedBindingId}:${entry.selectedDraftId}`}>
      <legend>{reviewLocator(entry.choices.file.cohort.find((binding) => binding.bindingId === entry.selectedBindingId)?.locator)}</legend>
      <details><summary>草稿来源</summary>参数绑定 <code>{entry.selectedBindingId}</code> · 草稿 <code>{entry.selectedDraftId}</code> · 作者 <code>{entry.authorUserId}</code></details>
      {(["file", "draft"] as const).map((choice) => {
        const proof = entry.choices[choice];
        const proofReady = conflictProofReady(candidate, preview, entry, choice);
        return <label key={choice}>
          <input type="radio" name="canonical-conflict-decision"
            checked={selected?.bindingId === entry.selectedBindingId && selected.draftId === entry.selectedDraftId && selected.choice === choice}
            disabled={!allowed || !proofReady || busy}
            onChange={() => setSelected({ bindingId: entry.selectedBindingId, draftId: entry.selectedDraftId, choice })} />
          {choice === "file" ? "使用文件值" : "保留界面草稿值"}：{proof.action === "delete" ? "删除" : <code>{proof.targetText ?? "缺失"}</code>}
          {!proofReady ? <small> · 来源无法核对，暂不可选</small> : null}
        </label>;
      })}
    </fieldset>)}
    {item && selected ? <details><summary>所选变更的核对信息</summary><code>{item.choices[selected.choice].decisionProofDigest}</code></details> : null}
    {(inline ? !receipt && (conflicts?.items.length || noConflicts) : conflicts?.items.length || reason) ? <>
      <label className="configuration-workbench__source-review-reason">{inline ? "修改原因" : "决策理由"}<textarea value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <label>指定软件审核人<SelectControl
        value={reviewerId}
        disabled={busy || loadingReviewers || Boolean(reviewerError)}
        onValueChange={(value) => setReviewerId(value)}
        ariaLabel="指定软件审核人"
        options={reviewers.length ? reviewers.map((reviewer) => ({ value: reviewer.userId, label: reviewer.name })) : [{ value: "", label: loadingReviewers ? "正在加载审核人…" : reviewerError ? "审核人加载失败" : "没有可用的另一名软件审核人" }]}
      /></label>
      {!loadingReviewers && !reviewerError && !reviewers.length ? <p role="status">需要另一名软件审核人。<a href={`/parameter-admin/projects/${encodeURIComponent(projectId)}/review-roles`} target="_blank" rel="noreferrer">配置审核角色</a></p> : null}
      <button type="button" className="button primary" disabled={!(ready || singleReady)} onClick={() => { if (singleReady) void submitWithoutConflict(); else void submit(); }}>{busy ? "提交中…" : inline ? "提交审核" : "提交所选一项人工审核"}</button>
    </> : null}
    </>}
  </section>;
  return inlineTarget === undefined ? body : inlineTarget ? createPortal(body, inlineTarget) : null;
}
