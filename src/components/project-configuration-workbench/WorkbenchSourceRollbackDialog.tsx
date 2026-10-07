import { useEffect, useRef, useState } from "react";

import type { ProjectParameterFileVersion } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import type { BatchRollbackPreparation, BatchRollbackSubmission, createCanonicalBatchRollbackClient } from "@/infrastructure/http/canonicalBatchRollbackClient";
import { canonicalBatchConflictReady, createCanonicalConflictClient,
  type CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import { candidateReceiptMessage, permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";

type BatchRollback = {
  projectId: string;
  fileId: string;
  currentUserId: string;
  workflowProofToken: string;
  client: ReturnType<typeof createCanonicalBatchRollbackClient>;
  conflictClient?: ReturnType<typeof createCanonicalConflictClient>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  onSubmitted: (requestId: string) => void;
  onOpenExisting?: (requestId: string) => void;
};

export function batchRollbackProofReady(prepared: BatchRollbackPreparation,
  batch: Pick<BatchRollback, "projectId" | "fileId" | "workflowProofToken">,
  version: ProjectParameterFileVersion, currentVersionId: string): boolean {
  const ids = prepared.targets.map((target) => target.bindingId);
  const cohort = new Map(prepared.cohort.map((binding) => [binding.bindingId, binding]));
  return prepared.kind === "canonical-source-batch" && prepared.fileId === batch.fileId
    && prepared.projectId === batch.projectId && prepared.historicalVersionId === version.id
    && prepared.expectedCurrentVersionId === currentVersionId
    && prepared.expectedWorkflowProofToken === batch.workflowProofToken
    && prepared.baseVersionId === currentVersionId && prepared.cohortProofToken === batch.workflowProofToken
    && Boolean(prepared.candidateId && prepared.proofToken)
    && /^[0-9a-f]{64}$/.test(prepared.batchProofDigest)
    && prepared.targets.length >= 2 && new Set(ids).size === ids.length
    && ids.every((id, index) => index === 0 || ids[index - 1]! < id)
    && prepared.members.length > 0
    && new Set(prepared.members.map((member) => member.memberId)).size === prepared.members.length
    && cohort.size === prepared.cohort.length
    && prepared.targets.every((target) => cohort.get(target.bindingId)?.sourcePinId === target.sourcePinId
      && cohort.get(target.bindingId)?.oldValueId === target.baseCurrentValueId
      && cohort.get(target.bindingId)?.definitionId === target.definitionId
      && (target.action === "delete" ? target.afterText === undefined : target.afterText !== undefined));
}

export type WorkbenchSourceRollbackDialogProps = {
  open: boolean;
  version: ProjectParameterFileVersion | null;
  currentVersionId?: string;
  pending: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  batch?: BatchRollback;
};

export function WorkbenchSourceRollbackDialog({
  open,
  version,
  currentVersionId,
  pending,
  error,
  onCancel,
  onConfirm,
  batch
}: WorkbenchSourceRollbackDialogProps) {
  const [reason, setReason] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [prepared, setPrepared] = useState<BatchRollbackPreparation | null>(null);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [batchError, setBatchError] = useState("");
  const [loading, setLoading] = useState(Boolean(batch));
  const [submitting, setSubmitting] = useState(false);
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [retry, setRetry] = useState(0);
  const prepareRequestId = useRef(crypto.randomUUID());
  const submitRequestId = useRef(crypto.randomUUID());
  const submittedBody = useRef<Parameters<BatchRollback["client"]["submit"]>[2] | null>(null);

  useEffect(() => {
    if (open) setReason("");
  }, [open, version?.id]);

  const batchClient = batch?.client;
  const batchProjectId = batch?.projectId;
  const batchFileId = batch?.fileId;
  const batchCurrentUserId = batch?.currentUserId;
  const batchWorkflowProofToken = batch?.workflowProofToken;
  const governanceClient = batch?.governanceClient;
  const conflictClient = batch?.conflictClient;
  const unproven = conflicts?.ineligible.filter((item) => item.reason !== "selected-draft-stale") ?? [];
  const receiptAllowsSubmit = Boolean(conflicts && permitsFreshBatchRequest(conflicts.request));
  const unconfirmed = prepared?.targets.some((target) => conflicts?.items.some(
    (item) => item.selectedBindingId === target.bindingId) && !confirmed[target.bindingId]) ?? false;

  const resetSubmit = () => {
    submitRequestId.current = crypto.randomUUID();
    submittedBody.current = null;
  };

  useEffect(() => {
    if (!open || !batchClient || !batchProjectId || !batchFileId || !batchWorkflowProofToken
      || !version || !currentVersionId) return;
    let cancelled = false;
    const governance = governanceClient ?? createUserGovernanceClient();
    void Promise.all([
      batchClient.prepare(batchProjectId, batchFileId, {
        versionId: version.id, expectedCurrentVersionId: currentVersionId,
        expectedWorkflowProofToken: batchWorkflowProofToken
      }, prepareRequestId.current),
      governance.getProjectWorkflowRoleBindings(batchProjectId)
    ]).then(async ([proof, roles]) => {
      if (cancelled) return;
      if (!batchRollbackProofReady(proof, { projectId: batchProjectId, fileId: batchFileId,
        workflowProofToken: batchWorkflowProofToken }, version, currentVersionId)) {
        throw new Error("回滚候选的完整目标、顺序或来源证明不一致，已阻止提交。");
      }
      const discovered = await (conflictClient ?? createCanonicalConflictClient())
        .listCandidateSourceConflicts(batchProjectId, proof.candidateId);
      if (cancelled) return;
      if (discovered.items.some((item) => !canonicalBatchConflictReady(proof, item))) {
        throw new Error("竞争草稿证明与历史目标或来源不一致；已阻止提交，请刷新后重新预览。");
      }
      const eligible = roles.bindings.filter((item) => item.isActive
        && item.userId !== batchCurrentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      submitRequestId.current = crypto.randomUUID();
      submittedBody.current = null;
      setConfirmed({});
      setConflicts(discovered);
      setPrepared(proof);
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) {
        if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setConflicted(true);
        setBatchError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
          ? `来源或历史版本已变化（409）：${presentError(cause, "请刷新工作台后重新选择历史版本。")}`
          : presentError(cause, "准备历史回滚候选或竞争草稿证明失败。"));
      }
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [batchClient, batchProjectId, batchFileId, batchCurrentUserId,
    batchWorkflowProofToken, conflictClient, governanceClient, currentVersionId, open, retry, version]);

  const submitBatch = async () => {
    if (!batch || !version || !currentVersionId || !prepared || !conflicts || !receiptAllowsSubmit || unproven.length || unconfirmed
      || submitting || !reviewerId || !reason.trim()
      || !batchRollbackProofReady(prepared, batch, version, currentVersionId)) return;
    const targetDecisions = prepared.targets.map((target) => ({ bindingId: target.bindingId,
      choice: "file" as const, expectedConflictProofs: conflicts.items
        .filter((item) => item.selectedBindingId === target.bindingId)
        .map((item) => ({ draftId: item.selectedDraftId,
          decisionProofDigest: item.choices.file.decisionProofDigest })) }));
    const body = submittedBody.current ?? {
      versionId: version.id, expectedCurrentVersionId: currentVersionId,
      expectedWorkflowProofToken: batch.workflowProofToken, candidateId: prepared.candidateId,
      expectedCandidateProofToken: prepared.proofToken, expectedBatchProofDigest: prepared.batchProofDigest,
      reason: reason.trim(), assignedToUserId: reviewerId, targetDecisions
    };
    submittedBody.current = body;
    setSubmittedOnce(true);
    setSubmitting(true);
    setBatchError("");
    try {
      const result: BatchRollbackSubmission = await batch.client.submit(
        batch.projectId, batch.fileId, body, submitRequestId.current);
      if (result.candidateId !== prepared.candidateId || result.batchProofDigest !== prepared.batchProofDigest
        || !result.requestId || result.status !== "pending") {
        throw new Error("服务端冻结请求与准备证明不一致；请从提交记录刷新核对。");
      }
      batch.onSubmitted(result.requestId);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setConflicted(true);
      setBatchError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? cause.details.reason === "canonical-batch-conflict-proof-stale"
          ? "竞争草稿或历史文件选择证明已变化（409），本次未创建待审请求；请关闭弹窗并重新预览。"
          : `来源过期或重复请求冲突（409）：${presentError(cause, "请刷新工作台并重新准备回滚。")}`
        : presentError(cause, "提交历史回滚审核失败；可用同一请求重试。"));
    } finally { setSubmitting(false); }
  };

  const trimmedReason = reason.trim();
  return (
    <ConfirmDialog
      open={open && Boolean(version)}
      className={batch ? "workbench-batch-rollback-dialog" : undefined}
      title={batch ? "提交多目标历史回滚审核" : "提交来源回滚审核"}
      description={
        <div className={batch ? "workbench-batch-rollback-dialog__description" : undefined}>
          <p>
            版本 <code>{version?.versionNumber}</code> 将通过来源审核流程申请回滚；审核通过前不会改变当前 Value、来源 pin 和活跃文件版本。
          </p>
          <p>
            当前版本：<code className="mono">{currentVersionId ?? "缺失"}</code>
          </p>
          {batch ? <>
            {loading ? <p role="status">正在准备完整来源候选、竞争草稿证明并加载审核人…</p> : null}
            {prepared ? <>
              {conflicts?.request ? <p role="status">{candidateReceiptMessage(conflicts.request)}</p> : null}
              {conflicts?.request && !receiptAllowsSubmit && batch.onOpenExisting ?
                <button type="button" className="button subtle" onClick={() => batch.onOpenExisting?.(conflicts.request!.id)}>查看已有审核</button> : null}
              <p>格式：{prepared.format.toUpperCase()}；候选：<code>{prepared.candidateId}</code>；完整有序目标 {prepared.targets.length} 项；来源 cohort {prepared.cohort.length} 项。</p>
              <p>批量证明摘要：<code>{prepared.batchProofDigest}</code></p>
              <ol aria-label="历史回滚完整有序目标">{prepared.targets.map((target, index) => {
                const options = conflicts?.items.filter((item) => item.selectedBindingId === target.bindingId) ?? [];
                return <li key={target.bindingId}>
                  目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"} · Binding <code>{target.bindingId}</code> · 来源 pin <code>{target.sourcePinId}</code>
                  <div>基线 <code>{target.beforeText}</code> → 历史文件值 {target.action === "delete" ? "删除（无替换值）" : <code>{target.afterText}</code>}</div>
                  {options.length ? <>
                    <p>此目标有 {options.length} 份竞争草稿；当前回滚仅支持采用历史文件值，草稿会保留并预计过期。</p>
                    <ul>{options.map((item) => <li key={item.selectedDraftId}>
                      草稿 <code>{item.selectedDraftId}</code> · 作者 <code>{item.authorUserId}</code> · 草稿值 {item.choices.draft.action === "delete"
                        ? "删除" : <code>{item.choices.draft.targetText}</code>}
                    </li>)}</ul>
                    <label><input type="checkbox" checked={Boolean(confirmed[target.bindingId])}
                      disabled={submitting || submittedOnce} onChange={(event) => {
                        resetSubmit();
                        setConfirmed((current) => ({ ...current, [target.bindingId]: event.target.checked }));
                      }} />确认此目标采用历史文件值，并保留竞争草稿</label>
                  </> : null}
                </li>;
              })}</ol>
              {conflicts?.ineligible.map((item) => <p role="status" key={item.selectedDraftId}>
                草稿 <code>{item.selectedDraftId}</code> {item.reason === "selected-draft-stale"
                  ? "已基于旧来源，不参与当前竞争。" : `无法取得可验证的历史文件选择证明（${item.reason}）。`}
              </p>)}
              {unproven.length ? <p role="alert">存在不可处理的竞争草稿，已阻止提交；请刷新来源并重新预览。</p> : null}
              {!submittedOnce ? <button type="button" className="button subtle" disabled={loading}
                onClick={() => {
                  setPrepared(null);
                  setConflicts(null);
                  setConfirmed({});
                  setBatchError("");
                  setLoading(true);
                  prepareRequestId.current = crypto.randomUUID();
                  resetSubmit();
                  setRetry((value) => value + 1);
                }}>重新预览历史目标与证明</button> : null}
            </> : null}
            {batchError && !prepared && !conflicted ? <button type="button" className="button subtle" onClick={() => {
              setBatchError("");
              setLoading(true);
              setRetry((value) => value + 1);
            }}>重试准备</button> : null}
          </> : null}
        </div>
      }
      confirmLabel="提交审核"
      pendingLabel="提交中…"
      pending={pending || submitting}
      confirmDisabled={Boolean(batch) && (loading || !prepared || !conflicts || !receiptAllowsSubmit || unproven.length > 0
        || unconfirmed || !reviewerId || !trimmedReason || conflicted)}
      error={batchError || error || (!trimmedReason ? "请填写来源回滚原因。"
        : unconfirmed ? "请逐项目确认采用历史文件值。" : "")}
      extra={
        <><label className="configuration-workbench__source-review-reason">
          <span>回滚原因（必填）</span>
          <textarea
            aria-label="来源回滚原因"
            value={reason}
            disabled={pending || submitting || submittedOnce}
            onChange={(event) => { resetSubmit(); setReason(event.target.value); }}
            rows={4}
            placeholder="说明回滚原因与影响范围。"
          />
        </label>
        {batch ? <label className="configuration-workbench__source-review-reason">指定软件审核人
          <select value={reviewerId} disabled={loading || submitting || submittedOnce}
            onChange={(event) => { resetSubmit(); setReviewerId(event.target.value); }}>
            {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
              : <option value="">没有可用的另一名软件审核人</option>}
          </select>
        </label> : null}</>
      }
      onCancel={onCancel}
      onConfirm={() => {
        if (batch) void submitBatch();
        else if (trimmedReason) onConfirm(trimmedReason);
      }}
    />
  );
}
