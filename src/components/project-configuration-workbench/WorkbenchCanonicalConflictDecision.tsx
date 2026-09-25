import { useEffect, useMemo, useState } from "react";
import type {
  CanonicalSourceConflictList,
  ParameterFileCandidate,
  ParameterFileRepository,
  ParameterFileSourcePreview
} from "@/application/ports/ParameterFileRepository";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";

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
  allowed, onSubmitted, governanceClient }: {
  projectId: string;
  currentUserId: string;
  candidate: ParameterFileCandidate;
  preview: ParameterFileSourcePreview;
  repository: Pick<ParameterFileRepository, "listCandidateSourceConflicts" | "submitCandidateSourceConflict">;
  allowed: boolean;
  onSubmitted: (requestId: string) => void;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
}) {
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [selected, setSelected] = useState<{ bindingId: string; draftId: string; choice: Choice } | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setConflicts(null);
    setSelected(null);
    setError("");
    void Promise.all([
      repository.listCandidateSourceConflicts(projectId, candidate.id),
      client.getProjectWorkflowRoleBindings(projectId)
    ]).then(([next, roles]) => {
      if (cancelled) return;
      setConflicts(next);
      const eligible = roles.bindings.filter((binding) => binding.isActive
        && binding.userId !== currentUserId && binding.roles.includes("software-committer"))
        .map((binding) => ({ userId: binding.userId, name: binding.name }));
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "加载来源冲突或审核人失败，请刷新重试。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidate.id, client, currentUserId, projectId, reload, repository]);

  const item = conflicts?.items.find((entry) => entry.selectedBindingId === selected?.bindingId
    && entry.selectedDraftId === selected?.draftId);
  const ready = Boolean(allowed && selected && item && conflictProofReady(candidate, preview, item, selected.choice)
    && reviewerId && reason.trim() && !loading && !busy);
  const submit = async () => {
    if (!ready || !selected || !item) return;
    setBusy(true);
    setError("");
    try {
      const result = await repository.submitCandidateSourceConflict(projectId, candidate.id, {
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

  return <section aria-label="canonical 来源冲突单项决策" className="configuration-workbench__canonical-conflicts">
    <h4>来源冲突：一次选择一项</h4>
    <p>选择一个 Binding 的一份界面草稿及文件值或草稿值。提交后由指定审核人审核，其他草稿不会一并裁决。</p>
    <button type="button" className="button subtle" disabled={busy} onClick={() => setReload((value) => value + 1)}>刷新冲突证明</button>
    {loading ? <p role="status">正在读取冲突与审核人…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {!loading && conflicts?.items.length === 0 && conflicts.ineligible.length === 0 ? <p>当前候选没有可选择的 canonical 来源冲突。</p> : null}
    {conflicts?.ineligible.map((entry) => <p role="status" key={`${entry.selectedBindingId}:${entry.selectedDraftId}`}>
      Binding <code>{entry.selectedBindingId}</code> · 草稿 <code>{entry.selectedDraftId}</code> 的来源证明不可用（{entry.reason}），请刷新来源与候选后重试。
    </p>)}
    {conflicts?.items.map((entry) => <fieldset key={`${entry.selectedBindingId}:${entry.selectedDraftId}`}>
      <legend>Binding <code>{entry.selectedBindingId}</code> · 草稿 <code>{entry.selectedDraftId}</code> · 作者 <code>{entry.authorUserId}</code></legend>
      {(["file", "draft"] as const).map((choice) => {
        const proof = entry.choices[choice];
        const proofReady = conflictProofReady(candidate, preview, entry, choice);
        return <label key={choice}>
          <input type="radio" name="canonical-conflict-decision"
            checked={selected?.bindingId === entry.selectedBindingId && selected.draftId === entry.selectedDraftId && selected.choice === choice}
            disabled={!allowed || !proofReady || busy}
            onChange={() => setSelected({ bindingId: entry.selectedBindingId, draftId: entry.selectedDraftId, choice })} />
          {choice === "file" ? "使用文件值" : "保留界面草稿值"}：{proof.action === "delete" ? "删除" : <code>{proof.targetText ?? "缺失"}</code>}
          <small> · {proofReady ? "证明完整（提交时再次校验）" : "证明不完整，禁止提交"}</small>
        </label>;
      })}
    </fieldset>)}
    {item && selected ? <p>选中证明 <code>{item.choices[selected.choice].decisionProofDigest}</code></p> : null}
    {conflicts?.items.length ? <>
      <label>决策理由<textarea value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} /></label>
      <label>指定软件审核人<select value={reviewerId} disabled={busy || loading} onChange={(event) => setReviewerId(event.target.value)}>
        {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
          : <option value="">没有可用的另一名软件审核人</option>}
      </select></label>
      <button type="button" className="button primary" disabled={!ready} onClick={() => void submit()}>{busy ? "提交中…" : "提交所选一项人工审核"}</button>
    </> : null}
  </section>;
}
