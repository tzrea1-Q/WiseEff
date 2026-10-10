import { Building2, FolderKanban } from "lucide-react";
import { ViewSwitch } from "@/components/ui/view-switch";
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
    <ViewSwitch variant="section" ariaLabel={PARAMETER_ADMIN_UI.scopeNavAria} value={active}
      onValueChange={(value) => onNavigate(value === "projects" ? "/parameter-admin/projects" : "/parameter-admin")}
      items={[
        { value: "organization", label: <><Building2 size={16} aria-hidden="true" />{PARAMETER_ADMIN_UI.orgScope}</> },
        { value: "projects", label: <><FolderKanban size={16} aria-hidden="true" />{PARAMETER_ADMIN_UI.projectScope}</> }
      ]} />
  );
}
