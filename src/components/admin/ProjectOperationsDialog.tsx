import { CircleX } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export type ParameterAdminNextProjectView = "files" | "config-sets" | "structure" | "conflicts";

export type ProjectOperationsDialogViewMeta = {
  label: string;
  titlePrefix: string;
  subtitle: string;
  regionLabel: string;
};

export type ProjectOperationsDialogProps = {
  open: boolean;
  projectId: string;
  projectName: string;
  view: ParameterAdminNextProjectView;
  viewMeta: ProjectOperationsDialogViewMeta;
  viewMetaByView: Record<ParameterAdminNextProjectView, ProjectOperationsDialogViewMeta>;
  projectBase: string;
  latestAuditHint?: ReactNode;
  onNavigate: (path: string) => void;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Deep-linkable project operations surface presented as a modal over the project list.
 */
export function ProjectOperationsDialog({
  open,
  projectId,
  projectName,
  view,
  viewMeta,
  viewMetaByView,
  projectBase,
  latestAuditHint,
  onNavigate,
  onClose,
  children
}: ProjectOperationsDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const title = `${viewMeta.titlePrefix} · ${projectName}`;
  const views = Object.keys(viewMetaByView) as ParameterAdminNextProjectView[];

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-operations-dialog-title"
      onClick={onClose}
    >
      <div
        className="submission-dialog project-parameter-files-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="submission-dialog-head param-admin-editor-dialog-head">
          <div className="param-admin-editor-dialog-head-text">
            <span className="eyebrow">项目运营</span>
            <h2 id="project-operations-dialog-title">{title}</h2>
            <p>{viewMeta.subtitle}</p>
          </div>
          <button
            type="button"
            className="audit-dialog-close-icon"
            onClick={onClose}
            aria-label="关闭项目运营"
          >
            <CircleX size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        {latestAuditHint}

        <nav className="project-parameter-files-tabs" aria-label="项目运营视图">
          {views.map((item) => (
            <button
              key={item}
              type="button"
              className={`project-parameter-files-tab${view === item ? " is-active" : ""}`}
              aria-current={view === item ? "page" : undefined}
              onClick={() => onNavigate(`${projectBase}/${item}`)}
            >
              {viewMetaByView[item].label}
            </button>
          ))}
        </nav>

        <div
          className="project-parameter-files-dialog-body"
          role="region"
          aria-label={viewMeta.regionLabel}
          data-project-id={projectId}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
