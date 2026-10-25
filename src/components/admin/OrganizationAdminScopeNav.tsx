import { Building2, FolderKanban, Library, Mail, Settings2, Users, UsersRound, ArrowRightLeft } from "lucide-react";

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
  administrator?: boolean;
};

/**
 * Peer top-level destinations for Organization administration.
 * Canonical routes: /organization, /organization/members and /organization/bridges.
 */
export function OrganizationAdminScopeNav({ active, onNavigate, organizationId, administrator = true }: OrganizationAdminScopeNavProps) {
  const destinations = [
    { value: "overview", label: <><Building2 size={16} aria-hidden="true" />概览</> },
    ...(administrator ? [
      { value: "members", label: <><Users size={16} aria-hidden="true" />成员与权限</> },
      { value: "invitations", label: <><Mail size={16} aria-hidden="true" />邀请</> },
      { value: "teams", label: <><UsersRound size={16} aria-hidden="true" />团队</> },
      { value: "projects", label: <><FolderKanban size={16} aria-hidden="true" />项目参与</> },
      { value: "handovers", label: <><ArrowRightLeft size={16} aria-hidden="true" />业务交接</> }
    ] : []),
    { value: "resources", label: <><Library size={16} aria-hidden="true" />资源</> },
    { value: "profile", label: <><Settings2 size={16} aria-hidden="true" />组织资料</> }
  ];
  return (
    <ViewSwitch
      variant="section"
      ariaLabel={ORGANIZATION_ADMIN_UI.scopeNavAria}
      value={active === "bridges" || active === "integrations" ? "resources" : active}
      onValueChange={(value) => onNavigate(`${buildOrganizationAdminPath(value as OrganizationAdminArea)}${organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : ""}`)}
      items={destinations}
    />
  );
}
