import { ArrowLeft } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export type ParameterAdminNextProjectView = "files" | "config-sets" | "structure" | "conflicts";

export type ProjectOperationsViewMeta = {
  label: string;
  subtitle: string;
  regionLabel: string;
};

export type ProjectOperationsViewProps = {
  projectId: string;
  projectName: string;
  view: ParameterAdminNextProjectView;
  viewMeta: ProjectOperationsViewMeta;
  viewMetaByView: Record<ParameterAdminNextProjectView, ProjectOperationsViewMeta>;
  projectBase: string;
  auditNotice?: ReactNode;
  onNavigate: (path: string) => void;
  onBack: () => void;
  children: ReactNode;
};

const ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * Full-page chrome for one project's operations view.
 *
 * ADR-0001 makes project-scoped work route-addressable rather than nested in a modal.
 * The view name is stated once, by the panel that renders it, so the page header
 * carries the project instead of repeating the view.
 */
export function ProjectOperationsView({
  projectId,
  projectName,
  view,
  viewMeta,
  viewMetaByView,
  projectBase,
  auditNotice,
  onNavigate,
  onBack,
  children
}: ProjectOperationsViewProps) {
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
    <div className="project-operations-view">
      <header className="project-operations-head">
        <button type="button" className="button subtle project-operations-back" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" />
          项目清单
        </button>
        <div className="project-operations-head-text">
          <h2>{projectName}</h2>
          <p>{viewMeta.subtitle}</p>
        </div>
      </header>

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

      {auditNotice}

      <div className="project-operations-body" data-project-id={projectId}>
        {children}
      </div>
    </div>
  );
}
