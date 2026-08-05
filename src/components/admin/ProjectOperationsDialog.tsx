import { CircleX } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { ModalDialog } from "@/components/common/ModalDialog";

export type ParameterAdminNextProjectView = "files" | "config-sets" | "structure" | "conflicts";

export type ProjectOperationsViewMeta = {
  label: string;
  subtitle: string;
  regionLabel: string;
};

export type ProjectOperationsDialogProps = {
  open: boolean;
  projectId: string;
  projectName: string;
  view: ParameterAdminNextProjectView;
  viewMeta: ProjectOperationsViewMeta;
  viewMetaByView: Record<ParameterAdminNextProjectView, ProjectOperationsViewMeta>;
  projectBase: string;
  auditNotice?: ReactNode;
  onNavigate: (path: string) => void;
  onClose: () => void;
  children: ReactNode;
};

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Deep-linkable project operations surface presented as a modal over the project list.
 *
 * Routes still own the address (`/parameter-admin/projects/:id/:view`); this dialog owns
 * the presentation. It rides the shared `ModalDialog` contract so focus, Escape, and
 * backdrop dismissal stay correct when stacked above confirmations.
 */
export function ProjectOperationsDialog({
  open,
  projectId,
  projectName,
  view,
  viewMeta,
  viewMetaByView,
  projectBase,
  auditNotice,
  onNavigate,
  onClose,
  children
}: ProjectOperationsDialogProps) {
  const navRef = useRef<HTMLElement | null>(null);
  const views = Object.keys(viewMetaByView) as ParameterAdminNextProjectView[];

  const handleNavKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!ARROW_KEYS.has(event.key)) {
      return;
    }
    const links = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const currentIndex = links.findIndex((link) => link === document.activeElement);
    if (links.length === 0 || currentIndex === -1) {
      return;
    }
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? links.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % links.length
            : (currentIndex - 1 + links.length) % links.length;
    links[nextIndex]?.focus();
  };

  return (
    <ModalDialog
      open={open}
      onDismiss={onClose}
      className="submission-dialog project-parameter-files-dialog project-operations-dialog"
      backdropClassName="param-admin-modal-backdrop"
      describedBy
    >
      {({ titleId, descriptionId }) => (
        <>
          <div className="submission-dialog-head param-admin-editor-dialog-head">
            <div className="param-admin-editor-dialog-head-text">
              <span className="eyebrow">项目运营</span>
              <h2 id={titleId}>{projectName}</h2>
              <p id={descriptionId}>{viewMeta.subtitle}</p>
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

          {auditNotice}

          <nav
            ref={navRef}
            className="project-operations-nav"
            aria-label="项目运营视图"
            onKeyDown={handleNavKeyDown}
          >
            {views.map((item) => (
              <button
                key={item}
                type="button"
                className={`project-operations-nav-link${view === item ? " is-active" : ""}`}
                aria-current={view === item ? "page" : undefined}
                onClick={() => onNavigate(`${projectBase}/${item}`)}
              >
                {viewMetaByView[item].label}
              </button>
            ))}
          </nav>

          <div
            className="project-parameter-files-dialog-body"
            data-project-id={projectId}
          >
            {children}
          </div>
        </>
      )}
    </ModalDialog>
  );
}
