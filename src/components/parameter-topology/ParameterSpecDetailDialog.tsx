import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";

import {
  ParameterSpecDetail,
  buildSpecEditorSavePayload,
  createSpecEditorDraft,
  type ParameterSpecDetailView,
  type SpecEditorDraft,
  type SpecEditorSavePayload
} from "./ParameterSpecDetail";

export type ParameterSpecDetailDialogProps = {
  detail: ParameterSpecDetailView;
  onClose: () => void;
  onSave?: (payload: SpecEditorSavePayload) => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
};

/**
 * Spec editor dialog — legacy parameter-admin shell
 * (`modal-backdrop` + `submission-dialog param-admin-editor-dialog`).
 * Org-owned drafts save via activate; org-owned active specs via update.
 */
export function ParameterSpecDetailDialog({
  detail,
  onClose,
  onSave,
  pending = false,
  error = null
}: ParameterSpecDetailDialogProps) {
  const editable = typeof onSave === "function";
  const isDraft = detail.reviewState === "draft" && detail.organizationId != null;
  const [draft, setDraft] = useState<SpecEditorDraft>(() => createSpecEditorDraft(detail));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(createSpecEditorDraft(detail));
    setLocalError(null);
  }, [detail.id, detail.reviewState, detail.organizationId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pending]);

  const saveLabel = useMemo(() => {
    if (!editable) return "完成";
    if (pending) return isDraft ? "激活中…" : "保存中…";
    return isDraft ? "保存并激活" : "保存";
  }, [editable, isDraft, pending]);

  const handleDraftChange = (patch: Partial<SpecEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setLocalError(null);
  };

  const handleSave = async () => {
    if (!editable) {
      onClose();
      return;
    }
    if (!onSave) {
      setLocalError("当前环境未接线参数定义保存能力。");
      return;
    }
    const built = buildSpecEditorSavePayload(detail, draft);
    if (!built.payload) {
      setLocalError(built.error);
      return;
    }
    await onSave(built.payload);
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${PARAMETER_ADMIN_UI.specDetail} ${detail.propertyKey}`}
      onClick={pending ? undefined : onClose}
    >
      <div
        className="submission-dialog param-admin-editor-dialog submission-dialog--wide"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{editable ? PARAMETER_ADMIN_UI.specDetailEyebrowEditable : PARAMETER_ADMIN_UI.specDetailEyebrowReadonly}</span>
            <h2 id="parameter-spec-detail-dialog-title">{detail.propertyKey}</h2>
            <p>
              {editable
                ? isDraft
                  ? "修改展示信息、取值形态与约束后保存并激活，供定义匹配审核批准项目参数。"
                  : detail.organizationId == null
                    ? "平台全局目录定义可修改展示信息、约束与说明；属性键等身份字段不可改。"
                    : "修改展示信息、约束与说明后保存；属性键等身份字段不可改。"
                : "当前未接线保存能力，仅可查看。"}
            </p>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onClose}
            aria-label="关闭"
            disabled={pending}
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <ParameterSpecDetail
            detail={detail}
            draft={draft}
            onDraftChange={handleDraftChange}
            editable={editable}
          />
          {localError || error ? (
            <p className="form-error" role="alert">
              {localError || error}
            </p>
          ) : null}
        </div>

        <div className="dialog-actions">
          {editable ? (
            <button type="button" className="button subtle" onClick={onClose} disabled={pending}>
              取消
            </button>
          ) : null}
          <button type="button" className="button primary" onClick={() => void handleSave()} disabled={pending}>
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
