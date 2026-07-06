import { useRef } from "react";
import type { Project } from "@/mockData";

export const IMPORT_SOURCE_FILE_ACCEPT = ".xlsx,.csv,.json,.dts,.dtsi,.txt";

export type StepSourceAndProjectSourceInput = {
  name: string;
  text: string;
  bytes: Uint8Array | null;
};

export type StepSourceAndProjectProps = {
  projects: Project[];
  targetProjectId: string;
  onTargetProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  sourceName: string;
  sourceText: string;
  sourceBytes: Uint8Array | null;
  onSourceChange: (input: StepSourceAndProjectSourceInput) => void;
  onDownloadTemplate: () => void;
  onNext: () => void;
};

export function StepSourceAndProject({
  projects,
  targetProjectId,
  onTargetProjectChange,
  onCreateProject,
  sourceName,
  sourceText,
  sourceBytes,
  onSourceChange,
  onDownloadTemplate,
  onNext
}: StepSourceAndProjectProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : null;
      onSourceChange({ name: file.name, text: "", bytes });
    };
    reader.readAsArrayBuffer(file);
  };

  const handlePasteChange = (value: string) => {
    onSourceChange({
      name: sourceName || "pasted-import.txt",
      text: value,
      bytes: value.trim() ? null : sourceBytes
    });
  };

  const canProceed = Boolean(targetProjectId) && (sourceText.trim().length > 0 || Boolean(sourceBytes));

  return (
    <div className="parameter-import-wizard-step" aria-label="选择来源与目标项目">
      <div className="parameter-import-wizard-grid">
        <label>
          <span>目标项目</span>
          <select value={targetProjectId} onChange={(event) => onTargetProjectChange(event.target.value)}>
            <option value="" disabled>
              请选择目标项目
            </option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}（{project.code}）
              </option>
            ))}
          </select>
        </label>
        <div className="parameter-import-wizard-new-project">
          <button type="button" className="button subtle" onClick={onCreateProject}>
            + 新建项目
          </button>
        </div>
        <label className="full-row">
          <span>导入文件</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={IMPORT_SOURCE_FILE_ACCEPT}
            onChange={(event) => handleFileChange(event.target.files?.[0])}
          />
        </label>
        <label className="full-row">
          <span>粘贴导入内容（可选）</span>
          <textarea
            rows={8}
            value={sourceText}
            onChange={(event) => handlePasteChange(event.target.value)}
            placeholder="粘贴 JSON、CSV 或 DTS 片段内容"
          />
        </label>
      </div>
      {sourceName ? <p className="parameter-import-wizard-source-name">已选择文件：{sourceName}</p> : null}
      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onDownloadTemplate}>
          下载导入模板
        </button>
        <button type="button" className="button primary" disabled={!canProceed} onClick={onNext}>
          下一步
        </button>
      </div>
    </div>
  );
}
