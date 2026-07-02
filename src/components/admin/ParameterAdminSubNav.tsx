import { FolderKanban, LibraryBig } from "lucide-react";

type ParameterAdminSubNavProps = {
  active: "library" | "projects";
  onNavigate: (path: string) => void;
};

export function ParameterAdminSubNav({ active, onNavigate }: ParameterAdminSubNavProps) {
  return (
    <nav className="parameter-admin-subnav" aria-label="参数管理后台分区">
      <button
        type="button"
        className={`parameter-admin-subnav__tab${active === "library" ? " is-active" : ""}`}
        aria-current={active === "library" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin")}
      >
        <LibraryBig size={16} aria-hidden="true" />
        参数库
      </button>
      <button
        type="button"
        className={`parameter-admin-subnav__tab${active === "projects" ? " is-active" : ""}`}
        aria-current={active === "projects" ? "page" : undefined}
        onClick={() => onNavigate("/parameter-admin/projects")}
      >
        <FolderKanban size={16} aria-hidden="true" />
        项目管理
      </button>
    </nav>
  );
}
