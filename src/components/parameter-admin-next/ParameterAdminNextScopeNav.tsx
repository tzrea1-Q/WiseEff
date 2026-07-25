import { Building2, FolderKanban } from "lucide-react";

export type ParameterAdminNextScopeNavProps = {
  active: "organization" | "projects";
  onNavigate: (path: string) => void;
};

/**
 * Peer top-level destinations for governance scope (ADR-0001).
 * Temporary construction routes under /parameter-admin-next*.
 */
export function ParameterAdminNextScopeNav({ active, onNavigate }: ParameterAdminNextScopeNavProps) {
  return (
    <nav className="parameter-admin-subnav" aria-label="参数管理后台治理范围">
      <button
        type="button"
        className={`parameter-admin-subnav__tab${active === "organization" ? " is-active" : ""}`}
        aria-current={active === "organization" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin-next")}
      >
        <Building2 size={16} aria-hidden="true" />
        组织治理
      </button>
      <button
        type="button"
        className={`parameter-admin-subnav__tab${active === "projects" ? " is-active" : ""}`}
        aria-current={active === "projects" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin-next/projects")}
      >
        <FolderKanban size={16} aria-hidden="true" />
        项目运营
      </button>
    </nav>
  );
}
