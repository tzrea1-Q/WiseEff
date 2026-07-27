import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

import {
  matchStatusLabel,
  nodeNameFromEvidence,
  selectedSpec,
  type SpecReviewApproveInput,
  type SpecReviewCandidate,
  type SpecReviewTaskView
} from "./specReviewShared";

export type SpecReviewTaskDialogProps = {
  task: SpecReviewTaskView;
  librarySpecs?: readonly SpecReviewCandidate[];
  onClose: () => void;
  onApprove: (input: SpecReviewApproveInput) => void;
  onDismiss?: (input: { taskId: string; reason: string }) => void;
  onCreateSpec?: (input: {
    taskId: string;
    propertyKey: string;
    driverModule: string | null;
    reason: string;
  }) => void;
  pendingTaskId?: string | null;
  pendingAction?: "approve" | "dismiss" | "create" | null;
};

type DraftState = {
  schemaId: string;
  reason: string;
  libraryQuery: string;
  confirmMismatch: boolean;
};

const EMPTY_DRAFT: DraftState = {
  schemaId: "",
  reason: "",
  libraryQuery: "",
  confirmMismatch: false
};

/**
 * Spec-review adjudication dialog — legacy parameter-admin shell
 * (`modal-backdrop` + `submission-dialog param-admin-editor-dialog`).
 */
