import { SelectControl } from "@/components/common/SelectControl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

type BatchBody = Parameters<NonNullable<ParameterCatalogRepository["submitProjectValueBatchChangeRequest"]>>[1] & {
  targetDecisions: NonNullable<Parameters<NonNullable<ParameterCatalogRepository["submitProjectValueBatchChangeRequest"]>>[1]["targetDecisions"]>;
};

export function CanonicalBatchSubmitDialog({ projectId, currentUserId, candidate, preview, repository,
  fileRepository, conflictClient, onDismiss, onSubmitted, governanceClient, inlineTarget, submissionBlockedReason = "", onSelectSingleConflict }: {
  projectId: string;
  currentUserId: string;
  candidate: ParameterFileCandidate;
  preview: ParameterFileSourcePreview;
  repository?: Pick<ParameterCatalogRepository, "getCatalog" | "submitProjectValueBatchChangeRequest">;
  fileRepository?: Pick<ParameterFileRepository, "getCandidateSourcePreview">;
  conflictClient?: Pick<ReturnType<typeof createCanonicalConflictClient>, "listCandidateSourceConflicts">;
  onDismiss?: () => void;
  onSubmitted: (requestId: string) => void;
  governanceClient?: Pick<ReturnType<typeof createUserGovernanceClient>, "getProjectWorkflowRoleBindings">;
  inlineTarget?: HTMLElement | null;
  submissionBlockedReason?: string;
  onSelectSingleConflict?: () => void;
}) {
  const inlineId = useId();
  const client = useMemo(() => governanceClient ?? createUserGovernanceClient(), [governanceClient]);
  const sourceConflicts = useMemo(() => conflictClient ?? createCanonicalConflictClient(), [conflictClient]);
  const [freshPreview, setFreshPreview] = useState<ParameterFileSourcePreview | null>(null);
  const [conflicts, setConflicts] = useState<CanonicalSourceConflictList | null>(null);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; name: string }>>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [reviewerId, setReviewerId] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [reviewerError, setReviewerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, { choice: "file" | "draft"; draftId?: string }>>({});
  const [refresh, setRefresh] = useState(0);
  const [attempted, setAttempted] = useState(false);
  const [stale, setStale] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const frozenBody = useRef<BatchBody | null>(null);
  const frozenReleaseId = useRef<string | null>(null);
  const verifiedSource = useRef("");
  const current = freshPreview;
  const bindings = current?.bindings ?? [];
  const conflictProof = conflicts?.items[0]?.choices.file;
  const receiptsMatch = Boolean(current && conflicts && (current.request
    ? conflicts.request?.id === current.request.id
      && conflicts.request.status === current.request.status
      && conflicts.request.kind === current.request.kind
    : !conflicts.request));
  const usableConflicts = Boolean(conflicts && current && conflicts.items.every((item) => {
    const binding = bindings.find((entry) => entry.bindingId === item.selectedBindingId);
    const file = item.choices.file;
    const draft = item.choices.draft;
    return binding && file.choice === "file" && draft.choice === "draft"
      && file.action === binding.action && file.targetText === binding.afterText
      && file.selectedDraftProof === draft.selectedDraftProof
      && file.selectedDraftCandidateId === draft.selectedDraftCandidateId
      && file.selectedDraftCandidateDigest === draft.selectedDraftCandidateDigest
      && [file, draft].every((choice) => choice.candidateId === candidate.id
        && choice.selectedBindingId === binding.bindingId && choice.selectedDraftId === item.selectedDraftId
        && choice.sourceProofToken === current.proofToken
        && choice.fileId === candidate.fileId && choice.baseVersionId === candidate.baseVersionId
        && choice.selectedSourcePinId === binding.sourcePinId
        && choice.selectedBaseValueId === binding.baseCurrentValueId
        && choice.selectedRevisionId === binding.configRevisionId
        && choice.configSetId === conflictProof?.configSetId
        && choice.cohortProofToken === conflictProof?.cohortProofToken
        && choice.sourceCandidateDigest === conflictProof?.sourceCandidateDigest
        && (!current.proposedDigest || choice.sourceCandidateDigest.replace(/^sha256:/, "") === current.proposedDigest.replace(/^sha256:/, ""))
        && JSON.stringify(choice.members) === JSON.stringify(conflictProof?.members)
        && JSON.stringify(choice.cohort) === JSON.stringify(conflictProof?.cohort)
        && /^[0-9a-f]{64}$/.test(choice.decisionProofDigest)
        && (choice.action === "delete" ? choice.targetText === undefined : choice.targetText !== undefined));
  }) && new Set(conflicts.items.map((item) => `${item.selectedBindingId}:${item.selectedDraftId}`)).size === conflicts.items.length
    && conflicts.ineligible.every((entry) => entry.reason === "selected-draft-stale"));
  const ready = !submissionBlockedReason && candidate.status === "ready" && current?.kind === "canonical"
    && current.candidateId === candidate.id && ["json", "dts"].includes(current.format.toLowerCase())
    && Boolean(current.proofToken) && bindings.length >= 2
    && permitsFreshBatchRequest(current.request) && receiptsMatch && usableConflicts
    && conflicts?.items.every((item) => decisions[item.selectedBindingId]?.choice === "file"
      || decisions[item.selectedBindingId]?.choice === "draft" && conflicts.items.some((option) =>
        option.selectedBindingId === item.selectedBindingId && option.selectedDraftId === decisions[item.selectedBindingId]?.draftId))
    && new Set(bindings.map((binding) => binding.bindingId)).size === bindings.length
    && bindings.every((binding) => binding.bindingId && binding.sourcePinId
      && (binding.action === "delete" || binding.afterText !== undefined));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingReviewers(true);
    setReviewerError(null);
    void client.getProjectWorkflowRoleBindings(projectId).then((result) => {
      if (cancelled) return;
      const eligible = result.bindings.filter((item) => item.isActive
        && item.userId !== currentUserId && item.roles.includes("software-committer"))
        .map((item) => ({ userId: item.userId, name: item.name }));
      setReviewers(eligible);
      setMemberNames(Object.fromEntries(result.bindings.map((member) => [member.userId, member.name])));
      setReviewerId((selected) => eligible.some((reviewer) => reviewer.userId === selected) ? selected : eligible.length === 1 ? eligible[0]!.userId : "");
    }).catch((cause) => {
      if (!cancelled) setReviewerError(presentError(cause, "加载软件审核人失败，请重试。"));
    }).finally(() => { if (!cancelled) setLoadingReviewers(false); });
    void Promise.all([
      fileRepository?.getCandidateSourcePreview(projectId, candidate.id) ?? Promise.resolve(preview),
      sourceConflicts.listCandidateSourceConflicts(projectId, candidate.id)]).then(([latest, discovered]) => {
      if (cancelled) return;
      setFreshPreview(latest);
      setConflicts(discovered);
      const sourceFingerprint = JSON.stringify([latest.proofToken, discovered.items]);
      const unchanged = verifiedSource.current === sourceFingerprint;
      verifiedSource.current = sourceFingerprint;
      setDecisions((selected) => unchanged ? selected : {});
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "核对候选变更或来源冲突失败，请重试。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [candidate.id, client, currentUserId, fileRepository, preview, projectId, refresh, sourceConflicts]);

  const submit = async () => {
    if (submissionBlockedReason || !ready || stale || busy || loading || loadingReviewers || reviewerError || !reviewerId || !reason.trim() || !current || !conflicts
      || !repository?.submitProjectValueBatchChangeRequest) return;
    setBusy(true);
    setError(null);
    let writeStarted = false;
    try {
      const catalogReleaseId = frozenReleaseId.current
        ?? (await repository.getCatalog()).item?.catalogReleaseId;
      if (!catalogReleaseId) throw new Error("当前参数发布信息不可用，暂不能提交。");
      frozenReleaseId.current = catalogReleaseId;
      const body = frozenBody.current ?? {
        candidateId: candidate.id, expectedProofToken: current.proofToken!,
        reason: reason.trim(), assignedToUserId: reviewerId,
        targetDecisions: bindings.map((binding) => ({ bindingId: binding.bindingId, ...(decisions[binding.bindingId] ?? { choice: "file" as const }),
          expectedConflictProofs: conflicts.items.filter((entry) => entry.selectedBindingId === binding.bindingId)
            .map((entry) => ({ draftId: entry.selectedDraftId,
              decisionProofDigest: decisions[binding.bindingId]?.choice === "draft" && decisions[binding.bindingId]?.draftId === entry.selectedDraftId
                ? entry.choices.draft.decisionProofDigest : entry.choices.file.decisionProofDigest })) }))
      };
      frozenBody.current = body;
      writeStarted = true;
      setAttempted(true);
      const { item } = await repository.submitProjectValueBatchChangeRequest(projectId, body,
        { catalogReleaseId, idempotencyKey: requestId.current });
      const mixed = body.targetDecisions.some((decision) => decision.choice === "draft");
      const composition = item.compositionProof;
      const selectedTargets = bindings.map((binding) => {
        const decision = body.targetDecisions.find((entry) => entry.bindingId === binding.bindingId)!;
        const selected = decision.choice === "draft" ? conflicts.items.find((entry) =>
          entry.selectedBindingId === binding.bindingId && entry.selectedDraftId === decision.draftId) : undefined;
        return { binding, decision, selected,
          action: selected?.choices.draft.action ?? binding.action,
          targetText: selected ? selected.choices.draft.targetText : binding.afterText };
      });
      if (item.status !== "pending" || item.projectId !== projectId
        || item.fileId !== candidate.fileId || item.baseVersionId !== candidate.baseVersionId
        || item.reason !== body.reason || item.assignedToUserId !== body.assignedToUserId || item.submitterUserId !== currentUserId
        || !/^[0-9a-f]{64}$/.test(item.batchProofDigest)
        || item.cohortCount < bindings.length || item.targets.length !== bindings.length
        || (conflictProof && (item.configSetId !== conflictProof.configSetId
          || item.cohortProofToken !== conflictProof.cohortProofToken || item.cohortCount !== conflictProof.cohort.length))
        || (mixed ? !composition || !conflictProof || item.candidateId === candidate.id
          || item.uploadCandidateId !== candidate.id || composition.uploadCandidateId !== candidate.id
          || composition.composedCandidateId !== item.candidateId
          || composition.projectId !== projectId || composition.fileId !== candidate.fileId
          || composition.baseVersionId !== candidate.baseVersionId || composition.format !== current.format.toLowerCase()
          || composition.configSetId !== item.configSetId || composition.configSetId !== conflictProof.configSetId
          || composition.uploadObject.proofToken !== current.proofToken
          || composition.uploadObject.sha256 !== conflictProof.sourceCandidateDigest.replace(/^sha256:/, "")
          || composition.composedObject.proofToken !== item.sourceProofToken
          || composition.cohortProofToken !== item.cohortProofToken || composition.cohortProofToken !== conflictProof.cohortProofToken
          || composition.batchProofDigest !== item.batchProofDigest
          || composition.draftImpactDigest !== item.draftImpactDigest
          || composition.decisionProofDigest !== item.decisionProofDigest
          || JSON.stringify(composition.members) !== JSON.stringify(conflictProof.members)
          || JSON.stringify(composition.cohort) !== JSON.stringify(conflictProof.cohort)
          || composition.cohort.length !== item.cohortCount
          || composition.targetDecisions.length !== selectedTargets.length
          || composition.targetDecisions.some((entry, index) => {
            const target = selectedTargets[index]!;
            const draft = target.selected?.choices.draft;
            return entry.ordinal !== index || entry.bindingId !== target.binding.bindingId
              || entry.choice !== target.decision.choice || entry.action !== target.action
              || entry.targetText !== (target.action === "delete" ? null : target.targetText)
              || (entry.draft?.id ?? undefined) !== target.decision.draftId
              || (draft ? !entry.draft || entry.draft.authorUserId !== target.selected!.authorUserId
                || entry.draft.baseCurrentValueId !== draft.selectedBaseValueId
                || entry.draft.sourcePinId !== draft.selectedSourcePinId
                || entry.draft.configRevisionId !== draft.selectedRevisionId
                || entry.draft.candidateSha256 !== draft.selectedDraftCandidateDigest.replace(/^sha256:/, "")
                : entry.draft !== null);
          })
          : item.candidateId !== candidate.id || item.uploadCandidateId !== null || composition !== null
            || item.decisionProofDigest !== null || item.sourceProofToken !== current.proofToken)
        || !item.draftImpact || !/^[0-9a-f]{64}$/.test(item.draftImpactDigest ?? "")
        || item.draftImpact.length !== item.cohortCount
        || new Set(item.draftImpact.map((entry) => entry.bindingId)).size !== item.cohortCount
        || item.draftImpact.some((entry, index) => {
          const target = selectedTargets.find((target) => target.binding.bindingId === entry.bindingId);
          const cohort = conflictProof?.cohort[index];
          return entry.ordinal !== index
            || (cohort && (entry.bindingId !== cohort.bindingId || entry.baseCurrentValueId !== cohort.oldValueId
              || entry.sourcePinId !== cohort.sourcePinId))
            || (target ? entry.role !== "target" || entry.decision !== target.decision.choice
              || entry.selectedDraftId !== target.decision.draftId
              || entry.baseCurrentValueId !== target.binding.baseCurrentValueId
              || entry.sourcePinId !== target.binding.sourcePinId || entry.configRevisionId !== target.binding.configRevisionId
              : entry.role !== "sibling" || entry.decision !== "re-pin" || entry.selectedDraftId !== undefined);
        })
        || selectedTargets.some((target) => !item.draftImpact!.some((entry) => entry.bindingId === target.binding.bindingId))
        || item.targets.some((target, index) => target.ordinal !== index
          || target.bindingId !== bindings[index].bindingId
          || target.sourcePinId !== bindings[index].sourcePinId
          || target.baseCurrentValueId !== bindings[index].baseCurrentValueId
          || target.configRevisionId !== bindings[index].configRevisionId
          || target.definitionId !== bindings[index].definitionId
          || target.decision !== selectedTargets[index]!.decision.choice
          || target.draftId !== (selectedTargets[index]!.decision.draftId ?? null)
          || target.action !== selectedTargets[index]!.action
          || target.targetText !== (selectedTargets[index]!.action === "delete" ? null : selectedTargets[index]!.targetText))) {
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

  const body = ({ titleId, descriptionId }: { titleId: string; descriptionId: string }) => <>
      <h2 id={titleId}>提交 {preview.format.toUpperCase()} 批量来源审核</h2>
      <div className="review-dialog__body">
      <p id={descriptionId}>{loading ? `正在核对「${candidate.fileName}」的变更…` : `「${candidate.fileName}」的 ${bindings.length} 项变更将在审核通过后整批应用。`}</p>
      {inlineTarget !== undefined && onSelectSingleConflict && receiptsMatch && conflicts?.items.length && !current?.request
        ? <button type="button" className="button subtle" disabled={busy || attempted || loading}
          onClick={onSelectSingleConflict}>单独处理一项冲突</button> : null}
      {submissionBlockedReason ? <p role="alert">{submissionBlockedReason}</p> : null}
      {current?.request ? <p role="status">{candidateReceiptMessage(current.request)}</p> : null}
      {conflicts && !receiptsMatch ? <p role="alert">候选与冲突回执不一致，请刷新后重新核对。</p> : null}
      {conflicts?.ineligible.some((entry) => entry.reason !== "selected-draft-stale") ? <p role="alert">存在不可处理的竞争草稿，不能提交；请刷新来源。</p> : null}
      <ol className="canonical-batch-submit-dialog__targets" aria-label="提交前批量目标">{bindings.map((binding, index) => <li key={binding.bindingId}>
        <strong>{index + 1}. {binding.displayPath ?? reviewLocator(binding.locator)}</strong>
        <div className="review-target-change"><code>{binding.beforeText}</code> → {binding.action === "delete" ? "删除属性" : <code>{binding.afterText}</code>}</div>
        {conflicts?.items.some((item) => item.selectedBindingId === binding.bindingId) ? <>
          <fieldset disabled={busy || attempted}>
            <legend>选择此目标的最终值</legend>
            <label><input type="radio" name={`${inlineId}-${binding.bindingId}`} checked={decisions[binding.bindingId]?.choice === "file"}
              onChange={() => { requestId.current = crypto.randomUUID(); frozenBody.current = null;
                frozenReleaseId.current = null; setDecisions((value) => ({ ...value, [binding.bindingId]: { choice: "file" } })); }} />采用文件值</label>
            {conflicts.items.filter((item) => item.selectedBindingId === binding.bindingId).map((item, draftIndex) =>
              <label key={item.selectedDraftId}><input type="radio" name={`${inlineId}-${binding.bindingId}`}
                checked={decisions[binding.bindingId]?.choice === "draft" && decisions[binding.bindingId]?.draftId === item.selectedDraftId}
                onChange={() => { requestId.current = crypto.randomUUID(); frozenBody.current = null;
                  frozenReleaseId.current = null; setDecisions((value) => ({ ...value, [binding.bindingId]: { choice: "draft", draftId: item.selectedDraftId } })); }} />
                采用界面草稿 {draftIndex + 1}（{memberNames[item.authorUserId] ?? "另一位项目成员"} · {item.choices.draft.action === "delete"
                  ? "删除属性" : <code>{item.choices.draft.targetText}</code>}）</label>)}
          </fieldset>
          <p>未选中的草稿会保留，审核通过后可能过期。</p>
        </> : null}
      </li>)}</ol>
      <div className="review-inspector__field"><Label htmlFor="batch-submit-reason">修改原因</Label><Textarea id="batch-submit-reason" required rows={4} placeholder="说明修改目的和核对依据" value={reason} onChange={(event) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReason(event.target.value); }} disabled={busy || attempted} /></div>
      <div className="review-inspector__field"><Label htmlFor="batch-submit-reviewer">指定软件审核人</Label><SelectControl id="batch-submit-reviewer" value={reviewerId} placeholder="选择软件审核人" disabled={busy || loadingReviewers || Boolean(reviewerError) || attempted} ariaLabel="指定软件审核人" ariaRequired
        onValueChange={(value) => { requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null; setReviewerId(value); }}
        options={reviewers.length ? reviewers.map((reviewer) => ({ value: reviewer.userId, label: reviewer.name }))
          : [{ value: "", label: loadingReviewers ? "正在加载审核人…" : reviewerError ? "审核人加载失败" : "没有可用的另一名软件审核人" }]} /></div>
      {loadingReviewers ? <p role="status">正在加载可指派审核人…</p> : null}
      {reviewerError ? <p role="alert">{reviewerError}</p> : null}
      {!loadingReviewers && !reviewerError && !reviewers.length ? <p role="status">需要另一名软件审核人。<a href={`/parameter-admin/projects/${encodeURIComponent(projectId)}/review-roles`} target="_blank" rel="noreferrer">配置审核角色</a></p> : null}
      {current?.request && (current.request.status === "pending" || current.request.status === "approved") ?
        <button type="button" className="button subtle" onClick={() => onSubmitted(current.request!.id)}>查看已有审核</button> : null}
      {(error || reviewerError) && (!attempted || stale) ? <button type="button" className="button subtle" disabled={loading || loadingReviewers || busy}
        onClick={() => { setFreshPreview(null); setConflicts(null); setLoading(true); setError(null);
          setStale(false); setAttempted(false);
          requestId.current = crypto.randomUUID(); frozenBody.current = null; frozenReleaseId.current = null;
          setRefresh((value) => value + 1); }}>重新核对提交内容</button> : null}
      {!loading && !error && !submissionBlockedReason && !conflicts?.items.some((item) => !decisions[item.selectedBindingId]) && !current?.request && !ready ? <p role="alert">来源内容不完整，暂不能提交。请返回候选核对。</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <ReviewProvenance entries={[{ label: "候选版本", value: candidate }, { label: "完整来源预览", value: current }, { label: "最新预览证明", value: current?.proofToken }, { label: "来源目标", value: bindings }, { label: "冲突详情", value: conflicts }, { label: "目标选择", value: decisions }]} />
      </div>
      <div className="dialog-actions review-dialog__footer">{inlineTarget === undefined && onDismiss ? <button type="button" className="button subtle" disabled={busy} onClick={onDismiss}>取消</button> : null}
        <button type="button" disabled={busy || loading || loadingReviewers || Boolean(reviewerError) || stale || !ready || !reviewerId || !reason.trim()
          || !repository?.submitProjectValueBatchChangeRequest} className="button primary" onClick={() => void submit()}>
          {busy ? "提交中…" : loading ? "正在核对…" : attempted && !stale ? "重试同一提交" : `提交 ${bindings.length} 项审核`}
        </button></div>
    </>;
  if (inlineTarget !== undefined) return inlineTarget ? createPortal(
    <section className="canonical-batch-submit-dialog review-dialog" aria-labelledby={`${inlineId}-title`}>
      {body({ titleId: `${inlineId}-title`, descriptionId: `${inlineId}-description` })}
    </section>, inlineTarget) : null;
  return <ModalDialog open className="submission-dialog review-dialog canonical-batch-submit-dialog" onDismiss={busy ? undefined : onDismiss} describedBy>
    {body}
  </ModalDialog>;
}
