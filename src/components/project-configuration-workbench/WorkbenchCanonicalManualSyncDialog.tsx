import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { createUserGovernanceClient } from "@/infrastructure/http/userGovernanceClient";
import { canonicalBatchConflictReady, createCanonicalConflictClient, type CanonicalSourceConflictList } from "@/infrastructure/http/canonicalConflictClient";
import type { ManualSyncPreparation, createCanonicalManualSyncClient } from "@/infrastructure/http/canonicalManualSyncClient";
import { candidateReceiptMessage, permitsFreshBatchRequest } from "@/application/project-configuration/candidateRequestReceipt";
import { serializeContract } from "../../../server/modules/parameter-catalog-contract";
import { reviewLocator } from "@/features/parameter-review/ReviewSourceDiff";
import { ReviewProvenance } from "@/features/parameter-review/ReviewProvenance";

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

type ManualSyncContext = {
  projectId: string; fileId: string; fileName: string; format: "json" | "dts";
  currentVersionId: string; workflowProofToken: string; currentUserId: string;
  client: ReturnType<typeof createCanonicalManualSyncClient>;
  governanceClient?: ReturnType<typeof createUserGovernanceClient>;
  conflictClient?: ReturnType<typeof createCanonicalConflictClient>;
  onSubmitted: (requestId: string) => void;
  onOpenExisting?: (requestId: string) => void;
};

