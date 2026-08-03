import { Building2, FolderKanban } from "lucide-react";
import { PARAMETER_ADMIN_UI } from "../../application/parameters/parameterAdminUiCopy";

export type ParameterAdminNextScopeNavProps = {
  active: "organization" | "projects";
  onNavigate: (path: string) => void;
};

/**
 * Peer top-level destinations for governance scope (ADR-0001).
 * Canonical routes: /parameter-admin and /parameter-admin/projects.
 */
export function ParameterAdminNextScopeNav({ active, onNavigate }: ParameterAdminNextScopeNavProps) {
  return (
    <nav className="parameter-admin-scope-nav" aria-label={PARAMETER_ADMIN_UI.scopeNavAria}>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "organization" ? " is-active" : ""}`}
        aria-current={active === "organization" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin")}
      >
        <Building2 size={16} aria-hidden="true" />
        {PARAMETER_ADMIN_UI.orgScope}
      </button>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "projects" ? " is-active" : ""}`}
        aria-current={active === "projects" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin/projects")}
      >
        <FolderKanban size={16} aria-hidden="true" />
        {PARAMETER_ADMIN_UI.projectScope}
      </button>
    </nav>
  );
}
