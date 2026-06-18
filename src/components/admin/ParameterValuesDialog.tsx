import { CircleX } from "lucide-react";
import { useEffect } from "react";
import { ProjectValueMatrix } from "@/components/ProjectValueMatrix";
import type { ParameterValueDraft } from "@/App";
import type { PowerManagementParameterTemplate, PowerManagementProject, PowerManagementProjectId } from "@/powerManagementConfig";

export type ParameterValuesDialogProps = {
  parameter: PowerManagementParameterTemplate;
  projects: readonly PowerManagementProject[];
  onValueChange: (projectId: PowerManagementProjectId, patch: Partial<ParameterValueDraft>) => void;
  onClose: () => void;
};

export function ParameterValuesDialog({ parameter, projects, onValueChange, onClose }: ParameterValuesDialogProps) {
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
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={`修改项目参数值 ${parameter.name}`}>
      <div className="submission-dialog submission-dialog--wide param-admin-editor-dialog">
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">项目参数值</span>
            <h2 id="param-values-dialog-title">{parameter.name}</h2>
            <p>按项目维护当前值，推荐值由共享参数定义统一生效。</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭">
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="param-admin-editor-dialog-body">
          <ProjectValueMatrix parameter={parameter} projects={projects} onValueChange={onValueChange} />
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
