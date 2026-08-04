import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";

import {
  ParameterSpecDetail,
  buildSpecEditorSavePayload,
  createSpecEditorDraft,
  isSpecEditorDraftDirty,
  type ParameterSpecDetailView,
  type SpecEditorDraft,
  type SpecEditorSavePayload
} from "./ParameterSpecDetail";
import { formatSpecPrimaryLabel } from "./ParameterSpecLibrary";
import { subjectPickerFlatNodes, subjectsFromModules } from "./SpecCreateDialog";

export type ParameterSpecDetailDialogProps = {
  detail: ParameterSpecDetailView;
  onClose: () => void;
  onSave?: (payload: SpecEditorSavePayload) => void | Promise<void>;
  onDeprecate?: (input: { reason: string }) => void | Promise<void>;
  onRestore?: (input: { reason: string }) => void | Promise<void>;
  onReattribute?: (input: { attributionSubjectId: string; reason: string }) => void | Promise<void>;
  onRenamePropertyKey?: (input: { propertyKey: string; reason: string }) => void | Promise<void>;
  /** Attribution subjects for the 修正归属 picker (driver-group / node-type modules). */
  identityModules?: ParameterModule[];
  onPrepareCutover?: () => void | Promise<void>;
  onFinalizeCutover?: (input: { reason: string }) => void | Promise<void>;
  pending?: boolean;
  error?: string | null;
  /** Platform super admin may deprecate/restore platform-global definitions. */
  canDeprecateGlobal?: boolean;
};

/**
 * Spec editor dialog — legacy parameter-admin shell
 * (`modal-backdrop` + `submission-dialog param-admin-editor-dialog`).
 * Org-owned drafts save via activate; org-owned active specs via update.
 * Soft retirement: deprecate / restore with required reason.
 * Save / activate / cutover finalize collect audit reason in a confirm step.
 */
