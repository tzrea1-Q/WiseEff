import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { MappingApplyPreview } from "@/application/ports/ParameterModuleRegistryRepository";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { UnmappedCompatibleHint } from "@/domain/parameter-topology/moduleDiscovery";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { toBusinessFlatNodes } from "./moduleAttributionTreeUtils";

export type ClassifyCompatibleConfirmInput = {
  businessModuleId: string;
  createBusinessName?: string;
  /** Per-compatible driver-group name (bulk keeps each suggestion). */
  groups: Array<{ compatible: string; driverGroupName: string }>;
};

export type ClassifyCompatibleDialogProps = {
  hints: readonly UnmappedCompatibleHint[];
  modules: readonly ParameterModule[];
  busy?: boolean;
  preview: MappingApplyPreview | null;
  previewError?: string | null;
  onConfirm: (input: ClassifyCompatibleConfirmInput) => void;
  onCancel: () => void;
};

/**
 * Preview-then-apply dialog for filing one or more compatibles under a business category.
 */
export function ClassifyCompatibleDialog({
  hints,
  modules,
  busy = false,
  preview,
  previewError = null,
  onConfirm,
  onCancel
}: ClassifyCompatibleDialogProps) {
  const isBulk = hints.length > 1;
  const targetLabelId = useId();
  const createLabelId = useId();
  const [businessModuleId, setBusinessModuleId] = useState("");
  const [createBusinessName, setCreateBusinessName] = useState("");
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});

  const businessNodes = useMemo(() => toBusinessFlatNodes(modules), [modules]);

  useEffect(() => {
    setBusinessModuleId(businessNodes[0]?.id ?? "");
    setCreateBusinessName("");
    setGroupNames(
      Object.fromEntries(hints.map((hint) => [hint.compatible, hint.suggestedGroupName]))
    );
  }, [businessNodes, hints]);

  const blocked = (preview?.conflicts.length ?? 0) > 0;
  const groups = hints.map((hint) => ({
    compatible: hint.compatible,
    driverGroupName: (groupNames[hint.compatible] ?? hint.suggestedGroupName).trim()
  }));
  const canConfirm =
    Boolean(businessModuleId || createBusinessName.trim()) &&
    groups.every((group) => group.driverGroupName.length > 0) &&
    !busy &&
    !blocked;

  const title = isBulk
    ? PARAMETER_ADMIN_UI.classifyDialogBulkTitle
    : PARAMETER_ADMIN_UI.classifyDialogTitle;

  return (
    <ModalDialog
      open
      onDismiss={onCancel}
      className="submission-dialog param-admin-module-edit-dialog classify-compatible-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.classifyDialogEyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            <p>
              {isBulk ? (
                <>将 {hints.length} 个 compatible 归入同一业务分类；每个 compatible 使用自己的驱动组名。</>
              ) : (
                <>
                  将 <code>{hints[0]?.compatible ?? ""}</code> 归入业务分类下的驱动组。
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onCancel}
            aria-label="关闭"
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body classify-compatible-dialog__body">
          <div className="classify-compatible-dialog__field">
            <span className="classify-compatible-dialog__label" id={targetLabelId}>
              {PARAMETER_ADMIN_UI.classifyTargetBusiness}
            </span>
            <ModuleTreeSelect
              mode="single"
              label={PARAMETER_ADMIN_UI.classifyTargetBusiness}
              labelledBy={targetLabelId}
              nodes={businessNodes}
              value={businessModuleId}
              onChange={(next) => setBusinessModuleId(typeof next === "string" ? next : "")}
              placeholder="选择业务分类"
              disabled={busy}
            />
          </div>

          <div className="classify-compatible-dialog__field">
            <label className="classify-compatible-dialog__label" htmlFor={createLabelId}>
              或新建业务分类
            </label>
            <input
              id={createLabelId}
              aria-label="新建业务分类名称"
              className="classify-compatible-dialog__input"
              value={createBusinessName}
              disabled={busy}
              placeholder="留空则使用上方所选分类"
              onChange={(event) => setCreateBusinessName(event.target.value)}
            />
            <p className="classify-compatible-dialog__hint">填写后将新建该业务分类，并忽略上方选择。</p>
          </div>

          <div className="classify-compatible-dialog__section">
            <h3 className="classify-compatible-dialog__section-title">
              {isBulk ? `驱动组（${hints.length}）` : "驱动组"}
            </h3>
            <ul className="classify-compatible-dialog__hints">
              {hints.map((hint, index) => {
                const groupInputId = `classify-group-${index}`;
                return (
                  <li key={hint.compatible} className="classify-compatible-dialog__hint-card">
                    <div className="classify-compatible-dialog__hint-head">
                      <code>{hint.compatible}</code>
                      <span className="classify-compatible-dialog__hint-meta">
                        {hint.bindingCount} 参数 · {hint.projectCount} 项目
                      </span>
                    </div>
                    <div className="classify-compatible-dialog__field">
                      <label className="classify-compatible-dialog__label" htmlFor={groupInputId}>
                        {PARAMETER_ADMIN_UI.classifyDriverGroupName}
                      </label>
                      <input
                        id={groupInputId}
                        aria-label={`${hint.compatible} 驱动组名称`}
                        className="classify-compatible-dialog__input"
                        value={groupNames[hint.compatible] ?? hint.suggestedGroupName}
                        disabled={busy}
                        onChange={(event) =>
                          setGroupNames((current) => ({
                            ...current,
                            [hint.compatible]: event.target.value
                          }))
                        }
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <section
            className="classify-compatible-dialog__section classify-compatible-dialog__preview-section"
            aria-labelledby="classify-preview-title"
          >
            <h3 id="classify-preview-title" className="classify-compatible-dialog__section-title">
              {PARAMETER_ADMIN_UI.classifyPreview}
            </h3>
            {previewError ? <p className="error-text">{previewError}</p> : null}
            {preview ? (
              <div className="classify-compatible-dialog__preview">
                <p className="classify-compatible-dialog__preview-summary">
                  预计影响 <strong>{preview.affectedBindings}</strong> 个项目参数
                </p>
                {preview.byProject.length > 0 ? (
                  <ul className="classify-compatible-dialog__preview-projects">
                    {preview.byProject.map((row) => (
                      <li key={row.projectId}>
                        项目 {row.projectId}：{row.count}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preview.emptiedModules.length > 0 ? (
                  <p className="classify-compatible-dialog__preview-note">
                    将回收 {preview.emptiedModules.length} 个空未分类桶
                  </p>
                ) : null}
                {preview.conflicts.length > 0 ? (
                  <p className="error-text" role="alert">
                    {PARAMETER_ADMIN_UI.classifyBlocked}（{preview.conflicts.length}）
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="muted">等待影响预览…</p>
            )}
          </section>
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canConfirm}
            onClick={() =>
              onConfirm({
                businessModuleId,
                createBusinessName: createBusinessName.trim() || undefined,
                groups
              })
            }
          >
            {PARAMETER_ADMIN_UI.classifyApply}
          </button>
        </div>
        </>
      )}
    </ModalDialog>
  );
}
