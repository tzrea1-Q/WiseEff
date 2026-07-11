import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

export function ModuleCreateDialog({
  parentName,
  existingNames,
  eyebrow = "模块创建",
  onCreate,
  onCancel
}: {
  parentName?: string | null;
  existingNames: readonly string[];
  eyebrow?: string;
  onCreate: (draft: ParameterModuleDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ParameterModuleDraft>(emptyModuleDraft);
  const isChildModule = Boolean(parentName);
  const dialogLabel = isChildModule ? `在 ${parentName} 下创建子模块` : "新增根模块";
  const title = isChildModule ? `在「${parentName}」下创建子模块` : "新增根模块";
  const description = isChildModule
    ? "填写子模块名称、描述与适用范围。创建后会出现在所选父模块下。"
    : "填写根模块名称、描述与适用范围。创建后会出现在模块列表顶层。";

  useEffect(() => {
    setDraft(emptyModuleDraft());
  }, [parentName]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const canCreate = canSubmitModuleDraft(draft, existingNames);

  return (
    <div className="modal-backdrop param-admin-module-edit-backdrop" role="dialog" aria-modal="true" aria-label={dialogLabel}>
      <div className="submission-dialog param-admin-module-edit-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{eyebrow}</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onCancel} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-module-edit-body">
          <ModuleDefinitionForm
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
            disabled={!canCreate}
            onClick={() => {
              if (!canCreate) {
                return;
              }
              onCreate({
                name: draft.name.trim(),
                description: draft.description.trim(),
                scope: draft.scope.trim()
              });
            }}
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
