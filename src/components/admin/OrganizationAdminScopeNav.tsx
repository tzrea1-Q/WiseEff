import { Building2, FolderKanban, Library, Settings2, Users, UsersRound } from "lucide-react";

import {
  ORGANIZATION_ADMIN_UI,
  buildOrganizationAdminPath,
  type OrganizationAdminArea
} from "@/application/organization/organizationAdminPath";
import { ViewSwitch } from "@/components/ui/view-switch";

export type OrganizationAdminScopeNavProps = {
  active: OrganizationAdminArea;
  onNavigate: (path: string) => void;
  organizationId?: string;
};

/**
 * Peer top-level destinations for Organization administration.
 * Canonical routes: /organization, /organization/members and /organization/bridges.
 */
export function OrganizationAdminScopeNav({ active, onNavigate, organizationId }: OrganizationAdminScopeNavProps) {
  return (
    <ViewSwitch
      variant="section"
      ariaLabel={ORGANIZATION_ADMIN_UI.scopeNavAria}
      value={active === "invitations" || active === "handovers" ? "members" : active === "bridges" || active === "integrations" ? "resources" : active}
      onValueChange={(value) => onNavigate(`${buildOrganizationAdminPath(value as OrganizationAdminArea)}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`)}
      items={[
        { value: "overview", label: <><Building2 size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.overviewScope}</> },
        { value: "members", label: <><Users size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.membersScope}</> },
        { value: "teams", label: <><UsersRound size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.teamsScope}</> },
        { value: "projects", label: <><FolderKanban size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.projectsScope}</> },
        { value: "resources", label: <><Library size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.resourcesScope}</> },
        { value: "profile", label: <><Settings2 size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.profileScope}</> }
      ]}
    />
  );
}
