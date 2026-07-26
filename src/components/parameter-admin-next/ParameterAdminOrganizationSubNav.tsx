import {
  PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS,
  PARAMETER_ADMIN_ORGANIZATION_VIEWS,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";

export type ParameterAdminOrganizationSubNavProps = {
  active: ParameterAdminOrganizationView;
  onNavigate: (path: string) => void;
};

/**
 * Organization-scoped peer views. Mirrors the project deep-route tab idiom.
 */
export function ParameterAdminOrganizationSubNav({
  active,
  onNavigate
}: ParameterAdminOrganizationSubNavProps) {
  return (
    <nav className="parameter-admin-subnav" aria-label="组织治理子视图">
      {PARAMETER_ADMIN_ORGANIZATION_VIEWS.map((view) => (
        <button
          key={view}
          type="button"
          className={`parameter-admin-subnav__tab${active === view ? " is-active" : ""}`}
          aria-current={active === view ? "page" : undefined}
          onClick={() => onNavigate(`/parameter-admin/${view}`)}
        >
          {PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS[view]}
        </button>
      ))}
    </nav>
  );
}
