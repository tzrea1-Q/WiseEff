import {
  PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS,
  PARAMETER_ADMIN_ORGANIZATION_VIEWS,
  type ParameterAdminOrganizationView
} from "@/application/parameters/parameterAdminOrganizationPath";
import { PARAMETER_ADMIN_UI } from "@/application/parameters/parameterAdminUiCopy";
import { ViewSwitch } from "@/components/ui/view-switch";
import { useParameterAdmin } from "./ParameterAdminProvider";

type ParameterAdminNavProps = {
  active: ParameterAdminOrganizationView | "projects";
  onNavigate: (path: string) => void;
};

export function ParameterAdminNav({ active, onNavigate }: ParameterAdminNavProps) {
  const { state } = useParameterAdmin();
  const badge = state.queueCounts.specReview + state.queueCounts.identityMapping;

  return (
    <ViewSwitch variant="page" ariaLabel={PARAMETER_ADMIN_UI.pageNavAria} value={active}
      onValueChange={(value) => onNavigate(`/parameter-admin/${value}`)}
      items={[
        ...PARAMETER_ADMIN_ORGANIZATION_VIEWS.map((view) => ({
          value: view,
          group: PARAMETER_ADMIN_UI.organizationGroup,
          label: <>
            {PARAMETER_ADMIN_ORGANIZATION_VIEW_LABELS[view]}
            {view === "specs" && badge > 0 ? (
              <>
                {" "}<span className="sr-only">待处理 {badge}</span>
                <span className="parameter-admin-subnav__count" aria-hidden="true">{badge}</span>
              </>
            ) : null}
          </>
        })),
        { value: "projects", group: PARAMETER_ADMIN_UI.projectGroup, label: PARAMETER_ADMIN_UI.projects }
      ]} />
  );
}
