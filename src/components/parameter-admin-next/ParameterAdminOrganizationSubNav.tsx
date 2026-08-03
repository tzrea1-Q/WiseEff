import {
  PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS,
  PARAMETER_ADMIN_ORGANIZATION_VIEWS,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { useParameterAdmin } from "./ParameterAdminProvider";

export type ParameterAdminOrganizationSubNavProps = {
  active: ParameterAdminOrganizationView;
  onNavigate: (path: string) => void;
};

/**
 * Organization-scoped peer views (ADR-0015): definition management and module management.
 */
export function ParameterAdminOrganizationSubNav({
  active,
  onNavigate
}: ParameterAdminOrganizationSubNavProps) {
  const { state } = useParameterAdmin();
  const specReviewCount = state.queueCounts.specReview;
  const identityMappingCount = state.queueCounts.identityMapping;

  return (
    <nav className="parameter-admin-subnav" aria-label={PARAMETER_ADMIN_UI.orgSubnavAria}>
      {PARAMETER_ADMIN_ORGANIZATION_VIEWS.map((view) => {
        const badge =
          view === "specs"
            ? specReviewCount + identityMappingCount
            : null;
        return (
          <button
            key={view}
            type="button"
            className={`parameter-admin-subnav__tab${active === view ? " is-active" : ""}`}
            aria-current={active === view ? "page" : undefined}
            onClick={() => onNavigate(`/parameter-admin/${view}`)}
          >
            {PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS[view]}
            {badge !== null && badge > 0 ? (
              <span className="parameter-admin-subnav__count" aria-label={`待处理 ${badge}`}>
                {badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}
