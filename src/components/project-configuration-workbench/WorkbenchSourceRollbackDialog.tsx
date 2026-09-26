import { useEffect, useRef, useState } from "react";

import type { ProjectParameterFileVersion } from "@/application/ports/ParameterFileRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import type { BatchRollbackPreparation, BatchRollbackSubmission, createCanonicalBatchRollbackClient } from "@/infrastructure/http/canonicalBatchRollbackClient";

type BatchRollback = {
  projectId: string;
  fileId: string;
  currentUserId: string;
  workflowProofToken: string;
  client: ReturnType<typeof createCanonicalBatchRollbackClient>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  onSubmitted: (requestId: string) => void;
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
    ]).then(([proof, roles]) => {
      if (cancelled) return;
      if (!batchRollbackProofReady(proof, { projectId: batchProjectId, fileId: batchFileId,
        workflowProofToken: batchWorkflowProofToken }, version, currentVersionId)) {
        throw new Error("回滚候选的完整目标、顺序或来源证明不一致，已阻止提交。");
      }
      const eligible = roles.bindings.filter((item) => item.isActive
        && item.userId !== batchCurrentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setPrepared(proof);
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => {
      if (!cancelled) setBatchError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源或历史版本已变化（409）：${presentError(cause, "请刷新工作台后重新选择历史版本。")}`
        : presentError(cause, "准备历史回滚候选失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [batchClient, batchProjectId, batchFileId, batchCurrentUserId,
    batchWorkflowProofToken, governanceClient, currentVersionId, open, retry, version]);

  const submitBatch = async () => {
    if (!batch || !version || !currentVersionId || !prepared || submitting || !reviewerId || !reason.trim()
      || !batchRollbackProofReady(prepared, batch, version, currentVersionId)) return;
    const body = submittedBody.current ?? {
      versionId: version.id, expectedCurrentVersionId: currentVersionId,
      expectedWorkflowProofToken: batch.workflowProofToken, candidateId: prepared.candidateId,
      expectedCandidateProofToken: prepared.proofToken, expectedBatchProofDigest: prepared.batchProofDigest,
      reason: reason.trim(), assignedToUserId: reviewerId
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
        ? `来源过期或重复请求冲突（409）：${presentError(cause, "请刷新工作台并重新准备回滚。")}`
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
            {loading ? <p role="status">正在准备完整来源候选并加载审核人…</p> : null}
            {prepared ? <>
              <p>格式：{prepared.format.toUpperCase()}；候选：<code>{prepared.candidateId}</code>；完整有序目标 {prepared.targets.length} 项；来源 cohort {prepared.cohort.length} 项。</p>
              <p>批量证明摘要：<code>{prepared.batchProofDigest}</code></p>
              <ol aria-label="历史回滚完整有序目标">{prepared.targets.map((target, index) => <li key={target.bindingId}>
                目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"} · Binding <code>{target.bindingId}</code> · 来源 pin <code>{target.sourcePinId}</code>
                <div>基线 <code>{target.beforeText}</code> → {target.action === "delete" ? "删除（无替换值）" : <code>{target.afterText}</code>}</div>
              </li>)}</ol>
            </> : null}
            {batchError && !prepared ? <button type="button" className="button subtle" onClick={() => {
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
      confirmDisabled={Boolean(batch) && (loading || !prepared || !reviewerId || !trimmedReason || conflicted)}
      error={batchError || error || (!trimmedReason ? "请填写来源回滚原因。" : "")}
      extra={
        <><label className="configuration-workbench__source-review-reason">
          <span>回滚原因（必填）</span>
          <textarea
            aria-label="来源回滚原因"
            value={reason}
            disabled={pending || submitting || submittedOnce}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            placeholder="说明回滚原因与影响范围。"
          />
        </label>
        {batch ? <label className="configuration-workbench__source-review-reason">指定软件审核人
          <select value={reviewerId} disabled={loading || submitting || submittedOnce}
            onChange={(event) => setReviewerId(event.target.value)}>
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
