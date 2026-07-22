import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Send, X } from "lucide-react";

import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import type { BindingDraftResult } from "@/application/ports/ParameterTopologyRepository";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";

export type PendingBindingDraft = BindingDraftResult & {
  projectId: string;
  currentRawValue: string;
  reason: string;
};

export type DtsBindingDraftTrayProps = {
  projectId: string;
  drafts: PendingBindingDraft[];
  /** When non-empty, only these binding ids are included in submit. Empty = submit all drafts. */
  selectedBindingIds?: ReadonlySet<string>;
  candidates: WorkflowAssigneeCandidates | null;
  candidatesError?: string | null;
  externalBlocker?: string | null;
  onRemove: (draftId: string) => void;
  onSubmit?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate: (path: string) => void;
};

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function identityBlocker(projectId: string, drafts: PendingBindingDraft[]): string | null {
  const incomplete = drafts.some((draft) =>
    draft.projectId !== projectId ||
    !nonBlank(draft.draftId) ||
    !nonBlank(draft.candidateRevisionId) ||
    !nonBlank(draft.projectParameterBindingId) ||
    !nonBlank(draft.parameterSpecId) ||
    !nonBlank(draft.writeTarget.propertyKey) ||
    !nonBlank(draft.reason)
  );
  return incomplete ? "草稿缺少完整的项目、candidate、binding 或规格身份，已阻止提交。" : null;
}

function candidateBlocker(drafts: PendingBindingDraft[]): string | null {
  const candidateIds = new Set(drafts.map((draft) => draft.candidateRevisionId));
  return candidateIds.size > 1
    ? "本轮修改属于不同 candidate revision，当前不能批量提交；请仅保留同一 candidate 的草稿。"
    : null;
}

function actionValueBlocker(drafts: PendingBindingDraft[]): string | null {
  const emptySet = drafts.some((draft) => draft.action === "set" && !nonBlank(draft.rawText));
  if (emptySet) {
    return "set action 必须携带非空 rawText，已阻止提交。";
  }
  const valuedDelete = drafts.some((draft) => draft.action === "delete" && draft.rawText !== "");
  return valuedDelete
    ? "delete action 必须携带精确空 tombstone rawText，已阻止提交。"
    : null;
}

