import { Building2, Users } from "lucide-react";

import {
  ORGANIZATION_ADMIN_UI,
  buildOrganizationAdminPath,
  type OrganizationAdminArea
} from "@/application/organization/organizationAdminPath";
import { ViewSwitch } from "@/components/ui/view-switch";

export type OrganizationAdminScopeNavProps = {
  active: OrganizationAdminArea;
  onNavigate: (path: string) => void;
};

/**
 * Peer top-level destinations for Organization administration.
 * Canonical routes: /organization (profile) and /organization/members.
 */
export function OrganizationAdminScopeNav({ active, onNavigate }: OrganizationAdminScopeNavProps) {
  return (
    <ViewSwitch
      variant="section"
      ariaLabel={ORGANIZATION_ADMIN_UI.scopeNavAria}
      value={active}
      onValueChange={(value) => onNavigate(buildOrganizationAdminPath(value as OrganizationAdminArea))}
      items={[
        { value: "profile", label: <><Building2 size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.profileScope}</> },
        { value: "members", label: <><Users size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.membersScope}</> }
      ]}
    />
  );
}