export function SpecReviewTaskDialog({
  task,
  librarySpecs = [],
  onClose,
  onApprove,
  onDismiss,
  onCreateSpec,
  pendingTaskId = null,
  pendingAction = null
}: SpecReviewTaskDialogProps) {
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const isPending = pendingTaskId === task.id;
  const nodeName = nodeNameFromEvidence(task.evidence);
  const matchStatus = matchStatusLabel(task);

  useEffect(() => {
    setDraft(EMPTY_DRAFT);
  }, [task.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPending, onClose]);

  const options = useMemo(() => {
    const query = draft.libraryQuery.trim().toLowerCase();
    const filteredLibrary = librarySpecs.filter((item) => {
      if (!query) return true;
      return (
        item.label.toLowerCase().includes(query) ||
        (item.propertyKey ?? "").toLowerCase().includes(query) ||
        (item.driverModule ?? "").toLowerCase().includes(query)
      );
    });
    return [
      ...task.candidates,
      ...filteredLibrary.filter((item) => !task.candidates.some((candidate) => candidate.id === item.id))
    ];
  }, [draft.libraryQuery, librarySpecs, task.candidates]);

  const picked = draft.schemaId ? selectedSpec(task, librarySpecs, draft.schemaId) : undefined;
  const propertyMismatch = Boolean(picked?.propertyKey) && picked?.propertyKey !== task.propertyKey;
  const canApprove =
    Boolean(draft.schemaId.trim() && draft.reason.trim()) && (!propertyMismatch || draft.confirmMismatch);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${PARAMETER_ADMIN_UI.specReview} ${task.propertyKey}`}
      onClick={isPending ? undefined : onClose}
    >
      <div
        className="submission-dialog param-admin-editor-dialog submission-dialog--wide"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.specReviewDialogEyebrow}</span>
            <h2 id="spec-review-task-dialog-title">{task.propertyKey}</h2>
            <p>
              {nodeName ? `节点 ${nodeName}` : "节点未标注"}
              {" · "}
              {task.driverModule ? `所属模块 ${task.driverModule}` : "所属模块未映射"}
              {" · "}
              {matchStatus}
              。从系统推荐或参数定义库选择定义后批准；属性键不一致须额外确认。
            </p>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onClose}
            aria-label="关闭"
            disabled={isPending}
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <section className="shared-definition-panel" aria-label="审核任务详情">
            <div className="panel-header">
              <strong>任务详情</strong>
              <span>{matchStatus}</span>
            </div>
            <form className="param-def-form" onSubmit={(event) => event.preventDefault()}>
              <fieldset className="def-group">
                <legend>身份与证据</legend>
                <div className="def-group-fields">
                  <label>
                    参数名
                    <input aria-label="参数名" className="mono" value={task.propertyKey} readOnly aria-readonly="true" />
                  </label>
                  <label>
                    节点
                    <input
                      aria-label="节点"
                      className="mono"
                      value={nodeName || "—"}
                      readOnly
                      aria-readonly="true"
                    />
                  </label>
                  <label>
                    所属模块
                    <input
                      aria-label="所属模块"
                      className="mono"
                      value={task.driverModule ?? "—"}
                      readOnly
                      aria-readonly="true"
                    />
                  </label>
                  <label>
                    受影响项目
                    <input
                      aria-label="受影响项目"
                      value={String(task.projectCount)}
                      readOnly
                      aria-readonly="true"
                    />
                  </label>
                  <label>
                    {PARAMETER_ADMIN_UI.specReviewEvidence}
                    <textarea
                      aria-label={PARAMETER_ADMIN_UI.specReviewEvidence}
                      className="parameter-admin-code-editor"
                      value={task.evidence.length > 0 ? task.evidence.join("\n") : "—"}
                      rows={Math.min(6, Math.max(2, task.evidence.length || 1))}
                      readOnly
                      aria-readonly="true"
                      wrap="off"
                    />
                  </label>
                  {task.candidates.length > 0 ? (
                    <label>
                      {PARAMETER_ADMIN_UI.specReviewCandidates}
                      <textarea
                        aria-label={PARAMETER_ADMIN_UI.specReviewCandidates}
                        className="parameter-admin-code-editor"
                        value={task.candidates.map((candidate) => candidate.label).join("\n")}
                        rows={Math.min(5, Math.max(2, task.candidates.length))}
                        readOnly
                        aria-readonly="true"
                        wrap="off"
                      />
                    </label>
                  ) : null}
                </div>
              </fieldset>

              <fieldset className="def-group">
                <legend>{PARAMETER_ADMIN_UI.specReviewDecision}</legend>
                <div className="def-group-fields">
                  <label>
                    {PARAMETER_ADMIN_UI.searchSpecLibrary}
                    <input
                      aria-label={PARAMETER_ADMIN_UI.searchSpecLibrary}
                      value={draft.libraryQuery}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, libraryQuery: event.target.value }))
                      }
                      placeholder={PARAMETER_ADMIN_UI.searchSpecPlaceholder}
                      disabled={isPending}
                    />
                  </label>
                  <label>
                    {PARAMETER_ADMIN_UI.selectSpec}
                    <select
                      aria-label={PARAMETER_ADMIN_UI.selectSpec}
                      value={draft.schemaId}
                      disabled={isPending}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          schemaId: event.target.value,
                          confirmMismatch: false
                        }))
                      }
                    >
                      <option value="">{PARAMETER_ADMIN_UI.selectSpecPlaceholder}</option>
                      {options.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {picked ? (
                    <p className="spec-review-queue__picked-detail">
                      已选：{picked.label}
                      {picked.propertyKey ? ` · 属性 ${picked.propertyKey}` : ""}
                      {picked.driverModule ? ` · 驱动 ${picked.driverModule}` : ""}
                    </p>
                  ) : null}
                  {propertyMismatch ? (
                    <label className="spec-review-queue__mismatch-warning">
                      <input
                        type="checkbox"
                        checked={draft.confirmMismatch}
                        disabled={isPending}
                        aria-label="高风险：确认属性键不一致"
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            confirmMismatch: event.target.checked
                          }))
                        }
                      />
                      高风险：所选参数定义属性键为「{picked?.propertyKey}」，与任务「{task.propertyKey}」不一致。确认后继续。
                    </label>
                  ) : null}
                  <label>
                    审核原因
                    <textarea
                      aria-label="审核原因"
                      value={draft.reason}
                      rows={3}
                      disabled={isPending}
                      placeholder={PARAMETER_ADMIN_UI.approveReasonPlaceholder}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, reason: event.target.value }))
                      }
                    />
                  </label>
                </div>
              </fieldset>
            </form>
          </section>
        </div>

        <div className="dialog-actions">
          <button type="button" className="button subtle" onClick={onClose} disabled={isPending}>
            取消
          </button>
          {onDismiss ? (
            <button
              type="button"
              className="button subtle"
              disabled={!draft.reason.trim() || isPending}
              onClick={() => onDismiss({ taskId: task.id, reason: draft.reason.trim() })}
            >
              {isPending && pendingAction === "dismiss" ? "驳回中…" : "驳回"}
            </button>
          ) : null}
          {onCreateSpec && task.candidates.length === 0 ? (
            <button
              type="button"
              className="button subtle"
              disabled={!draft.reason.trim() || isPending}
              onClick={() =>
                onCreateSpec({
                  taskId: task.id,
                  propertyKey: task.propertyKey,
                  driverModule: task.driverModule,
                  reason: draft.reason.trim()
                })
              }
            >
              {isPending && pendingAction === "create" ? "创建中…" : PARAMETER_ADMIN_UI.createDraftSpec}
            </button>
          ) : null}
          <button
            type="button"
            className="button primary"
            disabled={!canApprove || isPending}
            onClick={() =>
              onApprove({
                taskId: task.id,
                parameterSpecId: draft.schemaId,
                reason: draft.reason.trim(),
                confirmPropertyMismatch: propertyMismatch ? draft.confirmMismatch : undefined
              })
            }
          >
            {isPending && pendingAction === "approve" ? "批准中…" : "批准"}
          </button>
        </div>
      </div>
    </div>
  );
}
