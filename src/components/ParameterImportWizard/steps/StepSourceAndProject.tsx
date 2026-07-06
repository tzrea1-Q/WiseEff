import { ClipboardPaste, Upload } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import type { Project } from "@/mockData";
import { cn } from "@/lib/utils";
import { PasteImportContentDialog } from "./PasteImportContentDialog";

export const IMPORT_SOURCE_FILE_ACCEPT = ".xlsx,.csv,.json,.dts,.dtsi,.txt";

export type StepSourceAndProjectSourceInput = {
  name: string;
  text: string;
  bytes: Uint8Array | null;
  sourceFromFile: boolean;
};

export type StepSourceAndProjectProps = {
  projects: Project[];
  targetProjectId: string;
  onTargetProjectChange: (projectId: string) => void;
  onCreateProject: () => void;
  sourceName: string;
  sourceText: string;
  sourceBytes: Uint8Array | null;
  sourceFromFile: boolean;
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
  sourceFromFile,
  onSourceChange,
  onDownloadTemplate,
  onNext
}: StepSourceAndProjectProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const hasUploadedFile = sourceFromFile && Boolean(sourceName);
  const hasPastedContent = !sourceFromFile && sourceText.trim().length > 0;
  const uploadedTextLength = sourceFromFile ? sourceText.trim().length : 0;

  const handleFileChange = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        return;
      }
      const bytes = new Uint8Array(result);
      const lowerName = file.name.toLowerCase();
      const isXlsx =
        lowerName.endsWith(".xlsx") || (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b);
      if (isXlsx) {
        onSourceChange({ name: file.name, text: "", bytes, sourceFromFile: true });
        return;
      }
      const text = new TextDecoder().decode(bytes);
      onSourceChange({ name: file.name, text, bytes: null, sourceFromFile: true });
    };
    reader.readAsArrayBuffer(file);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    handleFileChange(event.dataTransfer.files?.[0]);
  };

  const handlePasteChange = (value: string) => {
    onSourceChange({
      name: value.trim() ? "pasted-import.txt" : "",
      text: value,
      bytes: null,
      sourceFromFile: false
    });
  };

  const openPasteDialog = () => setPasteDialogOpen(true);

  const clearPastedContent = () => {
    handlePasteChange("");
  };

  const canProceed = Boolean(targetProjectId) && (sourceText.trim().length > 0 || Boolean(sourceBytes));

  return (
    <section className="parameter-import-wizard-step" aria-label="选择来源与目标项目">
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
        <div className="parameter-import-wizard-sources">
        <div className="parameter-import-wizard-file-field">
          <span id="parameter-import-file-label">导入文件</span>
          <label
            htmlFor="parameter-import-file-input"
            className={cn(
              "parameter-import-wizard-file-drop",
              dragging && "parameter-import-wizard-file-drop--dragging",
              hasUploadedFile && "parameter-import-wizard-file-drop--selected"
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <input
              id="parameter-import-file-input"
              ref={fileInputRef}
              type="file"
              className="parameter-import-wizard-file-input"
              accept={IMPORT_SOURCE_FILE_ACCEPT}
              aria-labelledby="parameter-import-file-label"
              onChange={(event) => handleFileChange(event.target.files?.[0])}
            />
            <Upload size={22} strokeWidth={2} aria-hidden="true" />
            {hasUploadedFile ? (
              <>
                <strong className="parameter-import-wizard-file-drop__title">{sourceName}</strong>
                <span className="parameter-import-wizard-file-drop__hint">
                  {uploadedTextLength > 0
                    ? `${uploadedTextLength} 个字符 · 点击或拖放可更换`
                    : "已选择文件，点击或拖放可更换"}
                </span>
              </>
            ) : (
              <>
                <strong className="parameter-import-wizard-file-drop__title">点击选择或拖放文件到此处</strong>
                <span className="parameter-import-wizard-file-drop__hint">支持 .xlsx、.csv、.json、.dts、.dtsi、.txt</span>
              </>
            )}
          </label>
        </div>
        <div className="parameter-import-wizard-paste-field">
          <span>粘贴导入内容（可选）</span>
          {hasPastedContent ? (
            <div className="parameter-import-wizard-paste-summary">
              <div className="parameter-import-wizard-paste-summary__copy">
                <ClipboardPaste size={18} aria-hidden="true" />
                <div>
                  <strong>已粘贴导入内容</strong>
                  <span>{sourceText.trim().length} 个字符</span>
                </div>
              </div>
              <div className="parameter-import-wizard-paste-summary__actions">
                <button type="button" className="button subtle" onClick={openPasteDialog}>
                  编辑
                </button>
                <button type="button" className="button subtle" onClick={clearPastedContent}>
                  清除
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="parameter-import-wizard-paste-entry"
              aria-label="粘贴 JSON / CSV / DTS 内容"
              onClick={openPasteDialog}
            >
              <ClipboardPaste size={22} strokeWidth={2} aria-hidden="true" />
              <strong className="parameter-import-wizard-paste-entry__title">粘贴 JSON / CSV / DTS 内容</strong>
              <span className="parameter-import-wizard-paste-entry__hint">适合小段文本或剪贴板内容</span>
            </button>
          )}
        </div>
        </div>
      </div>
      <PasteImportContentDialog
        open={pasteDialogOpen}
        initialValue={sourceFromFile ? "" : sourceText}
        onClose={() => setPasteDialogOpen(false)}
        onConfirm={(value) => {
          handlePasteChange(value);
          setPasteDialogOpen(false);
        }}
      />
      <div className="dialog-actions">
        <button type="button" className="button subtle" onClick={onDownloadTemplate}>
          下载导入模板
        </button>
        <button type="button" className="button primary" disabled={!canProceed} onClick={onNext}>
          下一步
        </button>
      </div>
    </section>
  );
}
