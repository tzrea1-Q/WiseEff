import { useEffect, useMemo, useRef, useState } from "react";
import { CircleCheck, Pencil, Send, X } from "lucide-react";

import type {
  SubmitParameterChangesInput,
  WorkflowAssigneeCandidates
} from "@/application/ports/ParameterRepository";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { SelectControl } from "@/components/common/SelectControl";
import { formatDtsRawValueForUi, formatDtsValueForUi, isDtsEmptyValueAllowed } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { presentError } from "@/infrastructure/http/presentError";

import {
  isBindingDraft,
  isEnablementDraft,
  type PendingBindingDraft,
  type PendingTopologyDraft
} from "./draftTrayTypes";

export type { PendingBindingDraft, PendingEnablementDraft, PendingTopologyDraft } from "./draftTrayTypes";

export const mixedDraftOwnerMessage = "节点启用与参数值使用不同审核流程，请分别提交；可先移出另一类草稿。";

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
  canManageRoles?: boolean;
  /** May reject (e.g. server-side draft delete failed); the tray shows the error inline. */
  onRemove: (draftId: string) => void | Promise<void>;
  onSubmit?: (
    input: SubmitParameterChangesInput
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  /** Canonical v2 submit: draft IDs plus optional software-review ownership. */
  onSubmitCanonical?: (
    input: { projectId: string; draftIds: string[]; assignedToUserId?: string | null }
  ) => Promise<void | { notification: string; alreadyNotified?: boolean }>;
  onNavigate: (path: string) => void;
  onEditBinding?: (bindingId: string) => void;
  canEdit?: boolean;
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
  const emptySet = drafts.some((draft) => draft.action === "set" && !nonBlank(draft.rawText) &&
    !(isBindingDraft(draft) && draft.sourceFormat !== "json" && isDtsEmptyValueAllowed(draft.effectiveValue)));
  if (emptySet) {
    return "目标值尚未填写，无法提交审核。";
  }
  const valuedDelete = drafts.some((draft) => draft.action === "delete" && draft.rawText !== "");
  return valuedDelete
    ? "删除草稿包含了目标值，请重新编辑后提交。"
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

function formatBindingValue(draft: PendingBindingDraft, raw: string): string {
  if (draft.sourceFormat === "json") return raw || "∅";
  return formatDtsValueForUi(raw, draft.effectiveValue);
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

const ROLE_LABELS: Record<string, string> = {
  "hardware-committer": "硬件 MDE",
  "software-committer": "软件 MDE",
  "software-user": "软件开发"
};

export function DtsBindingDraftTray({
  projectId,
  drafts,
  selectedBindingIds,
  candidates,
  candidatesError = null,
  externalBlocker = null,
  canManageRoles = false,
  onRemove,
  onSubmit,
  onSubmitCanonical,
  onNavigate,
  onEditBinding,
  canEdit = true
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
  const canonicalCount = submitDrafts.filter((draft) =>
    isBindingDraft(draft) && draft.writeTarget.role.startsWith("canonical-project-value")
  ).length;
  const useCanonical = canonicalCount > 0 && canonicalCount === submitDrafts.length;
  const mixedOwnerError = canonicalCount > 0 && canonicalCount < submitDrafts.length
    ? mixedDraftOwnerMessage
    : null;
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
  const missingRoleNames = useMemo(() => {
    if (!displayedCandidates) return null;
    const requiredRoles = useCanonical
      ? ["software-committer"]
      : ["hardware-committer", "software-committer", "software-user"];
    if (displayedCandidates.missingRoles && displayedCandidates.missingRoles.length > 0) {
      const missing = displayedCandidates.missingRoles.filter((role) => requiredRoles.includes(role));
      if (missing.length > 0) return missing.map((r) => ROLE_LABELS[r] ?? r).join("、");
    }
    const missing: string[] = [];
    if (!useCanonical && displayedCandidates.hardwareCommitters && displayedCandidates.hardwareCommitters.length === 0) {
      missing.push(ROLE_LABELS["hardware-committer"]);
    }
    if (displayedCandidates.softwareCommitters && displayedCandidates.softwareCommitters.length === 0) {
      missing.push(ROLE_LABELS["software-committer"]);
    }
    if (!useCanonical && displayedCandidates.softwareUsers && displayedCandidates.softwareUsers.length === 0) {
      missing.push(ROLE_LABELS["software-user"]);
    }
    return missing.length > 0 ? missing.join("、") : null;
  }, [displayedCandidates, useCanonical]);

  const roleError = missingRoleNames
    ? `当前项目缺少以下审核角色：${missingRoleNames}，已阻止提交。`
    : !useCanonical && displayedCandidates && !(hardwareCommitterId && softwareCommitterId && softwareUserId)
    ? "项目缺少完整的硬件 MDE、软件 MDE 或软件开发候选人，已阻止提交。"
    : null;
  const submissionEntryError = (useCanonical ? onSubmitCanonical : onSubmit)
    ? null
    : "审核服务暂不可用，请稍后重试。";
  const blocker = externalBlocker
    ?? mixedOwnerError
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
    !removingDraftId && canEdit
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
    <section className="dts-binding-draft-tray dts-draft-tray binding-draft-submission" aria-label="参数修改提交">
      <header>
        <div>
          <h3>本轮已修改</h3>
          <p>
            {mixedOwnerError
              ? "节点启用与参数值须分开提交。"
              : useCanonical
              ? `将提交 ${submitDrafts.length} 项参数值草稿；节点启用使用独立审核流程。`
              : selectedBindingIds && hasBindingDrafts
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
          const displayName = isBindingDraft(draft) ? draft.displayName?.trim() : null;
          const diffLabel = isBindingDraft(draft)
            ? `${draft.writeTarget.propertyKey} 值变更`
            : `${draft.nodeLabel} 节点启用变更`;
          const currentValue = isBindingDraft(draft)
            ? formatBindingValue(draft, draft.currentRawValue) || "（属性不存在）"
            : formatEnablementValue(draft.currentRawValue);
          const targetValue = draft.action === "delete"
            ? (isBindingDraft(draft) ? "删除属性" : "未声明")
            : isBindingDraft(draft)
              ? formatBindingValue(draft, draft.rawText)
              : formatEnablementValue(draft.rawText);
          const ridesAlong =
            !mixedOwnerError &&
            Boolean(selectedBindingIds) &&
            hasBindingDrafts &&
            isEnablementDraft(draft) &&
            submitDraftIds.has(draft.draftId);

          return (
            <article className="dts-binding-draft-tray__item" key={draft.draftId}>
              <div className="dts-binding-draft-tray__item-heading">
                <div>
                  {isBindingDraft(draft) ? (
                    <><strong>{displayName || <code>{draft.writeTarget.propertyKey}</code>}</strong>
                      {displayName && displayName !== draft.writeTarget.propertyKey ? <small><code>{draft.writeTarget.propertyKey}</code></small> : null}</>
                  ) : (
                    <strong>{draft.nodeLabel}</strong>
                  )}
                  <span>{isBindingDraft(draft) ? draft.moduleName : "节点启用"}</span>
                </div>
                {isBindingDraft(draft) && onEditBinding ? (
                  <button type="button" className="button subtle"
                    aria-label={`继续编辑 ${draft.writeTarget.propertyKey}`}
                    disabled={!canEdit || submitting || removingDraftId !== null}
                    onClick={() => onEditBinding(draft.projectParameterBindingId)}>
                    <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                    继续编辑
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button subtle"
                  aria-label="移出本轮修改"
                  disabled={!canEdit || submitting || removingDraftId !== null}
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
      {useCanonical && displayedCandidates ? (
        <div className="submission-assignee-grid" aria-label="软件审核处理人">
          <label>
            软件 MDE
            <SelectControl ariaLabel="软件 MDE" value={softwareCommitterId} disabled={!canEdit || submitting || submitted} onValueChange={setSoftwareCommitterId} options={[
              { value: "", label: "软件审核池（未指定）" },
              ...displayedCandidates.softwareCommitters.map((candidate) => ({ value: candidate.id, label: candidate.name }))
            ]} />
          </label>
        </div>
      ) : null}
      {!useCanonical && displayedCandidates ? (
        <div className="submission-assignee-grid" aria-label="后续流程处理人">
          <label>
            硬件 MDE
            <SelectControl ariaLabel="硬件 MDE" value={hardwareCommitterId} disabled={!canEdit || submitting || submitted} onValueChange={setHardwareCommitterId} options={[
              ...(displayedCandidates.hardwareCommitters.length === 0 ? [{ value: "", label: "无可用候选人" }] : []),
              ...displayedCandidates.hardwareCommitters.map((candidate) => ({ value: candidate.id, label: candidate.name }))
            ]} />
          </label>
          <label>
            软件 MDE
            <SelectControl ariaLabel="软件 MDE" value={softwareCommitterId} disabled={!canEdit || submitting || submitted} onValueChange={setSoftwareCommitterId} options={[
              ...(displayedCandidates.softwareCommitters.length === 0 ? [{ value: "", label: "无可用候选人" }] : []),
              ...displayedCandidates.softwareCommitters.map((candidate) => ({ value: candidate.id, label: candidate.name }))
            ]} />
          </label>
          <label>
            软件开发
            <SelectControl ariaLabel="软件开发" value={softwareUserId} disabled={!canEdit || submitting || submitted} onValueChange={setSoftwareUserId} options={[
              ...(displayedCandidates.softwareUsers.length === 0 ? [{ value: "", label: "无可用候选人" }] : []),
              ...displayedCandidates.softwareUsers.map((candidate) => ({ value: candidate.id, label: candidate.name }))
            ]} />
          </label>
        </div>
      ) : null}

      {blocker ? (
        <div role="alert">
          <p className="form-error">{blocker}</p>
          {blocker === roleError ? (
            canManageRoles ? (
              <button
                type="button"
                className="button subtle"
                style={{ marginTop: "6px" }}
                onClick={() => onNavigate(`/parameter-admin/projects/${encodeURIComponent(projectId)}/review-roles`)}
              >
                配置项目审核角色
              </button>
            ) : (
              <p className="form-help" style={{ marginTop: "4px", fontSize: "13px" }}>
                请联系管理员配置项目审核角色。
              </p>
            )
          ) : null}
        </div>
      ) : null}
      {removeError ? <p className="form-error" role="alert">{removeError}</p> : null}
      {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
      {submitted ? <p role="status"><CircleCheck size={15} strokeWidth={2} aria-hidden="true" />{useCanonical ? "已提交软件审核，后续由软件审核员处理。" : "已提交正式审核，后续阶段将在审核队列中按角色推进。"}</p> : null}

      <div className="binding-draft-submission__actions">
        <button
          type="button"
          className="button primary"
          disabled={!canSubmit}
          onClick={() => {
            if ((!onSubmit && !onSubmitCanonical) || !canSubmit) return;
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
            const submitPromise = useCanonical && onSubmitCanonical
              ? onSubmitCanonical({
                  projectId,
                  draftIds: submitDrafts.map((draft) => draft.draftId),
                  assignedToUserId: softwareCommitterId || null
                })
              : onSubmit
                ? onSubmit({
                    projectId,
                    items: submitDrafts.map((draft) => toSubmitItem(draft)),
                    assignees: { hardwareCommitterId, softwareCommitterId, softwareUserId }
                  })
                : Promise.resolve(undefined);
            void submitPromise
              .then((result) => {
                if (!requestIsCurrent()) return;
                if (result && "notification" in result) {
                  if (!useCanonical || !result.alreadyNotified) setSubmitError(result.notification);
                  return;
                }
                setSubmitted(true);
              })
              .catch((error: unknown) => {
                if (!requestIsCurrent()) return;
                setSubmitError(presentError(error, "提交审核失败，请稍后重试。"));
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
