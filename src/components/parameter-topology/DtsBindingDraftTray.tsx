import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Send, X } from "lucide-react";

import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { formatDtsRawValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { presentError } from "@/infrastructure/http/presentError";

import {
  isBindingDraft,
  isEnablementDraft,
  type PendingTopologyDraft
} from "./draftTrayTypes";

export type { PendingBindingDraft, PendingEnablementDraft, PendingTopologyDraft } from "./draftTrayTypes";

export type DtsBindingDraftTrayProps = {
  projectId: string;
  drafts: PendingTopologyDraft[];
  /**
   * Submit scope = the checked binding drafts (WYSIWYG). Enablement drafts on the
   * same working tip as a checked binding ride along and are annotated in the tray.
   * `undefined` keeps whole-tray submission for callers without row selection.
   */
  selectedBindingIds?: ReadonlySet<string>;
  candidates: WorkflowAssigneeCandidates | null;
  candidatesError?: string | null;
  externalBlocker?: string | null;
  /** May reject (e.g. server-side draft delete failed); the tray shows the error inline. */
  onRemove: (draftId: string) => void | Promise<void>;
  onSubmit?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate: (path: string) => void;
};

function nonBlank(value: string): boolean {
  return value.trim().length > 0;
}

function identityBlocker(projectId: string, drafts: PendingTopologyDraft[]): string | null {
  const incomplete = drafts.some((draft) => {
    if (draft.projectId !== projectId || !nonBlank(draft.draftId) || !nonBlank(draft.candidateRevisionId)) {
      return true;
    }
    if (!nonBlank(draft.reason)) return true;
    if (isBindingDraft(draft)) {
      return (
        !nonBlank(draft.projectParameterBindingId) ||
        !nonBlank(draft.parameterSpecId) ||
        !nonBlank(draft.writeTarget.propertyKey)
      );
    }
    if (isEnablementDraft(draft)) {
      return !nonBlank(draft.logicalNodeId);
    }
    return true;
  });
  return incomplete ? "草稿缺少完整的项目、工作版本、编辑目标或原因，已阻止提交。" : null;
}

function candidateBlocker(drafts: PendingTopologyDraft[]): string | null {
  const candidateIds = new Set(drafts.map((draft) => draft.candidateRevisionId));
  return candidateIds.size > 1
    ? "本轮草稿不在同一工作版本上，无法一起提交。请移除冲突项或清空后重新编辑。"
    : null;
}

function actionValueBlocker(drafts: PendingTopologyDraft[]): string | null {
  const emptySet = drafts.some((draft) => draft.action === "set" && !nonBlank(draft.rawText));
  if (emptySet) {
    return "set action 必须携带非空 rawText，已阻止提交。";
  }
  const valuedDelete = drafts.some((draft) => draft.action === "delete" && draft.rawText !== "");
  return valuedDelete
    ? "delete action 必须携带精确空 tombstone rawText，已阻止提交。"
    : null;
}

function draftBatchSignature(projectId: string, drafts: PendingTopologyDraft[]): string {
  const items = drafts
    .map((draft) => {
      if (isBindingDraft(draft)) {
        return {
          kind: "binding" as const,
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
        };
      }
      return {
        kind: "enablement" as const,
        draftId: draft.draftId,
        candidateRevisionId: draft.candidateRevisionId,
        logicalNodeId: draft.logicalNodeId,
        action: draft.action,
        rawText: draft.rawText,
        reason: draft.reason,
        currentRawValue: draft.currentRawValue,
        nodeLabel: draft.nodeLabel
      };
    })
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({ projectId, items });
}

function resolveSubmitDrafts(
  drafts: PendingTopologyDraft[],
  selectedBindingIds?: ReadonlySet<string>
): PendingTopologyDraft[] {
  if (!selectedBindingIds) return drafts;
  const bindingDrafts = drafts.filter(isBindingDraft);
  // Enablement-only rounds have no selectable rows: what you see is what you submit.
  if (bindingDrafts.length === 0) return drafts;
  const selectedBindings = bindingDrafts.filter((draft) =>
    selectedBindingIds.has(draft.projectParameterBindingId)
  );
  if (selectedBindings.length === 0) return [];
  const tips = new Set(selectedBindings.map((draft) => draft.candidateRevisionId));
  return drafts.filter((draft) => {
    if (isBindingDraft(draft)) {
      return selectedBindingIds.has(draft.projectParameterBindingId);
    }
    return tips.has(draft.candidateRevisionId);
  });
}

function formatEnablementValue(raw: string | null): string {
  if (raw == null || !raw.trim()) return "未声明";
  return formatDtsRawValueForUi(raw) || raw;
}

function toSubmitItem(draft: PendingTopologyDraft) {
  if (isEnablementDraft(draft)) {
    return {
      draftId: draft.draftId,
      editSubjectKind: "node-enablement" as const,
      logicalNodeId: draft.logicalNodeId,
      action: draft.action,
      targetValue: draft.rawText,
      reason: draft.reason
    };
  }
  return {
    draftId: draft.draftId,
    editSubjectKind: "binding" as const,
    projectParameterBindingId: draft.projectParameterBindingId,
    parameterSpecId: draft.parameterSpecId,
    action: draft.action,
    targetValue: draft.rawText,
    reason: draft.reason
  };
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
  const [removingDraftId, setRemovingDraftId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const activeRequestRef = useRef<{
    generation: number;
    signature: string;
  } | null>(null);

  const submitDrafts = useMemo(
    () => resolveSubmitDrafts(drafts, selectedBindingIds),
    [drafts, selectedBindingIds]
  );
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
  const hasBindingDrafts = drafts.some((draft) => isBindingDraft(draft));
  const selectionError =
    selectedBindingIds && hasBindingDrafts && submitDrafts.length === 0
      ? selectedBindingIds.size === 0
        ? "尚未勾选任何草稿；请先勾选要提交的草稿。"
        : "当前勾选的草稿不在本轮修改中，请重新选择后再提交。"
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
    !submitted &&
    !removingDraftId
  );
  const submitDraftIds = new Set(submitDrafts.map((draft) => draft.draftId));
  const handleRemove = (draftId: string) => {
    setRemovingDraftId(draftId);
    setRemoveError(null);
    void Promise.resolve(onRemove(draftId))
      .catch((error: unknown) => {
        if (!mountedRef.current) return;
        setRemoveError(presentError(error, "移除草稿失败，请重试。"));
      })
      .finally(() => {
        if (!mountedRef.current) return;
        setRemovingDraftId(null);
      });
  };

  if (drafts.length === 0) return null;

  return (
    <section className="dts-binding-draft-tray dts-draft-tray binding-draft-submission" role="region" aria-label="参数修改提交">
      <header>
        <div>
          <h3>本轮已修改</h3>
          <p>
            {selectedBindingIds && hasBindingDrafts
              ? `所见即所提：将提交勾选的 ${submitDrafts.length} / ${drafts.length} 项草稿；同一工作版本的节点启用草稿将随勾选项一并提交（已在条目上标注）。`
              : "本轮全部草稿将一并提交审核。"}
          </p>
        </div>
        <span>
          {candidateError
            ? selectedBindingIds
              ? `提交 ${submitDrafts.length} / ${drafts.length} 项`
              : `${drafts.length} 项`
            : `本轮 ${drafts.length} 项`}
        </span>
      </header>

      <div className="dts-binding-draft-tray__items">
        {drafts.map((draft) => {
          const diffLabel = isBindingDraft(draft)
            ? `${draft.writeTarget.propertyKey} 值变更`
            : `${draft.nodeLabel} 节点启用变更`;
          const currentValue = isBindingDraft(draft)
            ? formatDtsRawValueForUi(draft.currentRawValue) || "（属性不存在）"
            : formatEnablementValue(draft.currentRawValue);
          const targetValue = draft.action === "delete"
            ? (isBindingDraft(draft) ? "删除属性（tombstone）" : "未声明")
            : formatEnablementValue(draft.rawText);
          const ridesAlong =
            Boolean(selectedBindingIds) &&
            hasBindingDrafts &&
            isEnablementDraft(draft) &&
            submitDraftIds.has(draft.draftId);

          return (
            <article className="dts-binding-draft-tray__item" key={draft.draftId}>
              <div className="dts-binding-draft-tray__item-heading">
                <div>
                  {isBindingDraft(draft) ? (
                    <strong><code>{draft.writeTarget.propertyKey}</code></strong>
                  ) : (
                    <strong>{draft.nodeLabel}</strong>
                  )}
                  <span>{isBindingDraft(draft) ? draft.moduleName : "节点启用"}</span>
                </div>
                <button
                  type="button"
                  className="button subtle"
                  aria-label="移出本轮修改"
                  disabled={submitting || removingDraftId !== null}
                  onClick={() => handleRemove(draft.draftId)}
                >
                  <X size={15} strokeWidth={1.9} aria-hidden="true" />
                  {removingDraftId === draft.draftId ? "移除中…" : "移除"}
                </button>
              </div>
              <div className="dts-binding-draft-tray__diff" aria-label={diffLabel}>
                <ParameterValueDiff baseValue={currentValue} targetValue={targetValue} />
              </div>
              {ridesAlong ? (
                <p className="dts-binding-draft-tray__ride-along" role="note">
                  同一工作版本：将随勾选的参数草稿一并提交。
                </p>
              ) : null}
              <p><strong>原因：</strong>{draft.reason}</p>
            </article>
          );
        })}
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
      {removeError ? <p className="form-error" role="alert">{removeError}</p> : null}
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
              items: submitDrafts.map((draft) => toSubmitItem(draft)),
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
          {submitting ? "提交中…" : `提交审核（${submitDrafts.length} 项）`}
        </button>
        {submitted ? (
          <button type="button" className="button subtle" onClick={() => onNavigate("/parameter-review")}>查看变更审阅</button>
        ) : null}
      </div>
    </section>
  );
}
