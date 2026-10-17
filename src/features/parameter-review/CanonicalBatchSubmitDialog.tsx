import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ParameterFileCandidate, ParameterFileRepository, ParameterFileSourcePreview } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { candidateReceiptMessage, permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";
import { ModalDialog } from "@/components/common/ModalDialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ReviewProvenance } from "./ReviewProvenance";
import { reviewLocator } from "./ReviewSourceDiff";
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
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
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
      setMemberNames(Object.fromEntries(result.bindings.map((member) => [member.userId, member.name])));
      setReviewerId((selected) => eligible.some((reviewer) => reviewer.userId === selected) ? selected : eligible.length === 1 ? eligible[0]!.userId : "");
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
    let writeStarted = false;
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
      writeStarted = true;
      setAttempted(true);
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
      if (!writeStarted || cause instanceof WiseEffApiError && ["VALIDATION_FAILED", "FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(cause.code)) {
        setAttempted(false);
        frozenBody.current = null;
        frozenReleaseId.current = null;
        requestId.current = crypto.randomUUID();
      }
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setStale(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源过期或请求冲突（409）：${presentError(cause, "请刷新候选来源后重试。")}`
        : presentError(cause, writeStarted ? "提交结果尚未确认；请用同一请求重试，核对完成前已保留并锁定填写内容。" : "提交前核对失败，填写内容已保留，可稍后重试。"));
    } finally { setBusy(false); }
  };

  return <ModalDialog open className="submission-dialog review-dialog canonical-batch-submit-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>提交 {preview.format.toUpperCase()} 批量来源审核</h2>
      <div className="review-dialog__body">
      <p id={descriptionId}>「{candidate.fileName}」的 {bindings.length} 项变更将在审核通过后整批应用。</p>
      {current?.request ? <p role="status">{candidateReceiptMessage(current.request)}</p> : null}
      {conflicts && !receiptsMatch ? <p role="alert">候选与冲突回执不一致，请刷新后重新核对。</p> : null}
      {conflicts?.ineligible.some((entry) => entry.reason !== "selected-draft-stale") ? <p role="alert">存在不可处理的竞争草稿，不能提交；请刷新来源。</p> : null}
      <ol className="canonical-batch-submit-dialog__targets" aria-label="提交前批量目标">{bindings.map((binding, index) => <li key={binding.bindingId}>
        <strong>{index + 1}. {binding.displayPath ?? reviewLocator(binding.locator)}</strong>
        <div className="review-target-change"><code>{binding.beforeText}</code> → {binding.action === "delete" ? "删除属性" : <code>{binding.afterText}</code>}</div>
        {conflicts?.items.some((item) => item.selectedBindingId === binding.bindingId) ? <>
          <p>此目标有竞争草稿；当前批量入口采用文件值，草稿会保留并预计过期。</p>
          <ul>{conflicts.items.filter((item) => item.selectedBindingId === binding.bindingId).map((item) =>
            <li key={item.selectedDraftId}><span>{memberNames[item.authorUserId] ?? "另一位项目成员"}</span> · 竞争草稿值 {item.choices.draft.action === "delete"
              ? "删除" : <code>{item.choices.draft.targetText}</code>}</li>)}</ul>
          <label><input type="checkbox" checked={Boolean(confirmed[binding.bindingId])} disabled={busy || attempted}
            onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null;
              frozenReleaseId.current = null; setConfirmed((value) => ({ ...value, [binding.bindingId]: event.target.checked })); }} />
            确认此目标采用文件值并保留竞争草稿</label>
          {!confirmed[binding.bindingId] ? <p role="note">请确认此目标采用文件值后再提交。</p> : null}
        </> : null}
      </li>)}</ol>
      <div className="review-inspector__field"><Label htmlFor="batch-submit-reason">修改原因</Label><Textarea id="batch-submit-reason" required rows={4} placeholder="说明修改目的和核对依据" value={reason} onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReason(event.target.value); }} disabled={busy || attempted} /></div>
      <div className="review-inspector__field"><Label htmlFor="batch-submit-reviewer">指定软件审核人</Label><SelectControl id="batch-submit-reviewer" value={reviewerId} placeholder="选择软件审核人" disabled={busy || loading || attempted} ariaLabel="指定软件审核人" ariaRequired
        onValueChange={(value) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReviewerId(value); }}
        options={reviewers.length ? reviewers.map((reviewer) => ({ value: reviewer.userId, label: reviewer.name }))
          : [{ value: "", label: loading ? "正在加载审核人…" : "没有可用的另一名软件审核人" }]} /></div>
      {loading ? <p role="status">正在加载可指派审核人…</p> : null}
      {current?.request && (current.request.status === "pending" || current.request.status === "approved") ?
        <button type="button" className="button subtle" onClick={() => onSubmitted(current.request!.id)}>查看已有审核</button> : null}
      {error && (!attempted || stale) ? <button type="button" className="button subtle" disabled={loading || busy}
        onClick={() => { setFreshPreview(null); setConflicts(null); setLoading(true); setError(null);
          setStale(false); setAttempted(false);
          requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null;
          setRefresh((value) => value + 1); }}>重新核对提交内容</button> : null}
      {!loading && !error && !conflicts?.items.some((item) => !confirmed[item.selectedBindingId]) && !current?.request && !ready ? <p role="alert">来源内容不完整，暂不能提交。请返回候选核对。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ReviewProvenance entries={[{ label: "候选 ID", value: candidate.id }, { label: "最新预览证明", value: current?.proofToken }, { label: "来源目标", value: bindings }, { label: "冲突详情", value: conflicts }]} />
      </div>
      <div className="dialog-actions review-dialog__footer"><button type="button" className="button subtle" disabled={busy} onClick={onDismiss}>取消</button>
        <button type="button" disabled={busy || loading || stale || !ready || !reviewerId || !reason.trim()
          || !repository?.submitProjectValueBatchChangeRequest} className="button primary" onClick={() => void submit()}>
          {busy ? "提交中…" : loading ? "正在核对…" : attempted && !stale ? "重试同一提交" : `提交 ${bindings.length} 项审核`}
        </button></div>
    </>}
  </ModalDialog>;
}
