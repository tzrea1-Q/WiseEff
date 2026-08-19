import { Building2, Users } from "lucide-react";

import {
  ORGANIZATION_ADMIN_UI,
  buildOrganizationAdminPath,
  type OrganizationAdminArea
} from "@/application/organization/organizationAdminPath";

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
    <nav className="parameter-admin-scope-nav" aria-label={ORGANIZATION_ADMIN_UI.scopeNavAria}>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "profile" ? " is-active" : ""}`}
        aria-current={active === "profile" ? "page" : undefined}
        onClick={() => onNavigate(buildOrganizationAdminPath("profile"))}
      >
        <Building2 size={16} aria-hidden="true" />
        {ORGANIZATION_ADMIN_UI.profileScope}
      </button>
      <button
        type="button"
        className={`parameter-admin-scope-nav__tab${active === "members" ? " is-active" : ""}`}
        aria-current={active === "members" ? "page" : undefined}
        onClick={() => onNavigate(buildOrganizationAdminPath("members"))}
      >
        <Users size={16} aria-hidden="true" />
        {ORGANIZATION_ADMIN_UI.membersScope}
      </button>
    </nav>
  );
}
