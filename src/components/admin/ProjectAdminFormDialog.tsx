import { CircleX } from "lucide-react";
import { useEffect, useState } from "react";
import {
  EDITABLE_PROJECT_STATUSES,
  PROJECT_ADMIN_STATUS_LABELS,
  isEditableProjectStatus
} from "@/parameterAdminProjects";

type ProjectAdminFormDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  initialName?: string;
  initialCode?: string;
  initialProjectId?: string;
  initialStatus?: string;
  loading?: boolean;
  error?: string;
  onClose: () => void;
  onSubmit: (input: { name: string; code: string; status?: string }) => void | Promise<void>;
};

export function ProjectAdminFormDialog({
  open,
  mode,
  initialName = "",
  initialCode = "",
  initialProjectId = "",
  initialStatus = "",
  loading = false,
  error = "",
  onClose,
  onSubmit
}: ProjectAdminFormDialogProps) {
  const statusEditable = mode === "edit" && isEditableProjectStatus(initialStatus);
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<string>(statusEditable ? initialStatus : "initialized");

  useEffect(() => {
    if (open) {
      setName(initialName);
      setCode(initialCode);
      setStatus(isEditableProjectStatus(initialStatus) ? initialStatus : "initialized");
    }
  }, [initialCode, initialName, initialStatus, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [loading, onClose, open]);

  if (!open) {
    return null;
  }

  const title = mode === "create" ? "新建项目" : "编辑项目详情";
  const description =
    mode === "create"
      ? "维护项目名称与代号，后续可在参数库中继续配置模块和参数。"
      : "修改项目名称、代号与状态。保存后项目详情与列表会同步更新。";
  const readOnlyStatusLabel = initialStatus ? PROJECT_ADMIN_STATUS_LABELS[initialStatus] ?? initialStatus : "";

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-admin-form-title"
      onClick={loading ? undefined : onClose}
    >
      <div className="submission-dialog project-admin-form-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">{mode === "create" ? "项目管理" : "项目详情"}</span>
            <h2 id="project-admin-form-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="audit-dialog-close-icon" onClick={onClose} aria-label="关闭" disabled={loading}>
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <form
          className="project-admin-form-body project-admin-form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit({
              name: name.trim(),
              code: code.trim().toUpperCase(),
              status: statusEditable ? status : undefined
            });
          }}
        >
          {mode === "edit" && initialProjectId ? (
            <label>
              <span>项目 ID</span>
              <input value={initialProjectId} readOnly aria-readonly="true" className="mono" />
            </label>
          ) : null}
          {statusEditable ? (
            <label>
              <span>项目状态</span>
              <select
                className="project-admin-form-select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                disabled={loading}
              >
                {EDITABLE_PROJECT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {PROJECT_ADMIN_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </label>
          ) : mode === "edit" && readOnlyStatusLabel ? (
            <label>
              <span>项目状态</span>
              <input value={readOnlyStatusLabel} readOnly aria-readonly="true" />
            </label>
          ) : null}
          <label>
            <span>项目名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </label>
          <label>
            <span>项目代号</span>
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required maxLength={16} />
          </label>
          {error ? (
            <p className="project-admin-form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="button subtle" type="button" onClick={onClose} disabled={loading}>
              取消
            </button>
            <button className="button primary" type="submit" disabled={loading || !name.trim() || !code.trim()}>
              {loading ? "保存中…" : mode === "create" ? "创建项目" : "保存修改"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
