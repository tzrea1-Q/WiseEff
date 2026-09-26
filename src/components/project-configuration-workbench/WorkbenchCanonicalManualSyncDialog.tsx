import { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import type { ManualSyncPreparation, createCanonicalManualSyncClient } from "@/infrastructure/http/canonicalManualSyncClient";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

type ManualSyncContext = {
  projectId: string; fileId: string; fileName: string; format: "json" | "dts";
  currentVersionId: string; workflowProofToken: string; currentUserId: string;
  client: ReturnType<typeof createCanonicalManualSyncClient>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  onSubmitted: (requestId: string) => void;
};

export function manualSyncProofReady(proof: ManualSyncPreparation,
  context: Pick<ManualSyncContext, "projectId" | "fileId" | "format" | "currentVersionId" | "workflowProofToken">): boolean {
  const ids = proof.targets.map((target) => target.bindingId);
  const cohort = new Map(proof.cohort.map((item) => [item.bindingId, item]));
  return proof.kind === "canonical-source-batch" && proof.projectId === context.projectId
    && proof.fileId === context.fileId && proof.format === context.format
    && proof.baseVersionId === context.currentVersionId
    && proof.cohortProofToken === context.workflowProofToken
    && Boolean(proof.candidateId && proof.proofToken)
    && /^[0-9a-f]{64}$/.test(proof.batchProofDigest)
    && proof.targets.length >= 2 && proof.cohort.length >= proof.targets.length
    && new Set(ids).size === ids.length && cohort.size === proof.cohort.length
    && ids.every((id, index) => index === 0 || ids[index - 1]! < id)
    && proof.members.length > 0
    && new Set(proof.members.map((member) => member.memberId)).size === proof.members.length
    && proof.members.some((member) => member.isCandidateFile && member.fileId === context.fileId)
    && proof.targets.every((target) => {
      const source = cohort.get(target.bindingId);
      return source?.sourcePinId === target.sourcePinId
        && source.oldValueId === target.baseCurrentValueId
        && source.definitionId === target.definitionId
        && (target.action === "delete" ? target.afterText === undefined
          : target.afterText !== undefined && (target.targetText === undefined || target.targetText === target.afterText));
    });
}

async function encodeFile(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function WorkbenchCanonicalManualSyncDialog({ context, onDismiss }: {
  context: ManualSyncContext; onDismiss: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<ManualSyncPreparation | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [error, setError] = useState("");
  const prepareRequestId = useRef(crypto.randomUUID());
  const submitRequestId = useRef(crypto.randomUUID());
  const prepareBody = useRef<Parameters<ManualSyncContext["client"]["prepare"]>[2] | null>(null);
  const submitBody = useRef<Parameters<ManualSyncContext["client"]["submit"]>[1] | null>(null);
  const governance = useMemo(() => context.governanceClient ?? createUserGovernanceClient(), [context.governanceClient]);

  useEffect(() => {
    let cancelled = false;
    void governance.getProjectWorkflowRoleBindings(context.projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== context.currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId(eligible[0]?.userId ?? "");
    }).catch((cause) => { if (!cancelled) setError(presentError(cause, "加载软件审核人失败。")); })
      .finally(() => { if (!cancelled) setLoadingReviewers(false); });
    return () => { cancelled = true; };
  }, [context.currentUserId, context.projectId, governance]);

  const chooseFile = (chosen: File | null) => {
    setFile(chosen);
    setPrepared(null);
    setReason("");
    setError("");
    setConflicted(false);
    setSubmitAttempted(false);
    prepareRequestId.current = crypto.randomUUID();
    submitRequestId.current = crypto.randomUUID();
    prepareBody.current = null;
    submitBody.current = null;
  };

  const prepare = async () => {
    if (!file || busy || conflicted) return;
    if (file.size === 0 || file.size > MAX_SOURCE_BYTES) {
      setError("源文件必须非空且不超过 2 MiB；请重新选择文件。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = prepareBody.current ?? {
        contentBase64: await encodeFile(file),
        expectedCurrentVersionId: context.currentVersionId,
        expectedWorkflowProofToken: context.workflowProofToken
      };
      prepareBody.current = body;
      const proof = await context.client.prepare(context.projectId, context.fileId, body, prepareRequestId.current);
      if (!manualSyncProofReady(proof, context)) {
        setConflicted(true);
        throw new Error("候选目标、顺序或来源证明不完整；已阻止提交，请刷新工作台重新选择文件。");
      }
      setPrepared(proof);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setConflicted(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? cause.details.reason === "candidate-changed-unbound-or-non-target-bytes"
          ? "上传内容未形成可验证的目标变更，或修改了非目标区域（409）。请检查文件并重新选择；只需核查当前来源时可使用“来源一致性校验”。"
          : cause.details.reason === "canonical-batch-writer-unavailable"
            ? "当前文件未形成至少两个可验证的变更目标（409）；配置集总绑定数不代表本文件目标数。请检查上传文件后重新选择。"
          : `来源或证明已变化（409）；请刷新工作台重新选择文件。${presentError(cause, "")}`
        : presentError(cause, "准备上传候选失败；可用同一请求重试。"));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!prepared || !manualSyncProofReady(prepared, context) || !reviewerId || !reason.trim()
      || busy || conflicted || loadingReviewers) return;
    const body = submitBody.current ?? {
      candidateId: prepared.candidateId, expectedProofToken: prepared.proofToken,
      reason: reason.trim(), assignedToUserId: reviewerId
    };
    submitBody.current = body;
    setSubmitAttempted(true);
    setBusy(true);
    setError("");
    try {
      const result = await context.client.submit(context.projectId, body, submitRequestId.current);
      if (result.status !== "pending" || result.candidateId !== prepared.candidateId
        || result.batchProofDigest !== prepared.batchProofDigest
        || result.cohortCount !== prepared.cohort.length
        || result.sourceProofToken !== prepared.proofToken
        || result.cohortProofToken !== prepared.cohortProofToken
        || result.fileId !== context.fileId || result.baseVersionId !== context.currentVersionId
        || result.configSetId !== prepared.configSetId
        || result.assignedToUserId !== body.assignedToUserId
        || result.submitterUserId !== context.currentUserId
        || result.targets.length !== prepared.targets.length
        || result.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== prepared.targets[index]?.bindingId
          || target.action !== prepared.targets[index]?.action
          || target.sourcePinId !== prepared.targets[index]?.sourcePinId
          || target.targetText !== (prepared.targets[index]?.action === "delete" ? null : prepared.targets[index]?.afterText))) {
        setConflicted(true);
        throw new Error("服务端冻结请求与预览目标或证明不一致；请从提交记录核对。");
      }
      context.onSubmitted(result.id);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setConflicted(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? `来源已漂移或请求冲突（409）；请刷新工作台重新准备。${presentError(cause, "")}`
        : presentError(cause, "提交审核失败；可用同一请求重试。"));
    } finally { setBusy(false); }
  };

  return <ModalDialog open className="submission-dialog canonical-batch-submit-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>上传 {context.format.toUpperCase()} 来源并准备批量审核</h2>
      <p id={descriptionId}>选择「{context.fileName}」的新内容；本文件须产生至少两个可验证目标。准备候选及提交待审请求不会改写当前 Value、来源 pin 或活跃文件版本；另一名审核人批准后才一次应用全部目标。</p>
      <label>选择来源文件（不超过 2 MiB）<input type="file" accept={context.format === "json" ? ".json,application/json" : ".dts,text/plain"}
        disabled={busy || submitAttempted} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /></label>
      {file ? <p>已选择：{file.name}（{file.size} 字节）；目标文件：{context.fileName}</p> : null}
      {file && (file.size === 0 || file.size > MAX_SOURCE_BYTES)
        ? <p role="alert">源文件必须非空且不超过 2 MiB；请重新选择文件。</p> : null}
      {prepared ? <>
        <p>候选 ID：<code>{prepared.candidateId}</code>；格式：{prepared.format.toUpperCase()}；完整有序目标 {prepared.targets.length} 项；来源 cohort {prepared.cohort.length} 项。</p>
        <p>候选证明：<code>{prepared.proofToken}</code>；批量证明摘要：<code>{prepared.batchProofDigest}</code></p>
        {prepared.baseDigest === prepared.proposedDigest ? <p role="status">上传文件与当前版本内容相同；如只需核查来源，可使用“来源一致性校验”。</p> : null}
        <ol aria-label="手动同步完整有序目标">{prepared.targets.map((target, index) => <li key={target.bindingId}>
          目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"} · Binding <code>{target.bindingId}</code> · 来源 pin <code>{target.sourcePinId}</code>
          <div>基线 <code>{target.beforeText}</code> → {target.action === "delete" ? "删除（无替换值）" : <code>{target.afterText}</code>}</div>
        </li>)}</ol>
        <label>修改原因<textarea value={reason} disabled={busy || submitAttempted}
          onChange={(event) => setReason(event.target.value)} /></label>
        <label>指定软件审核人<select value={reviewerId} disabled={busy || loadingReviewers || submitAttempted}
          onChange={(event) => setReviewerId(event.target.value)}>
          {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
            : <option value="">没有可用的另一名软件审核人</option>}
        </select></label>
      </> : null}
      {loadingReviewers ? <p role="status">正在加载可指派审核人…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onDismiss}>取消</button>
        {!prepared ? <button type="button" disabled={!file || busy || conflicted || file.size === 0 || file.size > MAX_SOURCE_BYTES}
          onClick={() => void prepare()}>{busy ? "准备中…" : prepareBody.current ? "重试准备" : "预览有序目标与证明"}</button>
          : <button type="button" disabled={busy || conflicted || loadingReviewers || !reviewerId || !reason.trim()}
            onClick={() => void submit()}>{busy ? "提交中…" : `一次提交全部 ${prepared.targets.length} 项审核`}</button>}
      </div>
    </>}
  </ModalDialog>;
}
