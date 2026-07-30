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
import { formatSpecPrimaryLabel } from "./ParameterSpecLibrary";

export type ParameterSpecDetailDialogProps = {
  detail: ParameterSpecDetailView;
  onClose: () => void;
  onSave?: (payload: SpecEditorSavePayload) => void | Promise<void>;
  onDeprecate?: (input: { reason: string }) => void | Promise<void>;
  onRestore?: (input: { reason: string }) => void | Promise<void>;
  onPrepareCutover?: () => void | Promise<void>;
  onFinalizeCutover?: (input: { reason: string }) => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
};

/**
 * Spec editor dialog — legacy parameter-admin shell
 * (`modal-backdrop` + `submission-dialog param-admin-editor-dialog`).
 * Org-owned drafts save via activate; org-owned active specs via update.
 * Soft retirement: deprecate / restore with required reason.
 */
export function ParameterSpecDetailDialog({
  detail,
  onClose,
  onSave,
  onDeprecate,
  onRestore,
  onPrepareCutover,
  onFinalizeCutover,
  pending = false,
  error = null
}: ParameterSpecDetailDialogProps) {
  const editable = typeof onSave === "function";
  const isDraft = detail.reviewState === "draft" && detail.organizationId != null;
  const isDeprecated = detail.reviewState === "deprecated";
  const primaryLabel = formatSpecPrimaryLabel(detail);
  const cutover = detail.cutover;
  const [draft, setDraft] = useState<SpecEditorDraft>(() => createSpecEditorDraft(detail));
  const [localError, setLocalError] = useState<string | null>(null);
  const [lifecycleKind, setLifecycleKind] = useState<"deprecate" | "restore" | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [cutoverFinalizeReason, setCutoverFinalizeReason] = useState("");

  useEffect(() => {
    setDraft(createSpecEditorDraft(detail));
    setLocalError(null);
    setCutoverFinalizeReason("");
  }, [detail.id, detail.reviewState, detail.organizationId, detail.cutover?.status]);

  useEffect(() => {
    setLifecycleKind(null);
    setLifecycleReason("");
  }, [detail.id]);

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

  const handleLifecycle = async () => {
    const reason = lifecycleReason.trim();
    if (!reason) {
      setLocalError(lifecycleKind === "restore" ? "请填写恢复原因。" : "请填写废弃原因。");
      return;
    }
    if (lifecycleKind === "deprecate") {
      await onDeprecate?.({ reason });
    } else if (lifecycleKind === "restore") {
      await onRestore?.({ reason });
    }
    setLifecycleKind(null);
    setLifecycleReason("");
  };

  return (
    <>
      <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${PARAMETER_ADMIN_UI.specDetail} ${primaryLabel}`}
      onClick={pending ? undefined : onClose}
    >
      <div
        className="submission-dialog param-admin-editor-dialog submission-dialog--wide"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{editable ? PARAMETER_ADMIN_UI.specDetailEyebrowEditable : PARAMETER_ADMIN_UI.specDetailEyebrowReadonly}</span>
            <h2 id="parameter-spec-detail-dialog-title">{primaryLabel}</h2>
            <p>
              {editable
                ? isDraft
                  ? "修改展示信息、取值形态与约束后保存并激活，供定义匹配审核批准项目参数。"
                  : detail.organizationId == null
                    ? "平台全局目录定义可修改展示信息、约束与说明；属性键等身份字段不可改。"
                    : "修改展示信息、约束与说明后保存；属性键等身份字段不可改。"
                : "当前未接线保存能力，仅可查看。"}
            </p>
            {typeof detail.usageCount === "number" ? (
              <p className="form-hint">
                {PARAMETER_ADMIN_UI.referenceCountLabel}：{detail.usageCount}
              </p>
            ) : null}
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
          {cutover ? (
            <div className="param-admin-cutover-panel" style={{ marginBottom: "1rem" }}>
              <p className="eyebrow">版本切换</p>
              <p>
                语义版本 v{cutover.fromVersion} → v{cutover.toVersion}（{cutover.status === "ready" ? "可完成" : "准备中"}）
              </p>
              <p className="form-hint">
                影响绑定：共 {cutover.impact.total}，待处理 {cutover.impact.pending}，就绪{" "}
                {cutover.impact.ready}，不兼容 {cutover.impact.incompatible}
              </p>
              {cutover.status === "preparing" && cutover.impact.pending > 0 && onPrepareCutover ? (
                <button
                  type="button"
                  className="button subtle"
                  disabled={pending}
                  onClick={() => void onPrepareCutover()}
                >
                  {pending ? "准备中…" : "准备切换"}
                </button>
              ) : null}
              {cutover.status === "ready" && onFinalizeCutover ? (
                <div className="form-stack" style={{ marginTop: "0.75rem" }}>
                  <label className="field">
                    <span>完成切换原因</span>
                    <textarea
                      aria-label="完成切换原因"
                      value={cutoverFinalizeReason}
                      rows={3}
                      onChange={(event) => {
                        setCutoverFinalizeReason(event.target.value);
                        setLocalError(null);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="button primary"
                    disabled={pending}
                    onClick={() => {
                      const reason = cutoverFinalizeReason.trim();
                      if (!reason) {
                        setLocalError("请填写完成切换原因。");
                        return;
                      }
                      void onFinalizeCutover({ reason });
                    }}
                  >
                    {pending ? "切换中…" : "确认完成切换"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <ParameterSpecDetail
            detail={detail}
            draft={draft}
            onDraftChange={handleDraftChange}
            editable={editable && !isDeprecated}
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
          {!isDeprecated && onDeprecate ? (
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                setLocalError(null);
                setLifecycleKind("deprecate");
              }}
              disabled={pending}
            >
              废弃
            </button>
          ) : null}
          {isDeprecated && onRestore ? (
            <button
              type="button"
              className="button subtle"
              onClick={() => {
                setLocalError(null);
                setLifecycleKind("restore");
              }}
              disabled={pending}
            >
              恢复
            </button>
          ) : null}
          {editable && !isDeprecated ? (
            <button type="button" className="button primary" onClick={() => void handleSave()} disabled={pending}>
              {saveLabel}
            </button>
          ) : (
            <button type="button" className="button primary" onClick={onClose} disabled={pending}>
              完成
            </button>
          )}
        </div>
      </div>
      </div>
      {lifecycleKind ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={lifecycleKind === "restore" ? "恢复参数定义" : "废弃参数定义"}
        >
          <div className="submission-dialog param-admin-editor-dialog">
            <div className="submission-dialog-head">
              <div>
                <span className="eyebrow">参数定义库</span>
                <h2>{lifecycleKind === "restore" ? "恢复参数定义" : "废弃参数定义"}</h2>
              </div>
            </div>
            <div className="form-stack">
              <label className="field">
                <span>{lifecycleKind === "restore" ? "恢复原因" : "废弃原因"}</span>
                <textarea
                  aria-label={lifecycleKind === "restore" ? "恢复原因" : "废弃原因"}
                  value={lifecycleReason}
                  rows={4}
                  onChange={(event) => {
                    setLifecycleReason(event.target.value);
                    setLocalError(null);
                  }}
                />
              </label>
              {localError ? <p className="form-error" role="alert">{localError}</p> : null}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button subtle"
                onClick={() => {
                  setLifecycleKind(null);
                  setLifecycleReason("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleLifecycle()}
                disabled={pending}
              >
                {lifecycleKind === "restore" ? "确认恢复" : "确认废弃"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
