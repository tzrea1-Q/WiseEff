import { Building2, KeyRound, Monitor, Users } from "lucide-react";

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
      value={active}
      onValueChange={(value) => onNavigate(`${buildOrganizationAdminPath(value as OrganizationAdminArea)}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`)}
      items={[
        { value: "profile", label: <><Building2 size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.profileScope}</> },
        { value: "members", label: <><Users size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.membersScope}</> },
        { value: "bridges", label: <><Monitor size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.bridgesScope}</> },
        { value: "integrations", label: <><KeyRound size={16} aria-hidden="true" />{ORGANIZATION_ADMIN_UI.integrationsScope}</> }
      ]}
    />
  );
}