export function ParameterSpecDetailDialog({
  detail,
  onClose,
  onSave,
  onDeprecate,
  onRestore,
  onReattribute,
  onRenamePropertyKey,
  identityModules = [],
  onPrepareCutover,
  onFinalizeCutover,
  pending = false,
  error = null,
  canDeprecateGlobal = false
}: ParameterSpecDetailDialogProps) {
  const editable = typeof onSave === "function";
  const isDraft = detail.reviewState === "draft" && detail.organizationId != null;
  const isDeprecated = detail.reviewState === "deprecated";
  const primaryLabel = formatSpecPrimaryLabel(detail);
  const cutover = detail.cutover;
  const canGovernLifecycle = detail.organizationId != null || canDeprecateGlobal;
  const canCorrectIdentity =
    !isDeprecated &&
    (typeof onReattribute === "function" || typeof onRenamePropertyKey === "function");
  const subjects = useMemo(() => subjectsFromModules(identityModules), [identityModules]);
  const subjectTreeNodes = useMemo(
    () => subjectPickerFlatNodes(identityModules),
    [identityModules],
  );
  const selectableSubjectIds = useMemo(
    () => new Set(subjects.map((subject) => subject.moduleId)),
    [subjects],
  );
  const renameBlockedReason =
    detail.usageCount > 0 ? `已有 ${detail.usageCount} 处引用，不能改属性键` : null;
  const subjectFieldId = useId();
  const [draft, setDraft] = useState<SpecEditorDraft>(() => createSpecEditorDraft(detail));
  const [localError, setLocalError] = useState<string | null>(null);
  const [lifecycleKind, setLifecycleKind] = useState<"deprecate" | "restore" | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [saveReason, setSaveReason] = useState("");
  const [cutoverConfirmOpen, setCutoverConfirmOpen] = useState(false);
  const [cutoverFinalizeReason, setCutoverFinalizeReason] = useState("");
  const [identityKind, setIdentityKind] = useState<"reattribute" | "rename" | null>(null);
  const [identityReason, setIdentityReason] = useState("");
  const [nextModuleId, setNextModuleId] = useState(() =>
    subjects.find((subject) => subject.attributionSubjectId === detail.attributionSubjectId)?.moduleId ??
      "",
  );
  const [nextPropertyKey, setNextPropertyKey] = useState(detail.propertyKey);

  const moduleIdForSubject = (attributionSubjectId: string | null | undefined) =>
    subjects.find((subject) => subject.attributionSubjectId === attributionSubjectId)?.moduleId ?? "";

  useEffect(() => {
    setDraft(createSpecEditorDraft(detail));
    setLocalError(null);
    setSaveConfirmOpen(false);
    setSaveReason("");
    setCutoverConfirmOpen(false);
    setCutoverFinalizeReason("");
    setNextModuleId(moduleIdForSubject(detail.attributionSubjectId));
    setNextPropertyKey(detail.propertyKey);
  }, [detail.id, detail.reviewState, detail.organizationId, detail.cutover?.status, detail.attributionSubjectId, detail.propertyKey, subjects]);

  useEffect(() => {
    setLifecycleKind(null);
    setLifecycleReason("");
    setIdentityKind(null);
    setIdentityReason("");
  }, [detail.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) {
        if (saveConfirmOpen) {
          setSaveConfirmOpen(false);
          return;
        }
        if (cutoverConfirmOpen) {
          setCutoverConfirmOpen(false);
          return;
        }
        if (identityKind) {
          setIdentityKind(null);
          return;
        }
        if (lifecycleKind) {
          setLifecycleKind(null);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, pending, identityKind, lifecycleKind, saveConfirmOpen, cutoverConfirmOpen]);

  const saveLabel = useMemo(() => {
    if (!editable) return "完成";
    if (pending) return isDraft ? "激活中…" : "保存中…";
    return isDraft ? "保存并激活" : "保存";
  }, [editable, isDraft, pending]);

  const isDirty = useMemo(() => isSpecEditorDraftDirty(detail, draft), [detail, draft]);
  // Draft activation is itself a lifecycle change; active/update requires field edits.
  const canSave = editable && !isDeprecated && (isDraft || isDirty);

  const handleDraftChange = (patch: Partial<SpecEditorDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setLocalError(null);
  };

  const openSaveConfirm = () => {
    if (!editable) {
      onClose();
      return;
    }
    if (!canSave) {
      setLocalError("没有可保存的修改。");
      return;
    }
    if (!onSave) {
      setLocalError("当前环境未接线参数定义保存能力。");
      return;
    }
    // Validate content fields with a placeholder reason so audit reason stays on the confirm step.
    const preview = buildSpecEditorSavePayload(detail, draft, "__preview__");
    if (!preview.payload) {
      setLocalError(preview.error);
      return;
    }
    setLocalError(null);
    setSaveReason("");
    setSaveConfirmOpen(true);
  };

  const handleSaveConfirm = async () => {
    if (!onSave) {
      setLocalError("当前环境未接线参数定义保存能力。");
      return;
    }
    const built = buildSpecEditorSavePayload(detail, draft, saveReason);
    if (!built.payload) {
      setLocalError(built.error);
      return;
    }
    await onSave(built.payload);
    setSaveConfirmOpen(false);
    setSaveReason("");
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

  const handleCutoverFinalize = async () => {
    const reason = cutoverFinalizeReason.trim();
    if (!reason) {
      setLocalError("请填写完成切换原因。");
      return;
    }
    await onFinalizeCutover?.({ reason });
    setCutoverConfirmOpen(false);
    setCutoverFinalizeReason("");
  };

  const handleIdentityCorrection = async () => {
    const reason = identityReason.trim();
    if (!reason) {
      setLocalError("请填写修正原因。");
      return;
    }
    if (identityKind === "reattribute") {
      const nextSubject = subjects.find((subject) => subject.moduleId === nextModuleId);
      if (!nextSubject?.attributionSubjectId) {
        setLocalError("请选择新的归属主体。");
        return;
      }
      await onReattribute?.({
        attributionSubjectId: nextSubject.attributionSubjectId,
        reason,
      });
    } else if (identityKind === "rename") {
      if (!nextPropertyKey.trim()) {
        setLocalError("请填写新的属性键。");
        return;
      }
      await onRenamePropertyKey?.({ propertyKey: nextPropertyKey.trim(), reason });
    }
    setIdentityKind(null);
    setIdentityReason("");
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
                    ? "平台全局目录定义可修改展示信息、约束与说明；身份纠错走「修正归属 / 修正属性键」。"
                    : "修改展示信息、约束与说明后保存；选错的归属主体或属性键用「修正」动作纠正。"
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
                <button
                  type="button"
                  className="button primary"
                  disabled={pending}
                  style={{ marginTop: "0.75rem" }}
                  onClick={() => {
                    setLocalError(null);
                    setCutoverFinalizeReason("");
                    setCutoverConfirmOpen(true);
                  }}
                >
                  完成切换…
                </button>
              ) : null}
            </div>
          ) : null}
          <ParameterSpecDetail
            detail={detail}
            draft={draft}
            onDraftChange={handleDraftChange}
            editable={editable && !isDeprecated}
            onCorrectAttribution={
              canCorrectIdentity && onReattribute
                ? () => {
                    setIdentityKind("reattribute");
                    setNextModuleId(moduleIdForSubject(detail.attributionSubjectId));
                    setIdentityReason("");
                    setLocalError(null);
                  }
                : undefined
            }
            onCorrectPropertyKey={
              canCorrectIdentity && onRenamePropertyKey
                ? () => {
                    setIdentityKind("rename");
                    setNextPropertyKey(detail.propertyKey);
                    setIdentityReason("");
                    setLocalError(null);
                  }
                : undefined
            }
            identityCorrectionDisabledReason={renameBlockedReason}
          />
          {saveConfirmOpen ||
          cutoverConfirmOpen ||
          lifecycleKind ||
          identityKind ? null : localError || error ? (
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
          {canGovernLifecycle && !isDeprecated && onDeprecate ? (
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
          {canGovernLifecycle && isDeprecated && onRestore ? (
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
            canSave ? (
              <button
                type="button"
                className="button primary"
                onClick={openSaveConfirm}
                disabled={pending}
              >
                {saveLabel}
              </button>
            ) : (
              <button type="button" className="button primary" onClick={onClose} disabled={pending}>
                完成
              </button>
            )
          ) : (
            <button type="button" className="button primary" onClick={onClose} disabled={pending}>
              完成
            </button>
          )}
        </div>
      </div>
      </div>
      {saveConfirmOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={isDraft ? "确认激活参数定义" : "确认保存参数定义"}
        >
          <div
            className="submission-dialog param-admin-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">参数定义库</span>
                <h2>{isDraft ? "确认激活" : "确认保存"}</h2>
                <p>
                  {isDraft
                    ? `将激活「${primaryLabel}」；请填写激活原因以便审计留痕。`
                    : `将保存「${primaryLabel}」的修改；请填写修改原因以便审计留痕。`}
                </p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={() => {
                  setSaveConfirmOpen(false);
                  setSaveReason("");
                }}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              <label className="param-admin-confirm-field">
                <span>{isDraft ? "激活原因" : "修改原因"}</span>
                <textarea
                  aria-label={isDraft ? "激活原因" : "修改原因"}
                  value={saveReason}
                  rows={4}
                  placeholder="必填，写入审计"
                  autoFocus
                  onChange={(event) => {
                    setSaveReason(event.target.value);
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
                disabled={pending}
                onClick={() => {
                  setSaveConfirmOpen(false);
                  setSaveReason("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleSaveConfirm()}
                disabled={pending}
              >
                {pending ? (isDraft ? "激活中…" : "保存中…") : isDraft ? "确认激活" : "确认保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {cutoverConfirmOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="确认完成版本切换"
        >
          <div
            className="submission-dialog param-admin-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">版本切换</span>
                <h2>确认完成切换</h2>
                <p>
                  将完成「{primaryLabel}」的语义版本切换
                  {cutover ? `（v${cutover.fromVersion} → v${cutover.toVersion}）` : ""}
                  ；请填写原因以便审计留痕。
                </p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={() => {
                  setCutoverConfirmOpen(false);
                  setCutoverFinalizeReason("");
                }}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              <label className="param-admin-confirm-field">
                <span>完成切换原因</span>
                <textarea
                  aria-label="完成切换原因"
                  value={cutoverFinalizeReason}
                  rows={4}
                  placeholder="必填，写入审计"
                  autoFocus
                  onChange={(event) => {
                    setCutoverFinalizeReason(event.target.value);
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
                disabled={pending}
                onClick={() => {
                  setCutoverConfirmOpen(false);
                  setCutoverFinalizeReason("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleCutoverFinalize()}
                disabled={pending}
              >
                {pending ? "切换中…" : "确认完成切换"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {lifecycleKind ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={lifecycleKind === "restore" ? "恢复参数定义" : "废弃参数定义"}
        >
          <div
            className="submission-dialog param-admin-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">参数定义库</span>
                <h2>{lifecycleKind === "restore" ? "恢复参数定义" : "废弃参数定义"}</h2>
                <p>
                  {lifecycleKind === "restore"
                    ? `将恢复「${primaryLabel}」为可用状态；请填写原因以便审计留痕。`
                    : `将废弃「${primaryLabel}」；已有引用不受影响，但新匹配不再使用该定义。`}
                </p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={() => {
                  setLifecycleKind(null);
                  setLifecycleReason("");
                }}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              <label className="param-admin-confirm-field">
                <span>{lifecycleKind === "restore" ? "恢复原因" : "废弃原因"}</span>
                <textarea
                  aria-label={lifecycleKind === "restore" ? "恢复原因" : "废弃原因"}
                  value={lifecycleReason}
                  rows={4}
                  placeholder="必填，写入审计"
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
                disabled={pending}
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
      {identityKind ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={identityKind === "reattribute" ? "修正归属主体" : "修正属性键"}
        >
          <div
            className="submission-dialog param-admin-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">身份纠错</span>
                <h2>{identityKind === "reattribute" ? "修正归属主体" : "修正属性键"}</h2>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={() => {
                  setIdentityKind(null);
                  setIdentityReason("");
                }}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              <div className="param-admin-confirm-summary" role="note">
                {identityKind === "reattribute" ? (
                  <>
                    <p>
                      当前归属：
                      <code>{detail.driverModule?.trim() || detail.attributionSubjectId || "—"}</code>
                    </p>
                    <p className="muted">选错主体时在此纠正；定义 id 不变，不改模块树结构。</p>
                  </>
                ) : (
                  <>
                    <p>
                      当前属性键：
                      <code className="mono">{detail.propertyKey}</code>
                    </p>
                    <p className="muted">仅零引用时可改；确认后会同步重写派生键。</p>
                  </>
                )}
              </div>
              {identityKind === "reattribute" ? (
                <div className="param-admin-confirm-field param-admin-confirm-field--subject">
                  <span id={subjectFieldId}>新归属主体</span>
                  {subjectTreeNodes.length === 0 ? (
                    <p className="muted small">暂无可用驱动登记 / 节点类型</p>
                  ) : (
                    <ModuleTreeSelect
                      mode="single"
                      label="新归属主体"
                      labelledBy={subjectFieldId}
                      nodes={subjectTreeNodes}
                      value={nextModuleId}
                      selectableIds={selectableSubjectIds}
                      placeholder="请选择驱动登记或节点类型"
                      disabled={pending}
                      onChange={(next) => {
                        setNextModuleId(typeof next === "string" ? next : "");
                        setLocalError(null);
                      }}
                    />
                  )}
                </div>
              ) : (
                <label className="param-admin-confirm-field">
                  <span>新属性键</span>
                  <input
                    aria-label="新属性键"
                    className="mono"
                    value={nextPropertyKey}
                    placeholder="例如 active_perf_limit"
                    onChange={(event) => {
                      setNextPropertyKey(event.target.value);
                      setLocalError(null);
                    }}
                  />
                </label>
              )}
              <label className="param-admin-confirm-field">
                <span>修正原因</span>
                <textarea
                  aria-label="修正原因"
                  value={identityReason}
                  rows={3}
                  placeholder="必填，写入审计"
                  onChange={(event) => {
                    setIdentityReason(event.target.value);
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
                disabled={pending}
                onClick={() => {
                  setIdentityKind(null);
                  setIdentityReason("");
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleIdentityCorrection()}
                disabled={pending}
              >
                {identityKind === "reattribute" ? "确认修正归属" : "确认修正属性键"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
