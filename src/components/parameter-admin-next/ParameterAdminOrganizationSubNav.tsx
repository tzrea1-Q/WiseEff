import {
  PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS,
  PARAMETER_ADMIN_ORGANIZATION_VIEWS,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ViewSwitch } from "@/components/ui/view-switch";
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
    <ViewSwitch variant="section" ariaLabel={PARAMETER_ADMIN_UI.orgSubnavAria} value={active}
      onValueChange={(value) => onNavigate(`/parameter-admin/${value}`)}
      items={PARAMETER_ADMIN_ORGANIZATION_VIEWS.map((view) => {
        const badge =
          view === "specs"
            ? specReviewCount + identityMappingCount
            : null;
        return { value: view, label: <>
            {PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS[view]}
            {badge !== null && badge > 0 ? (
              <span className="parameter-admin-subnav__count" aria-label={`待处理 ${badge}`}>
                {badge}
              </span>
            ) : null}
          </> };
      })} />
  );
}
