import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import type { ModuleImportance } from "@/domain/parameter-topology/moduleRegistry";
import type { ParameterModuleDraft } from "@/powerManagementConfig";
import { ModalDialog } from "@/components/common/ModalDialog";
import { canSubmitModuleDraft, ModuleDefinitionForm } from "./ModuleDefinitionForm";

export type ModuleCreateSaveDraft = ParameterModuleDraft & {
  importance?: ModuleImportance;
};

const emptyModuleDraft = (): ParameterModuleDraft => ({
  name: "",
  description: "",
  scope: ""
});

export function ModuleCreateDialog({
  parentName,
  existingNames,
  eyebrow = "模块创建",
  showImportance = false,
  initialImportance = "medium",
  busy = false,
  error = null,
  onCreate,
  onCancel
}: {
  parentName?: string | null;
  existingNames: readonly string[];
  eyebrow?: string;
  showImportance?: boolean;
  initialImportance?: ModuleImportance;
  busy?: boolean;
  /** Create failure — the dialog stays open and shows it in place. */
  error?: string | null;
  onCreate: (draft: ModuleCreateSaveDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ParameterModuleDraft>(emptyModuleDraft);
  const [importance, setImportance] = useState<ModuleImportance>(initialImportance);
  const isChildModule = Boolean(parentName);
  const title = isChildModule ? `在「${parentName}」下创建子模块` : "新增根模块";
  const description = isChildModule
    ? showImportance
      ? "填写子模块名称、重要性、描述与适用范围。创建后会出现在所选父模块下。"
      : "填写子模块名称、描述与适用范围。创建后会出现在所选父模块下。"
    : showImportance
      ? "填写根模块名称、重要性、描述与适用范围。创建后会出现在模块列表顶层。"
      : "填写根模块名称、描述与适用范围。创建后会出现在模块列表顶层。";

  useEffect(() => {
    setDraft(emptyModuleDraft());
    setImportance(initialImportance);
  }, [parentName, initialImportance]);

  const canCreate = canSubmitModuleDraft(draft, existingNames);
  return (
    <ModalDialog
      open
      onDismiss={onCancel}
      className="submission-dialog param-admin-module-edit-dialog module-create-dialog"
      backdropClassName="param-admin-modal-backdrop"
    >
      {({ titleId }) => (
        <>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
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
            showImportance={showImportance}
            importance={importance}
            onImportanceChange={setImportance}
            onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          />
        </div>

        {error ? (
          <p className="form-error" role="alert">
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
            disabled={!canCreate || busy}
            onClick={() => {
              if (!canCreate || busy) {
                return;
              }
              onCreate({
                name: draft.name.trim(),
                description: draft.description.trim(),
                scope: draft.scope.trim(),
                ...(showImportance ? { importance } : {})
              });
            }}
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
        </>
      )}
    </ModalDialog>
  );
}
