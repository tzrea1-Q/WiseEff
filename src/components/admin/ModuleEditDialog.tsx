import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParameterModuleDraft, PowerManagementParameterModule } from "@/powerManagementConfig";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";

export function ModuleEditDialog({
  module,
  existingNames,
  onSave,
  onCancel
}: {
  module: PowerManagementParameterModule;
  existingNames: readonly string[];
  onSave: (patch: ParameterModuleDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ParameterModuleDraft>({ ...module });

  useEffect(() => {
    setDraft({ ...module });
  }, [module]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canSave = canSubmitModuleDraft(draft, existingNames, module.name);

  return (
    <div className="modal-backdrop param-admin-module-edit-backdrop" role="dialog" aria-modal="true" aria-label={`修改模块 ${module.name}`}>
      <div className="submission-dialog param-admin-module-edit-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">模块修改</span>
            <h2>{module.name}</h2>
            <p>更新模块名称、描述、责任团队与适用范围。修改名称会同步更新共享参数库中的模块归属。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          <ModuleDefinitionForm
            currentName={module.name}
            existingNames={existingNames}
            module={draft}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        </div>

        <div className="dialog-actions">
          <button className="button subtle" type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) {
                return;
              }
              onSave({
                name: draft.name.trim(),
                description: draft.description.trim(),
                owner: draft.owner.trim(),
                scope: draft.scope.trim()
              });
            }}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
