import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { modulePathSegments } from "@/components/admin/moduleManagementTreeUtils";
import { ModalDialog } from "@/components/common/ModalDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { FlatModuleNode } from "@/domain/modules/moduleTree";

export type DebugModuleMoveDialogProps = {
  module: FlatModuleNode;
  modules: readonly FlatModuleNode[];
  onConfirm: (parentId: string | null) => void | Promise<void>;
  onCancel: () => void;
};

/** Move a debugging module while keeping its subtree attached to the module. */
export function DebugModuleMoveDialog({
  module,
  modules,
  onConfirm,
  onCancel
}: DebugModuleMoveDialogProps) {
  const targetLabelId = useId();
  const [parentId, setParentId] = useState(module.parentId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentPath = useMemo(() => modulePathSegments(module, modules).join(" / "), [module, modules]);
  const blockedModuleIds = useMemo(() => {
    const blocked = new Set<string>([module.id]);
    let changed = true;

    while (changed) {
      changed = false;
      for (const candidate of modules) {
        if (candidate.parentId && blocked.has(candidate.parentId) && !blocked.has(candidate.id)) {
          blocked.add(candidate.id);
          changed = true;
        }
      }
    }

    return blocked;
  }, [module.id, modules]);
  const targetModules = useMemo(() => {
    const pathPrefix = module.path ? `${module.path}/` : "";
    return modules.filter(
      (candidate) =>
        !blockedModuleIds.has(candidate.id) &&
        (!pathPrefix || !candidate.path.startsWith(pathPrefix))
    );
  }, [blockedModuleIds, module.path, modules]);
  const unchanged = (module.parentId ?? "") === parentId;

  useEffect(() => {
    setParentId(module.parentId ?? "");
    setError(null);
  }, [module.id, module.parentId]);

  const confirmMove = async () => {
    if (busy || unchanged) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onConfirm(parentId || null);
      onCancel();
    } catch {
      setError("移动模块失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open
      onDismiss={busy ? undefined : onCancel}
      className="submission-dialog param-admin-module-edit-dialog module-move-dialog debug-module-move-dialog"
      backdropClassName="param-admin-modal-backdrop param-admin-modal-backdrop--nested"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">模块归属</span>
              <h2 id={titleId}>移动「{module.name}」</h2>
              <p id={descriptionId}>
                选择新的父模块。模块下的子模块和节点会随当前模块一起移动；选择根级可移回顶层。
              </p>
            </div>
            <button
              type="button"
              className="audit-dialog-close-icon"
              aria-label="关闭"
              disabled={busy}
              onClick={onCancel}
            >
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="param-admin-module-edit-body module-move-dialog__body debug-module-move-dialog__body">
            <div className="debug-module-move-dialog__context" aria-label="当前模块">
              <span className="debug-module-move-dialog__context-label">当前模块</span>
              <strong>{module.name}</strong>
              <p>当前位置：{currentPath}</p>
            </div>

            <div className="module-move-dialog__field debug-module-move-dialog__field">
              <span className="module-move-dialog__label debug-module-move-dialog__label" id={targetLabelId}>
                目标父模块
              </span>
              <ModuleTreeSelect
                mode="single"
                label="目标父模块"
                labelledBy={targetLabelId}
                nodes={targetModules}
                value={parentId}
                onChange={(next) => setParentId(typeof next === "string" ? next : "")}
                placeholder="根级（无父模块）"
                includeRootOption
                initialExpandedDepth={0}
                disabled={busy}
              />
              <p className="debug-module-move-dialog__hint">
                不能选择当前模块或其子模块作为父模块。
              </p>
            </div>

            {unchanged ? (
              <p className="debug-module-move-dialog__hint" role="status">
                当前父模块未改变，请选择新的目标后再确认移动。
              </p>
            ) : null}
          </div>

          {error ? (
            <p className="form-error debug-module-move-dialog__error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="dialog-actions">
            <button className="button subtle" type="button" disabled={busy} onClick={onCancel}>
              取消
            </button>
            <button
              className="button primary"
              type="button"
              aria-busy={busy}
              disabled={busy || unchanged}
              title={unchanged ? "请选择不同的父模块。" : undefined}
              onClick={() => void confirmMove()}
            >
              {busy ? "正在移动…" : "确认移动"}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