export function manualSyncProofReady(proof: ManualSyncPreparation,
  context: Pick<ManualSyncContext, "projectId" | "fileId" | "format" | "currentVersionId" | "workflowProofToken">): boolean {
  const ids = proof.targets.map((target) => target.bindingId);
  const cohort = new Map(proof.cohort.map((item) => [item.bindingId, item]));
  return (proof.kind === "canonical-source-batch"
    ? /^[0-9a-f]{64}$/.test(proof.batchProofDigest) && proof.targets.length >= 2
    : proof.kind === "canonical-source-single" && proof.targets.length === 1
      && Boolean(proof.configRevisionId) && proof.targets[0]?.configRevisionId === proof.configRevisionId)
    && proof.projectId === context.projectId
    && proof.fileId === context.fileId && proof.format === context.format
    && proof.baseVersionId === context.currentVersionId
    && proof.cohortProofToken === context.workflowProofToken
    && Boolean(proof.candidateId && proof.proofToken)
    && proof.cohort.length >= proof.targets.length
    && new Set(ids).size === ids.length && cohort.size === proof.cohort.length
    && ids.every((id, index) => index === 0 || ids[index - 1]! < id)
    && proof.members.length > 0
    && new Set(proof.members.map((member) => member.memberId)).size === proof.members.length
    && proof.members.some((member) => member.isCandidateFile && member.fileId === context.fileId)
    && (proof.kind === "canonical-source-batch" || (proof.members.filter((member) => member.isCandidateFile).length === 1
      && proof.members.every((member) => member.configSetId === proof.configSetId)
      && proof.members.some((member) => member.isCandidateFile && member.fileId === context.fileId
        && member.fileVersionId === proof.baseVersionId && member.format === context.format)))
    && proof.targets.every((target) => {
      const source = cohort.get(target.bindingId);
      return source?.sourcePinId === target.sourcePinId
        && source.oldValueId === target.baseCurrentValueId
        && source.definitionId === target.definitionId
        && (proof.kind === "canonical-source-batch" || (source.configSetId === proof.configSetId
          && JSON.stringify(source.locator) === JSON.stringify(target.locator)))
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
  const valueId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [prepared, setPrepared] = useState<ManualSyncPreparation | null>(null);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { choice: "file" | "draft"; draftId?: string }>>({});
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [reviewersError, setReviewersError] = useState("");
  const [reviewerRetry, setReviewerRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [error, setError] = useState("");
  const prepareRequestId = useRef(crypto.randomUUID());
  const submitRequestId = useRef(crypto.randomUUID());
  const prepareBody = useRef<Parameters<ManualSyncContext["client"]["prepare"]>[2] | null>(null);
  const submitBody = useRef<Parameters<ManualSyncContext["client"]["submit"]>[1] | null>(null);
  const singleBody = useRef<{ source: Parameters<ManualSyncContext["client"]["submitSingle"]>[2];
    conflict?: Parameters<ReturnType<typeof createCanonicalConflictClient>["submitCandidateSourceConflict"]>[2] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  const receiptAllowsSubmit = Boolean(conflicts && permitsFreshBatchRequest(conflicts.request));

  const resetSubmit = () => {
    submitRequestId.current = crypto.randomUUID();
    submitBody.current = null;
    singleBody.current = null;
  };

  const chooseDecision = (bindingId: string, choice: "file" | "draft", draftId?: string) => {
    resetSubmit();
    setDecisions((current) => ({ ...current, [bindingId]: { choice, ...(draftId ? { draftId } : {}) } }));
  };

  useEffect(() => {
    let cancelled = false;
    setLoadingReviewers(true);
    setReviewersError("");
    void governance.getProjectWorkflowRoleBindings(context.projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== context.currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setReviewerId((current) => eligible.some((reviewer) => reviewer.userId === current) ? current : eligible[0]?.userId ?? "");
    }).catch((cause) => { if (!cancelled) setReviewersError(presentError(cause, "加载软件审核人失败，请重试。")); })
      .finally(() => { if (!cancelled) setLoadingReviewers(false); });
    return () => { cancelled = true; };
  }, [context.currentUserId, context.projectId, governance, reviewerRetry]);

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
          ? "上传内容未形成可验证的目标变更，或修改了非目标区域（409）。请检查文件中的实际修改后重新选择。"
          : cause.details.reason === "canonical-batch-targets-required"
            ? "当前文件未形成至少两个可验证的变更目标（409）；配置总绑定数不代表本文件目标数。请检查上传文件后重新选择。"
          : `来源或证明已变化（409）；请刷新工作台重新选择文件。${presentError(cause, "")}`
        : presentError(cause, "准备上传候选失败；可用同一请求重试。"));
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!prepared || !conflicts || !manualSyncProofReady(prepared, context) || !reviewerId || !reason.trim()
      || prepared.targets.some((target) => !decisions[target.bindingId])
      || busy || conflicted || loadingReviewers || reviewersError || !sourceReady || unprovenConflicts.length
      || !receiptAllowsSubmit) return;
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
    if (prepared.kind === "canonical-source-batch") submitBody.current = body;
    setSubmitAttempted(true);
    setBusy(true);
    setError("");
    try {
      if (prepared.kind === "canonical-source-single") {
        const target = prepared.targets[0]!;
        const decision = decisions[target.bindingId]!;
        const options = conflicts.items.filter((item) => item.selectedBindingId === target.bindingId);
        const selected = decision.choice === "draft"
          ? options.find((item) => item.selectedDraftId === decision.draftId) : options[0];
        if (options.length > 1 && decision.choice === "file") {
          throw new Error("单目标有多个竞争草稿；请选择一个具体草稿，刷新来源后重试。");
        }
        if (decision.choice === "draft" && !selected) throw new Error("所选草稿证明不可用，请重新准备。");
        const frozen = singleBody.current ?? { source: {
          expectedCurrentVersionId: prepared.baseVersionId, expectedProofToken: prepared.proofToken,
          expectedWorkflowProofToken: prepared.cohortProofToken, reason: reason.trim(), assignedToUserId: reviewerId
        }, ...(selected ? { conflict: {
          selectedBindingId: target.bindingId, selectedDraftId: selected.selectedDraftId,
          choice: decision.choice, expectedDecisionProofDigest: selected.choices[decision.choice].decisionProofDigest,
          reason: reason.trim(), assignedToUserId: reviewerId
        } } : {}) };
        singleBody.current = frozen;
        const result = frozen.conflict
          ? await conflictClient.submitCandidateSourceConflict(context.projectId, prepared.candidateId, frozen.conflict, submitRequestId.current)
          : await context.client.submitSingle(context.projectId, prepared.candidateId, frozen.source, submitRequestId.current);
        const { receipt, diff } = await context.client.readSingleReceipt(context.projectId, result.requestId);
        const chosen = selected?.choices[frozen.conflict?.choice ?? "file"];
        if ((result.status !== "pending" && result.status !== "approved") || receipt.status !== result.status
          || receipt.projectId !== context.projectId || receipt.submitterUserId !== context.currentUserId
          || receipt.assignedToUserId !== frozen.source.assignedToUserId || receipt.reason.trim() !== frozen.source.reason
          || receipt.bindingId !== target.bindingId || receipt.definitionId !== target.definitionId
          || receipt.sourcePinId !== target.sourcePinId || receipt.baseCurrentValueId !== target.baseCurrentValueId
          || receipt.baseRevisionId !== target.configRevisionId || receipt.sourceFormat !== prepared.format
          || receipt.action !== (chosen?.action ?? target.action)
          || (receipt.action === "set" && (prepared.format === "json"
            ? serializeContract(JSON.parse(receipt.sourceTarget?.sourceText ?? receipt.targetValue))
              !== serializeContract(JSON.parse(chosen?.targetText ?? target.afterText!))
            : receipt.targetValue !== (chosen?.targetText ?? target.afterText)))
          || "kind" in diff || diff.requestId !== result.requestId || diff.candidateId !== receipt.candidateId
          || diff.bindingId !== target.bindingId || diff.sourcePinId !== target.sourcePinId
          || diff.format !== prepared.format || diff.baseDigest.replace(/^sha256:/, "") !== prepared.baseDigest
          || JSON.stringify(diff.bindings) !== JSON.stringify(prepared.cohort)
          || diff.before !== prepared.before
          || diff.proposedDigest.replace(/^sha256:/, "") !== (chosen?.choice === "draft"
            ? chosen.selectedDraftCandidateDigest.replace(/^sha256:/, "") : prepared.proposedDigest)
          || (decision.choice === "file" && diff.after !== prepared.after)) {
          setConflicted(true);
          throw new Error("服务端单目标请求与冻结的来源、作者或审核人证明不一致；请从提交记录核对。");
        }
        context.onSubmitted(result.requestId);
        return;
      }
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

  return <ModalDialog open className="submission-dialog review-dialog canonical-batch-submit-dialog canonical-manual-sync-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {({ titleId, descriptionId }) => <>
      <h2 id={titleId}>上传 {context.format.toUpperCase()} 来源并准备审核</h2>
      <div className="review-dialog__body">
      <p id={descriptionId}>上传「{context.fileName}」的新内容，预览变更并选择审核人；另一名审核人批准后才更新配置。</p>
      {sourceState?.loading ? <p role="status">正在重新核对文件版本与来源证明；已暂时阻止提交，上传和选择会保留。</p> : null}
      {sourceState?.error ? <p role="alert">当前来源核对失败，已阻止提交：{sourceState.error}。请关闭弹窗并刷新工作台。</p> : null}
      {sourceChanged ? <p role="alert">文件版本或来源证明已变化，旧候选不能继续提交；请关闭弹窗、刷新工作台后重新预览。</p> : null}
      {sourceState && !sourceState.loading && !sourceState.error && !sourceChanged
        && !sourceReady ? <p role="alert">当前来源暂不可核对，已阻止提交；请刷新工作台。</p> : null}
      <input ref={fileInputRef} type="file" hidden aria-label="选择来源文件（不超过 2 MiB）"
        accept={context.format === "json" ? ".json,application/json" : ".dts,text/plain"}
        disabled={busy || submitAttempted} onChange={(event) => {
          chooseFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }} />
      <button className="button subtle" type="button" disabled={busy || submitAttempted} onClick={() => fileInputRef.current?.click()}>{file ? "更换来源文件" : "选择来源文件"}</button>
      <p>{file ? `${file.name}（${file.size} 字节）` : `${context.format.toUpperCase()} 文件，不超过 2 MiB`}</p>
      {file && (file.size === 0 || file.size > MAX_SOURCE_BYTES)
        ? <p role="alert">源文件必须非空且不超过 2 MiB；请重新选择文件。</p> : null}
      {prepared ? <>
        {conflicts?.request ? <p role="status">{candidateReceiptMessage(conflicts.request)}</p> : null}
        {conflicts?.request && !receiptAllowsSubmit && context.onOpenExisting ?
          <button type="button" className="button subtle" onClick={() => context.onOpenExisting?.(conflicts.request!.id)}>查看已有审核</button> : null}
        <p>本次涉及 {prepared.targets.length} 项变更，关联 {prepared.cohort.length} 项参数。</p>
        {prepared.kind === "canonical-source-single" ? <details><summary>完整来源变更</summary>
          <pre className="parameter-value-content" aria-label="来源更新前完整内容" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete source values support keyboard scrolling. */}>{prepared.before}</pre>
          <pre className="parameter-value-content" aria-label="来源更新后完整内容" tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete source values support keyboard scrolling. */}>{prepared.after}</pre>
        </details> : null}
        {prepared.baseDigest === prepared.proposedDigest ? <p role="status">上传文件与当前版本内容相同，无需更新。</p> : null}
        <ol aria-label="手动同步完整有序目标">{prepared.targets.map((target, index) => {
          const options = conflicts?.items.filter((item) => item.selectedBindingId === target.bindingId) ?? [];
          return <li key={target.bindingId}>
            变更 {index + 1}：{reviewLocator(target.locator)} · {target.action === "delete" ? "删除" : "设置"}
            <div>基线<pre className="parameter-value-content" aria-label={`目标 ${index + 1} 基线完整值`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete baseline values support keyboard scrolling. */}>{target.beforeText}</pre></div>
            <div>上传文件值<pre id={`${valueId}-${index}-file`} className="parameter-value-content" aria-label={`目标 ${index + 1} 上传文件完整值`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete upload values support keyboard scrolling. */}>{target.action === "delete" ? "删除" : target.afterText}</pre></div>
            <fieldset disabled={busy || submitAttempted}>
              <legend>目标 {index + 1} 的最终选择</legend>
              <label><input type="radio" name={`decision-${target.bindingId}`}
                aria-describedby={`${valueId}-${index}-file`}
                checked={decisions[target.bindingId]?.choice === "file"}
                onChange={() => chooseDecision(target.bindingId, "file")} />
                采用文件值{options.length ? "（已有竞争草稿，须明确选择）" : ""}</label>
              {options.map((item, draftIndex) => <div key={item.selectedDraftId}><label>
                <input type="radio" name={`decision-${target.bindingId}`}
                  aria-describedby={`${valueId}-${index}-draft-${draftIndex}`}
                  checked={decisions[target.bindingId]?.choice === "draft"
                    && decisions[target.bindingId]?.draftId === item.selectedDraftId}
                  onChange={() => chooseDecision(target.bindingId, "draft", item.selectedDraftId)} />
                采用界面草稿 {draftIndex + 1}</label>
                <pre id={`${valueId}-${index}-draft-${draftIndex}`} className="parameter-value-content" aria-label={`目标 ${index + 1} 草稿 ${draftIndex + 1} 完整值`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- Complete draft values support keyboard scrolling. */}>{item.choices.draft.action === "delete" ? "删除" : item.choices.draft.targetText}</pre>
              </div>)}
            </fieldset>
            {conflicts?.ineligible.filter((item) => item.selectedBindingId === target.bindingId).map((item) =>
              <p role="status" key={item.selectedDraftId}>有一份草稿暂不可选，请重新核对来源。</p>)}
          </li>;
        })}</ol>
        <p role="note">其他参数的草稿保留，审核详情将列出受影响的草稿。</p>
        {unprovenConflicts.length ? <p role="alert">目标中有竞争草稿未取得可验证的选择证明；请刷新来源并重新预览，当前不能提交审核。</p> : null}
        <label className="configuration-workbench__source-review-reason">修改原因<textarea value={reason} disabled={busy || submitAttempted}
          onChange={(event) => { resetSubmit(); setReason(event.target.value); }} /></label>
        <label>指定软件审核人<SelectControl
          value={reviewerId}
          disabled={busy || loadingReviewers || Boolean(reviewersError) || submitAttempted}
          onValueChange={(value) => { resetSubmit(); setReviewerId(value); }}
          ariaLabel="指定软件审核人"
          options={reviewers.length ? reviewers.map((reviewer) => ({ value: reviewer.userId, label: reviewer.name })) : [{ value: "", label: loadingReviewers ? "正在加载审核人…" : reviewersError ? "审核人加载失败" : "没有可用的另一名软件审核人" }]}
        /></label>
        <ReviewProvenance entries={[
          { label: "来源身份", value: { projectId: context.projectId, fileId: context.fileId, currentVersionId: context.currentVersionId, workflowProofToken: context.workflowProofToken } },
          { label: "完整来源预览", value: prepared }, { label: "冲突与草稿", value: conflicts }, { label: "目标选择", value: decisions }
        ]} />
      </> : null}
      {loadingReviewers ? <p role="status">正在加载可指派审核人…</p> : null}
      {reviewersError ? <p role="alert">{reviewersError}</p> : null}
      {reviewersError ? <button className="button subtle" type="button" disabled={busy || loadingReviewers || submitAttempted}
        onClick={() => setReviewerRetry((value) => value + 1)}>重新加载审核人</button> : null}
      {!loadingReviewers && !reviewersError && !reviewers.length ? <p role="status">需要另一名软件审核人。<a href={`/parameter-admin/projects/${encodeURIComponent(context.projectId)}/review-roles`} target="_blank" rel="noreferrer">配置审核角色</a></p> : null}
      {error ? <p role="alert">{error}</p> : null}
      </div>
      <div className="dialog-actions review-dialog__footer">
        <button className="button subtle" type="button" disabled={busy} onClick={onDismiss}>取消</button>
        {!prepared ? <button className="button primary" type="button" disabled={!file || busy || conflicted || !sourceReady || file.size === 0 || file.size > MAX_SOURCE_BYTES}
          onClick={() => void prepare()}>{busy ? "准备中…" : prepareBody.current ? "重试准备" : "预览变更"}</button>
          : <button className="button primary" type="button" disabled={busy || conflicted || !sourceReady || !receiptAllowsSubmit || unprovenConflicts.length > 0
            || loadingReviewers || Boolean(reviewersError) || !reviewerId || !reason.trim()
            || prepared.targets.some((target) => !decisions[target.bindingId])}
            onClick={() => void submit()}>{busy ? "提交中…" : `提交 ${prepared.targets.length} 项变更审核`}</button>}
      </div>
    </>}
  </ModalDialog>;
}