function draftBatchSignature(projectId: string, drafts: PendingBindingDraft[]): string {
  const items = drafts
    .map((draft) => ({
      draftId: draft.draftId,
      candidateRevisionId: draft.candidateRevisionId,
      projectParameterBindingId: draft.projectParameterBindingId,
      parameterSpecId: draft.parameterSpecId,
      action: draft.action,
      rawText: draft.rawText,
      reason: draft.reason,
      currentRawValue: draft.currentRawValue,
      writeTarget: {
        role: draft.writeTarget.role,
        propertyKey: draft.writeTarget.propertyKey,
        targetRef: draft.writeTarget.targetRef ?? null
      },
      overlayFileId: draft.overlayFileId,
      overlayFileName: draft.overlayFileName
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({ projectId, items });
}

export function DtsBindingDraftTray({
  projectId,
  drafts,
  selectedBindingIds,
  candidates,
  candidatesError = null,
  externalBlocker = null,
  onRemove,
  onSubmit,
  onNavigate
}: DtsBindingDraftTrayProps) {
  const [candidateSnapshot, setCandidateSnapshot] = useState(() => ({
    candidates,
    error: candidatesError
  }));
  const [hardwareCommitterId, setHardwareCommitterId] = useState("");
  const [softwareCommitterId, setSoftwareCommitterId] = useState("");
  const [softwareUserId, setSoftwareUserId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<{
    generation: number;
    signature: string;
  } | null>(null);

  const submitDrafts = useMemo(() => {
    if (!selectedBindingIds || selectedBindingIds.size === 0) return drafts;
    return drafts.filter((draft) => selectedBindingIds.has(draft.projectParameterBindingId));
  }, [drafts, selectedBindingIds]);
  const submitBatchSignature = useMemo(
    () => draftBatchSignature(projectId, submitDrafts),
    [projectId, submitDrafts]
  );
  const requestSignature = useMemo(
    () => JSON.stringify({
      batchSignature: submitBatchSignature,
      assignees: {
        hardwareCommitterId,
        softwareCommitterId,
        softwareUserId
      }
    }),
    [submitBatchSignature, hardwareCommitterId, softwareCommitterId, softwareUserId]
  );
  const currentRequestSignatureRef = useRef(requestSignature);
  currentRequestSignatureRef.current = requestSignature;

  useEffect(() => {
    if (activeRequestRef.current) return;
    requestGenerationRef.current += 1;
    setSubmitting(false);
    setSubmitted(false);
    setSubmitError(null);
  }, [submitBatchSignature]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (submitting || submitted || activeRequestRef.current) return;
    setCandidateSnapshot({ candidates, error: candidatesError });
    setHardwareCommitterId(candidates?.hardwareCommitters[0]?.id ?? "");
    setSoftwareCommitterId(candidates?.softwareCommitters[0]?.id ?? "");
    setSoftwareUserId(candidates?.softwareUsers[0]?.id ?? "");
  }, [candidates, candidatesError, submitted, submitting]);

  const displayedCandidates = candidateSnapshot.candidates;
  const displayedCandidatesError = candidateSnapshot.error;

  const draftIdentityError = useMemo(
    () => identityBlocker(projectId, submitDrafts),
    [projectId, submitDrafts]
  );
  const candidateError = useMemo(() => candidateBlocker(submitDrafts), [submitDrafts]);
  const actionValueError = useMemo(() => actionValueBlocker(submitDrafts), [submitDrafts]);
  const selectionError =
    selectedBindingIds && selectedBindingIds.size > 0 && submitDrafts.length === 0
      ? "当前勾选的草稿不在本轮修改中，请重新选择后再提交。"
      : null;
  const roleError = displayedCandidates && !(hardwareCommitterId && softwareCommitterId && softwareUserId)
    ? "项目缺少完整的硬件 MDE、软件 MDE 或软件开发候选人，已阻止提交。"
    : null;
  const submissionEntryError = onSubmit
    ? null
    : "正式 binding 提交入口未配置，已阻止提交。";
  const blocker = externalBlocker
    ?? displayedCandidatesError
    ?? selectionError
    ?? draftIdentityError
    ?? actionValueError
    ?? candidateError
    ?? roleError
    ?? submissionEntryError;
  const canSubmit = Boolean(
    submitDrafts.length > 0 &&
    displayedCandidates &&
    !blocker &&
    !submitting &&
    !submitted
  );

  if (drafts.length === 0) return null;

  return (
    <section className="dts-binding-draft-tray dts-draft-tray binding-draft-submission" role="region" aria-label="绑定变更提交">
      <header>
        <div>
          <p className="eyebrow">Current edits</p>
          <h3>本轮已修改</h3>
          <p>
            {selectedBindingIds && selectedBindingIds.size > 0
              ? `将提交已选 ${submitDrafts.length} / ${drafts.length} 项草稿。`
              : "未勾选时提交全部草稿；勾选后仅提交选中项。"}
          </p>
        </div>
        <span>
          {selectedBindingIds && selectedBindingIds.size > 0
            ? `提交 ${submitDrafts.length} / ${drafts.length} 项`
            : `${drafts.length} 项`}
        </span>
      </header>

      <div className="dts-binding-draft-tray__items">
        {drafts.map((draft) => (
          <article className="dts-binding-draft-tray__item" key={draft.draftId}>
            <div className="dts-binding-draft-tray__item-heading">
              <div>
                <strong><code>{draft.writeTarget.propertyKey}</code></strong>
                <span>{draft.action === "delete" ? "删除属性（tombstone）" : "设置属性"}</span>
              </div>
              <button
                type="button"
                className="button subtle"
                aria-label="移出本轮修改"
                disabled={submitting}
                onClick={() => onRemove(draft.draftId)}
              >
                <X size={15} strokeWidth={1.9} aria-hidden="true" />
                移除
              </button>
            </div>
            <div className="dts-binding-draft-tray__diff" aria-label={`${draft.writeTarget.propertyKey} 值变更`}>
              <ParameterValueDiff
                baseValue={formatDtsRawValueForUi(draft.currentRawValue) || "（属性不存在）"}
                targetValue={
                  draft.action === "delete"
                    ? "删除属性（tombstone）"
                    : formatDtsRawValueForUi(draft.rawText) || draft.rawText || "—"
                }
              />
            </div>
            <p><strong>原因：</strong>{draft.reason}</p>
            <details className="dts-binding-draft-tray__identity">
              <summary>技术身份</summary>
              <dl>
                <div><dt>action</dt><dd><code>{draft.action}</code></dd></div>
                <div><dt>candidate</dt><dd><code>{draft.candidateRevisionId}</code></dd></div>
                <div><dt>draft</dt><dd><code>{draft.draftId}</code></dd></div>
                <div><dt>binding</dt><dd><code>{draft.projectParameterBindingId}</code></dd></div>
                <div><dt>spec</dt><dd><code>{draft.parameterSpecId}</code></dd></div>
              </dl>
            </details>
          </article>
        ))}
      </div>

      {!displayedCandidates && !displayedCandidatesError ? <p role="status">正在加载项目角色候选人…</p> : null}
      {displayedCandidates ? (
        <div className="submission-assignee-grid" aria-label="后续流程处理人">
          <label>
            硬件 MDE
            <select aria-label="硬件 MDE" value={hardwareCommitterId} disabled={submitting || submitted} onChange={(event) => setHardwareCommitterId(event.target.value)}>
              {displayedCandidates.hardwareCommitters.length === 0 ? <option value="">无可用候选人</option> : null}
              {displayedCandidates.hardwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件 MDE
            <select aria-label="软件 MDE" value={softwareCommitterId} disabled={submitting || submitted} onChange={(event) => setSoftwareCommitterId(event.target.value)}>
              {displayedCandidates.softwareCommitters.length === 0 ? <option value="">无可用候选人</option> : null}
              {displayedCandidates.softwareCommitters.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <label>
            软件开发
            <select aria-label="软件开发" value={softwareUserId} disabled={submitting || submitted} onChange={(event) => setSoftwareUserId(event.target.value)}>
              {displayedCandidates.softwareUsers.length === 0 ? <option value="">无可用候选人</option> : null}
              {displayedCandidates.softwareUsers.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
        </div>
      ) : null}

      {blocker ? <p className="form-error" role="alert">{blocker}</p> : null}
      {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
      {submitted ? <p role="status"><CircleCheck size={15} strokeWidth={2} aria-hidden="true" />已提交正式审核，后续阶段将在审核队列中按角色推进。</p> : null}

      <div className="binding-draft-submission__actions">
        <button
          type="button"
          className="button primary"
          disabled={!canSubmit}
          onClick={() => {
            if (!onSubmit || !canSubmit) return;
            const submittedRequestSignature = requestSignature;
            const requestGeneration = requestGenerationRef.current + 1;
            requestGenerationRef.current = requestGeneration;
            activeRequestRef.current = {
              generation: requestGeneration,
              signature: submittedRequestSignature
            };
            const requestIsCurrent = () =>
              mountedRef.current &&
              requestGenerationRef.current === requestGeneration &&
              currentRequestSignatureRef.current === submittedRequestSignature;
            const requestIsActive = () =>
              mountedRef.current &&
              requestGenerationRef.current === requestGeneration &&
              activeRequestRef.current?.generation === requestGeneration &&
              activeRequestRef.current.signature === submittedRequestSignature;
            setSubmitting(true);
            setSubmitError(null);
            void onSubmit({
              projectId,
              items: submitDrafts.map((draft) => ({
                draftId: draft.draftId,
                projectParameterBindingId: draft.projectParameterBindingId,
                parameterSpecId: draft.parameterSpecId,
                action: draft.action,
                targetValue: draft.rawText,
                reason: draft.reason
              })),
              assignees: { hardwareCommitterId, softwareCommitterId, softwareUserId }
            })
              .then((result) => {
                if (!requestIsCurrent()) return;
                if (result && "notification" in result) {
                  setSubmitError(result.notification);
                  return;
                }
                setSubmitted(true);
              })
              .catch((error: unknown) => {
                if (!requestIsCurrent()) return;
                setSubmitError(error instanceof Error ? error.message : "提交审核失败。");
              })
              .finally(() => {
                if (!requestIsActive()) return;
                activeRequestRef.current = null;
                if (!requestIsCurrent()) {
                  requestGenerationRef.current += 1;
                  setSubmitted(false);
                  setSubmitError(null);
                }
                setSubmitting(false);
              });
          }}
        >
          <Send size={15} strokeWidth={1.9} aria-hidden="true" />
          {submitting ? "提交中…" : "提交审核"}
        </button>
        {submitted ? (
          <button type="button" className="button subtle" onClick={() => onNavigate("/parameter-review")}>查看审核队列</button>
        ) : null}
      </div>
    </section>
  );
}
