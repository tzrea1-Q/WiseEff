import { useEffect, useMemo, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { canonicalBatchConflictReady, createCanonicalConflictClient, type CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import type { ManualSyncPreparation, createCanonicalManualSyncClient } from "@/infrastructure/http/canonicalManualSyncClient";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

type ManualSyncContext = {
  projectId: string; fileId: string; fileName: string; format: "json" | "dts";
  currentVersionId: string; workflowProofToken: string; currentUserId: string;
  client: ReturnType<typeof createCanonicalManualSyncClient>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  conflictClient?: ReturnType<typeof createCanonicalConflictClient>;
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

export function WorkbenchCanonicalManualSyncDialog({ context, sourceState, onDismiss }: {
  context: ManualSyncContext;
  sourceState?: { currentVersionId: string | null; workflowProofToken: string | null;
    loading: boolean; error: string; canonical: boolean | null };
  onDismiss: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<ManualSyncPreparation | null>(null);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { choice: "file" | "draft"; draftId?: string }>>({});
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
  const conflictClient = useMemo(() => context.conflictClient ?? createCanonicalConflictClient(), [context.conflictClient]);
  const sourceChanged = Boolean(sourceState && !sourceState.loading && (
    sourceState.canonical === false
    || (sourceState.currentVersionId && sourceState.currentVersionId !== context.currentVersionId)
    || (sourceState.workflowProofToken && sourceState.workflowProofToken !== context.workflowProofToken)
  ));
  const sourceReady = !sourceState || Boolean(!sourceState.loading && !sourceState.error
    && sourceState.canonical && sourceState.currentVersionId === context.currentVersionId
    && sourceState.workflowProofToken === context.workflowProofToken);
  const unprovenConflicts = conflicts?.ineligible.filter((item) => item.reason !== "selected-draft-stale"
    && prepared?.targets.some((target) => target.bindingId === item.selectedBindingId)) ?? [];

  const resetSubmit = () => {
    submitRequestId.current = crypto.randomUUID();
    submitBody.current = null;
  };

  const chooseDecision = (bindingId: string, choice: "file" | "draft", draftId?: string) => {
    resetSubmit();
    setDecisions((current) => ({ ...current, [bindingId]: { choice, ...(draftId ? { draftId } : {}) } }));
  };

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
    setConflicts(null);
    setDecisions({});
    setReason("");
    setError("");
    setConflicted(false);
    setSubmitAttempted(false);
    prepareRequestId.current = crypto.randomUUID();
    resetSubmit();
    prepareBody.current = null;
  };

  const prepare = async () => {
    if (!file || busy || conflicted || !sourceReady) return;
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
      const discovered = await conflictClient.listCandidateSourceConflicts(context.projectId, proof.candidateId);
      if (discovered.items.some((item) => !canonicalBatchConflictReady(proof, item))) {
        setConflicted(true);
        throw new Error("冲突选项与原上传候选证明不一致；请刷新来源后重试。");
      }
      resetSubmit();
      setDecisions({});
      setConflicts(discovered);
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
    if (!prepared || !conflicts || !manualSyncProofReady(prepared, context) || !reviewerId || !reason.trim()
      || prepared.targets.some((target) => !decisions[target.bindingId])
      || busy || conflicted || loadingReviewers || !sourceReady || unprovenConflicts.length) return;
    const targetDecisions = prepared.targets.map((target) => {
      const decision = decisions[target.bindingId]!;
      const options = conflicts.items.filter((item) => item.selectedBindingId === target.bindingId);
      return { bindingId: target.bindingId, ...decision,
        ...(options.length ? { expectedConflictProofs: options.map((item) => ({
          draftId: item.selectedDraftId,
          decisionProofDigest: decision.choice === "draft" && decision.draftId === item.selectedDraftId
            ? item.choices.draft.decisionProofDigest : item.choices.file.decisionProofDigest
        })) } : {}) };
    });
    const body = submitBody.current ?? {
      candidateId: prepared.candidateId, expectedProofToken: prepared.proofToken,
      reason: reason.trim(), assignedToUserId: reviewerId, targetDecisions
    };
    submitBody.current = body;
    setSubmitAttempted(true);
    setBusy(true);
    setError("");
    try {
      const result = await context.client.submit(context.projectId, body, submitRequestId.current);
      const mixed = body.targetDecisions.some((decision) => decision.choice === "draft");
      const composition = result.compositionProof;
      const selectedDraftsMatch = composition?.targetDecisions.every((decision) => {
        if (!decision.draft) return true;
        const preview = conflicts.items.find((item) => item.selectedBindingId === decision.bindingId
          && item.selectedDraftId === decision.draft?.id);
        return Boolean(preview && decision.draft.authorUserId === preview.authorUserId
          && decision.draft.baseCurrentValueId === preview.choices.draft.selectedBaseValueId
          && decision.draft.sourcePinId === preview.choices.draft.selectedSourcePinId
          && decision.draft.configRevisionId === preview.choices.draft.selectedRevisionId
          && decision.draft.candidateSha256 === preview.choices.draft.selectedDraftCandidateDigest.replace(/^sha256:/, ""));
      });
      if (result.status !== "pending"
        || (mixed ? !composition || result.candidateId === prepared.candidateId
          || result.uploadCandidateId !== prepared.candidateId
          || result.candidateId !== composition.composedCandidateId
          || composition.uploadCandidateId !== prepared.candidateId
          || composition.uploadObject.proofToken !== prepared.proofToken
          || composition.composedObject.proofToken !== result.sourceProofToken
          || composition.cohortProofToken !== prepared.cohortProofToken
          || composition.batchProofDigest !== result.batchProofDigest
          || composition.draftImpactDigest !== result.draftImpactDigest
          || composition.decisionProofDigest !== result.decisionProofDigest
          || JSON.stringify(composition.members) !== JSON.stringify(prepared.members)
          || JSON.stringify(composition.cohort) !== JSON.stringify(prepared.cohort)
          || !selectedDraftsMatch
          || composition.targetDecisions.length !== body.targetDecisions.length
          || composition.targetDecisions.some((decision, index) => decision.ordinal !== index
            || decision.bindingId !== body.targetDecisions[index]?.bindingId
            || decision.choice !== body.targetDecisions[index]?.choice
            || (decision.draft?.id ?? undefined) !== body.targetDecisions[index]?.draftId)
          : result.candidateId !== prepared.candidateId || result.uploadCandidateId !== null
            || composition !== null || result.decisionProofDigest !== null
            || result.batchProofDigest !== prepared.batchProofDigest
            || result.sourceProofToken !== prepared.proofToken)
        || !result.draftImpact || !/^[0-9a-f]{64}$/.test(result.draftImpactDigest ?? "")
        || result.draftImpact.length !== prepared.cohort.length
        || result.draftImpact.some((entry, index) => {
          const member = prepared.cohort[index];
          const decision = body.targetDecisions.find((item) => item.bindingId === entry.bindingId);
          return !member || entry.ordinal !== index || entry.bindingId !== member.bindingId
            || entry.baseCurrentValueId !== member.oldValueId || entry.sourcePinId !== member.sourcePinId
            || (decision ? entry.role !== "target" || entry.decision !== decision.choice
              || entry.selectedDraftId !== decision.draftId
              : entry.role !== "sibling" || entry.decision !== "re-pin" || entry.selectedDraftId !== undefined);
        })
        || result.cohortCount !== prepared.cohort.length
        || result.cohortProofToken !== prepared.cohortProofToken
        || result.fileId !== context.fileId || result.baseVersionId !== context.currentVersionId
        || result.configSetId !== prepared.configSetId
        || result.assignedToUserId !== body.assignedToUserId
        || result.submitterUserId !== context.currentUserId
        || result.targets.length !== prepared.targets.length
        || result.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== prepared.targets[index]?.bindingId
          || target.action !== (composition
            ? composition.targetDecisions[index]?.action : prepared.targets[index]?.action)
          || target.sourcePinId !== prepared.targets[index]?.sourcePinId
          || target.decision !== body.targetDecisions[index]?.choice
          || target.draftId !== (body.targetDecisions[index]?.draftId ?? null)
          || target.targetText !== (composition
            ? composition.targetDecisions[index]?.targetText
            : prepared.targets[index]?.action === "delete" ? null : prepared.targets[index]?.afterText))) {
        setConflicted(true);
        throw new Error("服务端冻结请求与预览目标或证明不一致；请从提交记录核对。");
      }
      context.onSubmitted(result.id);
    } catch (cause) {
      if (cause instanceof WiseEffApiError && cause.code === "CONFLICT") setConflicted(true);
      setError(cause instanceof WiseEffApiError && cause.code === "CONFLICT"
        ? cause.details.reason === "canonical-batch-conflict-proof-stale"
          ? "竞争草稿或选择证明已变化（409），本次未创建待审请求。请关闭弹窗、刷新来源后重新预览选择。"
          : `来源已漂移或请求冲突（409）；请刷新工作台重新准备。${presentError(cause, "")}`
        : presentError(cause, "提交审核失败；可用同一请求重试。"));
    } finally { setBusy(false); }
  };

  return <ModalDialog open className="submission-dialog canonical-batch-submit-dialog canonical-manual-sync-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>上传 {context.format.toUpperCase()} 来源并准备批量审核</h2>
      <p id={descriptionId}>选择「{context.fileName}」的新内容；本文件须产生至少两个可验证目标。准备候选及提交待审请求不会改写当前 Value、来源 pin 或活跃文件版本；另一名审核人批准后才一次应用全部目标。</p>
      {sourceState?.loading ? <p role="status">正在重新核对文件版本与来源证明；已暂时阻止提交，上传和选择会保留。</p> : null}
      {sourceState?.error ? <p role="alert">当前来源核对失败，已阻止提交：{sourceState.error}。请关闭弹窗并刷新工作台。</p> : null}
      {sourceChanged ? <p role="alert">文件版本或来源证明已变化，旧候选不能继续提交；请关闭弹窗、刷新工作台后重新预览。</p> : null}
      {sourceState && !sourceState.loading && !sourceState.error && !sourceChanged
        && !sourceReady ? <p role="alert">当前来源暂不可核对，已阻止提交；请刷新工作台。</p> : null}
      <label>选择来源文件（不超过 2 MiB）<input type="file" accept={context.format === "json" ? ".json,application/json" : ".dts,text/plain"}
        disabled={busy || submitAttempted} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} /></label>
      {file ? <p>已选择：{file.name}（{file.size} 字节）；目标文件：{context.fileName}</p> : null}
      {file && (file.size === 0 || file.size > MAX_SOURCE_BYTES)
        ? <p role="alert">源文件必须非空且不超过 2 MiB；请重新选择文件。</p> : null}
      {prepared ? <>
        <p>候选 ID：<code>{prepared.candidateId}</code>；格式：{prepared.format.toUpperCase()}；完整有序目标 {prepared.targets.length} 项；来源 cohort {prepared.cohort.length} 项。</p>
        <p>候选证明：<code>{prepared.proofToken}</code>；批量证明摘要：<code>{prepared.batchProofDigest}</code></p>
        {prepared.baseDigest === prepared.proposedDigest ? <p role="status">上传文件与当前版本内容相同；如只需核查来源，可使用“来源一致性校验”。</p> : null}
        <ol aria-label="手动同步完整有序目标">{prepared.targets.map((target, index) => {
          const options = conflicts?.items.filter((item) => item.selectedBindingId === target.bindingId) ?? [];
          return <li key={target.bindingId}>
            目标 {index + 1}：{target.action === "delete" ? "删除" : "设置"} · Binding <code>{target.bindingId}</code> · 来源 pin <code>{target.sourcePinId}</code>
            <div>基线 <code>{target.beforeText}</code> → 上传文件值 {target.action === "delete" ? "删除" : <code>{target.afterText}</code>}</div>
            <fieldset disabled={busy || submitAttempted}>
              <legend>目标 {index + 1} 的最终选择</legend>
              <label><input type="radio" name={`decision-${target.bindingId}`}
                checked={decisions[target.bindingId]?.choice === "file"}
                onChange={() => chooseDecision(target.bindingId, "file")} />
                采用文件值{options.length ? "（已有竞争草稿，须明确选择）" : ""}</label>
              {options.map((item) => <label key={item.selectedDraftId}>
                <input type="radio" name={`decision-${target.bindingId}`}
                  checked={decisions[target.bindingId]?.choice === "draft"
                    && decisions[target.bindingId]?.draftId === item.selectedDraftId}
                  onChange={() => chooseDecision(target.bindingId, "draft", item.selectedDraftId)} />
                采用界面草稿 <code>{item.selectedDraftId}</code>（作者 <code>{item.authorUserId}</code>；值 {item.choices.draft.action === "delete"
                  ? "删除" : <code>{item.choices.draft.targetText}</code>}）</label>)}
            </fieldset>
            {conflicts?.ineligible.filter((item) => item.selectedBindingId === target.bindingId).map((item) =>
              <p role="status" key={item.selectedDraftId}>草稿 <code>{item.selectedDraftId}</code> 当前不可选（{item.reason}）。</p>)}
          </li>;
        })}</ol>
        <p role="note">其他 Binding 的草稿不会被选中；审核详情会展示其预计过期效果。</p>
        {unprovenConflicts.length ? <p role="alert">目标中有竞争草稿未取得可验证的选择证明；请刷新来源并重新预览，当前不能提交审核。</p> : null}
        <label>修改原因<textarea value={reason} disabled={busy || submitAttempted}
          onChange={(event) => { resetSubmit(); setReason(event.target.value); }} /></label>
        <label>指定软件审核人<select value={reviewerId} disabled={busy || loadingReviewers || submitAttempted}
          onChange={(event) => { resetSubmit(); setReviewerId(event.target.value); }}>
          {reviewers.length ? reviewers.map((reviewer) => <option key={reviewer.userId} value={reviewer.userId}>{reviewer.name}（{reviewer.userId}）</option>)
            : <option value="">没有可用的另一名软件审核人</option>}
        </select></label>
      </> : null}
      {loadingReviewers ? <p role="status">正在加载可指派审核人…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onDismiss}>取消</button>
        {!prepared ? <button type="button" disabled={!file || busy || conflicted || !sourceReady || file.size === 0 || file.size > MAX_SOURCE_BYTES}
          onClick={() => void prepare()}>{busy ? "准备中…" : prepareBody.current ? "重试准备" : "预览有序目标与证明"}</button>
          : <button type="button" disabled={busy || conflicted || !sourceReady || unprovenConflicts.length > 0
            || loadingReviewers || !reviewerId || !reason.trim()
            || prepared.targets.some((target) => !decisions[target.bindingId])}
            onClick={() => void submit()}>{busy ? "提交中…" : `一次提交全部 ${prepared.targets.length} 项审核`}</button>}
      </div>
    </>}
  </ModalDialog>;
}
