import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { presentError } from "@/infrastructure/http/presentError";

import {
  ParameterSpecDetail,
  buildSpecEditorSavePayload,
  createSpecEditorDraft,
  isSpecEditorDraftDirty,
  type ParameterSpecDetailView,
  type SpecEditorDraft,
  type SpecEditorSavePayload,
  type SpecRelatedKnowledgeSource
} from "./ParameterSpecDetail";
import { formatSpecPrimaryLabel } from "./ParameterSpecLibrary";
import {
  PropertyKeyCutoverPanel,
  type PropertyKeyCutoverActions,
} from "./PropertyKeyCutoverPanel";
import { specEditorSaveDiff, stablePrettyJson } from "./specEditorSaveDiff";
import { subjectPickerFlatNodes, subjectsFromModules } from "./SpecCreateDialog";

const EMPTY_IDENTITY_MODULES: ParameterModule[] = [];
const NESTED_CONFIRM_BACKDROP = "param-admin-modal-backdrop param-admin-modal-backdrop--nested";

function SpecEditorSaveDiffBlock({
  label,
  previous,
  next,
}: {
  label: string;
  previous: Record<string, unknown>;
  next: Record<string, unknown>;
}) {
  return (
    <div className="param-admin-save-diff__field">
      <strong className="param-admin-save-diff__heading">{label}</strong>
      <div className="param-admin-save-diff__sides">
        <div className="param-admin-save-diff__side">
          <span>变更前</span>
          <pre aria-label={`${label} 变更前`} className="param-admin-save-diff__json">
            {stablePrettyJson(previous)}
          </pre>
        </div>
        <div className="param-admin-save-diff__side">
          <span>变更后</span>
          <pre aria-label={`${label} 变更后`} className="param-admin-save-diff__json">
            {stablePrettyJson(next)}
          </pre>
        </div>
      </div>
    </div>
  );
}

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
  propertyKeyCutover?: PropertyKeyCutoverActions;
  pending?: boolean;
  error?: string | null;
  /** Platform super admin may deprecate/restore platform-global definitions. */
  canDeprecateGlobal?: boolean;
  /** Published knowledge referencing this definition (hidden without knowledge:view). */
  relatedKnowledge?: SpecRelatedKnowledgeSource;
};

