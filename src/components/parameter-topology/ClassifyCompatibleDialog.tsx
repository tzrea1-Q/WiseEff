import { CircleX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import type { MappingApplyPreview } from "@/application/ports/ParameterModuleRegistryRepository";
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

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
    <div
      className="modal-backdrop param-admin-module-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="submission-dialog param-admin-module-edit-dialog classify-compatible-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{PARAMETER_ADMIN_UI.classifyDialogEyebrow}</span>
            <h2>{title}</h2>
            <p>
              {isBulk
                ? `将 ${hints.length} 个 compatible 归入同一业务分类；每个 compatible 使用自己的驱动组名。`
                : `将 ${hints[0]?.compatible ?? ""} 归入业务分类下的驱动组。`}
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
          <label>
            {PARAMETER_ADMIN_UI.classifyTargetBusiness}
            <ModuleTreeSelect
              mode="single"
              label={PARAMETER_ADMIN_UI.classifyTargetBusiness}
              nodes={businessNodes}
              value={businessModuleId}
              onChange={(next) => setBusinessModuleId(typeof next === "string" ? next : "")}
              placeholder="选择业务分类"
              disabled={busy}
            />
          </label>

          <label>
            或新建业务分类
            <input
              aria-label="新建业务分类名称"
              value={createBusinessName}
              disabled={busy}
              placeholder="留空则使用上方所选分类"
              onChange={(event) => setCreateBusinessName(event.target.value)}
            />
          </label>

          <ul className="classify-compatible-dialog__hints">
            {hints.map((hint) => (
              <li key={hint.compatible}>
                <code>{hint.compatible}</code>
                <label>
                  {PARAMETER_ADMIN_UI.classifyDriverGroupName}
                  <input
                    aria-label={`${hint.compatible} 驱动组名称`}
                    value={groupNames[hint.compatible] ?? hint.suggestedGroupName}
                    disabled={busy}
                    onChange={(event) =>
                      setGroupNames((current) => ({
                        ...current,
                        [hint.compatible]: event.target.value
                      }))
                    }
                  />
                </label>
                <span>
                  {hint.bindingCount} 参数 · {hint.projectCount} 项目
                </span>
              </li>
            ))}
          </ul>

          <section aria-labelledby="classify-preview-title">
            <h3 id="classify-preview-title">{PARAMETER_ADMIN_UI.classifyPreview}</h3>
            {previewError ? <p className="error-text">{previewError}</p> : null}
            {preview ? (
              <div className="classify-compatible-dialog__preview">
                <p>预计影响 {preview.affectedBindings} 个项目参数</p>
                {preview.byProject.length > 0 ? (
                  <ul>
                    {preview.byProject.map((row) => (
                      <li key={row.projectId}>
                        项目 {row.projectId}：{row.count}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {preview.emptiedModules.length > 0 ? (
                  <p>将回收 {preview.emptiedModules.length} 个空未分类桶</p>
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
      </div>
    </div>
  );
}
