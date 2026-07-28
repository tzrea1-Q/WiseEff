import { CircleX } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";

import { ModuleTreeSelect } from "@/components/common/ModuleTreeSelect";
import type { ParameterModule } from "@/domain/parameter-topology/moduleRegistry";
import { toBusinessFlatNodes } from "./moduleAttributionTreeUtils";

export type ModuleMoveDialogProps = {
  module: ParameterModule;
  modules: readonly ParameterModule[];
  busy?: boolean;
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
  onConfirm,
  onCancel
}: ModuleMoveDialogProps) {
  const targetLabelId = useId();
  const [parentId, setParentId] = useState("");

  const businessTargets = useMemo(() => {
    const flat = toBusinessFlatNodes(modules);
    const selfPath = flat.find((item) => item.id === module.id)?.path ?? `/${module.id}`;
    const blocked = `${selfPath}/`;
    return flat.filter((item) => item.id !== module.id && !item.path.startsWith(blocked));
  }, [module.id, modules]);

  useEffect(() => {
    setParentId("");
  }, [module.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const title = `移动模块 ${module.name}`;

  return (
    <div
      className="modal-backdrop param-admin-module-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="submission-dialog param-admin-module-edit-dialog module-move-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">模块归属</span>
            <h2>移动「{module.name}」</h2>
            <p>选择新的父级业务分类；选「根级」则放到组织树顶层。</p>
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

        <div className="param-admin-module-edit-body module-move-dialog__body">
          <div className="module-move-dialog__field">
            <span className="module-move-dialog__label" id={targetLabelId}>
              目标业务分类
            </span>
            <ModuleTreeSelect
              mode="single"
              label="目标业务分类"
              labelledBy={targetLabelId}
              nodes={businessTargets}
              value={parentId}
              onChange={(next) => setParentId(typeof next === "string" ? next : "")}
              placeholder="根级（无父模块）"
              disabled={busy}
            />
          </div>
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={() => onConfirm(parentId || null)}
          >
            确认移动
          </button>
        </div>
      </div>
    </div>
  );
}
