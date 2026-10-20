import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ModalDialog } from "@/components/common/ModalDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { toAttributionFlatNodes } from "./moduleAttributionTreeUtils";

export type ModuleMoveDialogProps = {
  module: ParameterModule;
  modules: readonly ParameterModule[];
  busy?: boolean;
  /** Move failure — the dialog stays open and shows it in place. */
  error?: string | null;
  onConfirm: (parentId: string | null) => void;
  onCancel: () => void;
};

/**
 * Move a business category or driver group under another business parent (or to root).
 */
export function ModuleMoveDialog({
  module,
  modules,
  busy = false,
  error = null,
  onConfirm,
  onCancel
}: ModuleMoveDialogProps) {
  const targetLabelId = useId();
  const targetLabel = module.kind === "node-type" ? "目标上级模块" : "目标业务分类";
  const [parentId, setParentId] = useState(module.parentId ?? "");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const changed = parentId !== (module.parentId ?? "");
  const requestClose = () => {
    if (busy) return;
    if (changed) setConfirmDiscard(true);
    else onCancel();
  };

  const businessTargets = useMemo(() => {
    const flat = toAttributionFlatNodes(modules);
    const selfPath = flat.find((item) => item.id === module.id)?.path ?? `/${module.id}`;
    const blocked = `${selfPath}/`;
    const allowed = new Set(modules.filter((candidate) => candidate.kind === "business" ||
      (module.kind === "node-type" && (candidate.kind === "driver-group" || candidate.kind === "node-type"))).map((candidate) => candidate.id));
    return flat.filter((item) => allowed.has(item.id) && item.id !== module.id && !item.path.startsWith(blocked));
  }, [module.id, module.kind, modules]);

  useEffect(() => {
    setParentId(module.parentId ?? "");
    setConfirmDiscard(false);
  }, [module.id, module.parentId]);

  return (
    <><ModalDialog
      open={!confirmDiscard}
      onDismiss={busy ? undefined : requestClose}
      className="submission-dialog param-admin-module-edit-dialog module-move-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">模块归属</span>
              <h2 id={titleId}>移动「{module.name}」</h2>
              <p>选择新的上级模块；选「根级」则放到组织树顶层。</p>
            </div>
            <button
              type="button"
              className="audit-dialog-close-icon"
              onClick={requestClose}
              disabled={busy}
              aria-label="关闭"
            >
              <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>

          <div className="param-admin-module-edit-body module-move-dialog__body">
            <div className="module-move-dialog__field">
              <span className="module-move-dialog__label" id={targetLabelId}>
                {targetLabel}
              </span>
              <ModuleTreeSelect
                mode="single"
                includeRootOption
                label={targetLabel}
                labelledBy={targetLabelId}
                nodes={businessTargets}
                value={parentId}
                onChange={(next) => setParentId(typeof next === "string" ? next : "")}
                placeholder="根级（无父模块）"
                disabled={busy}
              />
            </div>
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="button subtle" type="button" disabled={busy} onClick={requestClose}>
              取消
            </button>
            <button
              className="button primary"
              type="button"
              disabled={busy || !changed}
              onClick={() => { if (!busy && changed) onConfirm(parentId || null); }}
            >
              确认移动
            </button>
          </div>
        </>
      )}
    </ModalDialog>
    <ConfirmDialog open={confirmDiscard} title="放弃移动设置？" description="尚未提交的目标模块选择将丢失。"
      confirmLabel="放弃修改" cancelLabel="继续编辑" onConfirm={onCancel} onCancel={() => setConfirmDiscard(false)} />
    </>
  );
}