/**
 * Spec editor dialog on the shared ModalDialog contract
 * (card: `submission-dialog param-admin-editor-dialog`).
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
  identityModules = EMPTY_IDENTITY_MODULES,
  onPrepareCutover,
  onFinalizeCutover,
  propertyKeyCutover,
  pending = false,
  error = null,
  canDeprecateGlobal = false,
  relatedKnowledge
}: ParameterSpecDetailDialogProps) {
  const editable = typeof onSave === "function";
  const isDraft = detail.reviewState === "draft" && detail.organizationId != null;
  const isDeprecated = detail.reviewState === "deprecated";
  const fieldsEditable = editable && !isDeprecated;
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
  const [saveAcknowledged, setSaveAcknowledged] = useState(false);
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
    setSaveAcknowledged(false);
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

  const saveLabel = useMemo(() => {
    if (!editable) return "完成";
    if (pending) return isDraft ? "激活中…" : "保存中…";
    return isDraft ? "保存并激活" : "保存";
  }, [editable, isDraft, pending]);

  const isDirty = useMemo(() => isSpecEditorDraftDirty(detail, draft), [detail, draft]);
  // Draft activation is itself a lifecycle change; active/update requires field edits.
  const canSave = editable && !isDeprecated && (isDraft || isDirty);
  const saveDiff = useMemo(() => {
    if (!saveConfirmOpen) return null;
    const preview = buildSpecEditorSavePayload(detail, draft, "__preview__");
    if (!preview.payload) return null;
    return specEditorSaveDiff(detail, preview.payload);
  }, [saveConfirmOpen, detail, draft]);
  const saveDiffVisible = Boolean(saveDiff?.valueShapeChanged || saveDiff?.constraintsChanged);
  const needsSaveAcknowledgement = detail.usageCount > 0;

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
    setSaveAcknowledged(false);
    setSaveConfirmOpen(true);
  };

  const closeSaveConfirm = () => {
    setSaveConfirmOpen(false);
    setSaveReason("");
    setSaveAcknowledged(false);
  };

  const handleSaveConfirm = async () => {
    if (!onSave) {
      setLocalError("当前环境未接线参数定义保存能力。");
      return;
    }
    if (needsSaveAcknowledgement && !saveAcknowledged) {
      setLocalError(`请确认已了解该定义有 ${detail.usageCount} 处引用。`);
      return;
    }
    const built = buildSpecEditorSavePayload(detail, draft, saveReason);
    if (!built.payload) {
      setLocalError(built.error);
      return;
    }
    try {
      await onSave(built.payload);
    } catch {
      // Keep the confirm layer (and the typed audit reason) on failure;
      // the panel-provided `error` prop renders inside the layer.
      return;
    }
    closeSaveConfirm();
  };

  const handleLifecycle = async () => {
    const reason = lifecycleReason.trim();
    if (!reason) {
      setLocalError(lifecycleKind === "restore" ? "请填写恢复原因。" : "请填写废弃原因。");
      return;
    }
    try {
      if (lifecycleKind === "deprecate") {
        await onDeprecate?.({ reason });
      } else if (lifecycleKind === "restore") {
        await onRestore?.({ reason });
      }
    } catch {
      return;
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
    try {
      await onFinalizeCutover?.({ reason });
    } catch {
      return;
    }
    setCutoverConfirmOpen(false);
    setCutoverFinalizeReason("");
  };

  const handleIdentityCorrection = async () => {
    const reason = identityReason.trim();
    if (!reason) {
      setLocalError("请填写修正原因。");
      return;
    }
    try {
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
    } catch (caught) {
      setLocalError(presentError(caught, "身份修正失败，请检查后重试。"));
      return;
    }
    setIdentityKind(null);
    setIdentityReason("");
  };

  return (
    <>
      <ModalDialog
        open
        onDismiss={pending ? undefined : onClose}
        className="submission-dialog param-admin-editor-dialog submission-dialog--wide"
        backdropClassName="param-admin-modal-backdrop"
      >
        {({ titleId }) => (
          <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">
              {fieldsEditable
                ? PARAMETER_ADMIN_UI.specDetailEyebrowEditable
                : PARAMETER_ADMIN_UI.specDetailEyebrowReadonly}
            </span>
            <h2 id={titleId}>{primaryLabel}</h2>
            <p>
              {isDeprecated
                ? "已废弃，仅可查看或恢复。"
                : fieldsEditable
                  ? isDraft
                    ? "修改展示信息、取值形态与约束后保存并激活，供定义匹配审核批准项目参数。"
                    : detail.organizationId == null
                      ? "平台全局目录定义可修改展示信息、约束与说明；身份纠错走「修正归属 / 修正属性键」。"
                      : "修改展示信息、约束与说明后保存；选错的归属主体或属性键用「修正」动作纠正。"
                  : "当前未接线保存能力，仅可查看。"}
            </p>
            {typeof detail.usageCount === "number" ? (
              <p className="form-hint" aria-label={PARAMETER_ADMIN_UI.referenceCountLabel}>
                {PARAMETER_ADMIN_UI.referenceCountLabel}：{detail.usageCount}（
                {PARAMETER_ADMIN_UI.referenceCountAsOccurrence}）
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
            <div className="param-admin-cutover-panel">
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
                  className="button primary param-admin-cutover-panel__finalize"
                  disabled={pending}
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
          {propertyKeyCutover && detail.usageCount > 0 && detail.propertyKey ? (
            <PropertyKeyCutoverPanel
              currentKey={detail.propertyKey}
              pending={pending}
              actions={propertyKeyCutover}
            />
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
            relatedKnowledge={relatedKnowledge}
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
          </>
        )}
      </ModalDialog>
      {saveConfirmOpen ? (
        <ModalDialog
          open
          onDismiss={pending ? undefined : closeSaveConfirm}
          className={
            saveDiffVisible
              ? "submission-dialog param-admin-confirm-dialog param-admin-confirm-dialog--diff"
              : "submission-dialog param-admin-confirm-dialog"
          }
          backdropClassName={NESTED_CONFIRM_BACKDROP}
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">参数定义库</span>
                <h2 id={titleId}>{isDraft ? "确认激活" : "确认保存"}</h2>
                <p>
                  {isDraft
                    ? needsSaveAcknowledgement
                      ? `将激活「${primaryLabel}」；该定义已有 ${detail.usageCount} 处引用。请填写激活原因以便审计留痕。`
                      : `将激活「${primaryLabel}」；请填写激活原因以便审计留痕。`
                    : needsSaveAcknowledgement
                      ? `将保存「${primaryLabel}」的修改；该定义已有 ${detail.usageCount} 处引用。请填写修改原因以便审计留痕。`
                      : `将保存「${primaryLabel}」的修改；请填写修改原因以便审计留痕。`}
                </p>
              </div>
              <button
                type="button"
                className="audit-dialog-close-icon"
                aria-label="关闭"
                disabled={pending}
                onClick={closeSaveConfirm}
              >
                <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
            <div className="param-admin-confirm-dialog-body">
              {saveDiffVisible && saveDiff ? (
                <div
                  className="param-admin-confirm-summary param-admin-save-diff"
                  role="region"
                  aria-label="值形状与约束变更"
                >
                  {saveDiff.valueShapeChanged ? (
                    <SpecEditorSaveDiffBlock
                      label="值形状 valueShape"
                      previous={saveDiff.previousValueShape}
                      next={saveDiff.nextValueShape}
                    />
                  ) : null}
                  {saveDiff.constraintsChanged ? (
                    <SpecEditorSaveDiffBlock
                      label="约束 constraints"
                      previous={saveDiff.previousConstraints}
                      next={saveDiff.nextConstraints}
                    />
                  ) : null}
                </div>
              ) : null}
              <label className="param-admin-confirm-field">
                <span className="def-field-label-row">
                  {isDraft ? "激活原因" : "修改原因"}
                  <span className="label-hint" aria-hidden="true">
                    必填
                  </span>
                </span>
                <textarea
                  aria-label={isDraft ? "激活原因" : "修改原因"}
                  aria-required="true"
                  value={saveReason}
                  rows={4}
                  placeholder="写入审计"
                  autoFocus
                  onChange={(event) => {
                    setSaveReason(event.target.value);
                    setLocalError(null);
                  }}
                />
              </label>
              {needsSaveAcknowledgement ? (
                <label className="param-admin-confirm-acknowledge">
                  <input
                    type="checkbox"
                    checked={saveAcknowledged}
                    disabled={pending}
                    onChange={(event) => {
                      setSaveAcknowledged(event.target.checked);
                      setLocalError(null);
                    }}
                  />
                  <span>{`已有 ${detail.usageCount} 处引用；我确认继续保存该定义。`}</span>
                </label>
              ) : null}
              {localError || error ? <p className="form-error" role="alert">{localError || error}</p> : null}
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button subtle"
                disabled={pending}
                onClick={closeSaveConfirm}
              >
                取消
              </button>
              <button
                type="button"
                className="button primary"
                onClick={() => void handleSaveConfirm()}
                disabled={pending || !saveReason.trim() || (needsSaveAcknowledgement && !saveAcknowledged)}
              >
                {pending ? (isDraft ? "激活中…" : "保存中…") : isDraft ? "确认激活" : "确认保存"}
              </button>
            </div>
            </>
          )}
        </ModalDialog>
      ) : null}
      {cutoverConfirmOpen ? (
        <ModalDialog
          open
          onDismiss={
            pending
              ? undefined
              : () => {
                  setCutoverConfirmOpen(false);
                  setCutoverFinalizeReason("");
                }
          }
          className="submission-dialog param-admin-confirm-dialog"
          backdropClassName={NESTED_CONFIRM_BACKDROP}
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">版本切换</span>
                <h2 id={titleId}>确认完成切换</h2>
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
              {localError || error ? <p className="form-error" role="alert">{localError || error}</p> : null}
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
            </>
          )}
        </ModalDialog>
      ) : null}
      {lifecycleKind ? (
        <ModalDialog
          open
          onDismiss={
            pending
              ? undefined
              : () => {
                  setLifecycleKind(null);
                  setLifecycleReason("");
                }
          }
          className="submission-dialog param-admin-confirm-dialog"
          backdropClassName={NESTED_CONFIRM_BACKDROP}
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">参数定义库</span>
                <h2 id={titleId}>{lifecycleKind === "restore" ? "恢复参数定义" : "废弃参数定义"}</h2>
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
              {localError || error ? <p className="form-error" role="alert">{localError || error}</p> : null}
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
            </>
          )}
        </ModalDialog>
      ) : null}
      {identityKind ? (
        <ModalDialog
          open
          onDismiss={
            pending
              ? undefined
              : () => {
                  setIdentityKind(null);
                  setIdentityReason("");
                }
          }
          className="submission-dialog param-admin-confirm-dialog"
          backdropClassName={NESTED_CONFIRM_BACKDROP}
        >
          {({ titleId }) => (
            <>
            <div className="submission-dialog-head param-admin-editor-dialog-head">
              <div className="param-admin-editor-dialog-head-text">
                <span className="eyebrow">身份纠错</span>
                <h2 id={titleId}>{identityKind === "reattribute" ? "修正归属主体" : "修正属性键"}</h2>
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
              {localError || error ? <p className="form-error" role="alert">{localError || error}</p> : null}
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
            </>
          )}
        </ModalDialog>
      ) : null}
    </>
  );
}
