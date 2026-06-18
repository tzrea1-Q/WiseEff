import { CircleX } from "lucide-react";
import { useEffect } from "react";
import { ParameterDefinitionForm } from "@/components/ParameterDefinitionForm";
import type { ParameterEditorDraft } from "@/App";
import type { PowerManagementParameterTemplate, PowerManagementProject } from "@/powerManagementConfig";

export type ParameterDefinitionDialogProps = {
  parameter: PowerManagementParameterTemplate;
  projects: readonly PowerManagementProject[];
  allParameters: readonly PowerManagementParameterTemplate[];
  onMetadataChange: (patch: Partial<ParameterEditorDraft>) => void;
  onRecommendedValueChange: (value: string) => void;
  onClose: () => void;
};

export function ParameterDefinitionDialog({
  parameter,
  projects,
  allParameters,
  onMetadataChange,
  onRecommendedValueChange,
  onClose
}: ParameterDefinitionDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`修改参数定义 ${parameter.name}`}>
      <div className="submission-dialog param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">共享参数定义</span>
            <h2 id="param-definition-dialog-title">{parameter.name}</h2>
            <p>修改名称、模块、风险、推荐值与描述信息，对所有项目生效。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <ParameterDefinitionForm
            allParameters={allParameters}
            parameter={parameter}
            projects={projects}
            onMetadataChange={onMetadataChange}
            onRecommendedValueChange={onRecommendedValueChange}
          />
        </div>

        <div className="dialog-actions">
          <button type="button" className="button primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
