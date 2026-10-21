import type { BackendRoleId, RoleBinding } from "../auth/types";
import type { OidcIdentity } from "../auth/oidcIdentity";

export type UserGovernanceDto = {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
  username: string | null;
  title: string;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  roles: RoleBinding[];
  oidcIdentity?: OidcIdentity;
  legacyOidcEmail?: string;
};

export type CreateUserInput = {
  name: string;
  username: string;
  password: string;
  title?: string;
  roles: Array<{ projectId?: string | null; roleId: BackendRoleId }>;
} | { authentication: "oidc"; name: string; title?: string; issuer: string; subject: string; email?: string; roles: Array<{ projectId?: string | null; roleId: BackendRoleId }> };

export type UpdateUserProfileInput = {
  name?: string;
  email?: string;
  title?: string;
};

export type UpdateUserActiveInput = {
  isActive: boolean;
};

export type ResetUserPasswordInput = {
  password: string;
};

export const projectWorkflowRoleIds = [
  "hardware-committer",
  "software-committer",
  "software-user"
] as const;

export type ProjectWorkflowRoleId = (typeof projectWorkflowRoleIds)[number];

export type UpdateProjectWorkflowRoleBindingsInput = {
  roles: ProjectWorkflowRoleId[];
  expectedRoles: ProjectWorkflowRoleId[];
};

export type UpdateOrganizationRolesInput = {
  roles: BackendRoleId[];
  expectedRoles: BackendRoleId[];
};

export type ProjectWorkflowRoleBindingItem = {
  userId: string;
  userName: string;
  username: string | null;
  isActive: boolean;
  roles: ProjectWorkflowRoleId[];
};

export type ProjectWorkflowRoleBindingsDto = {
  projectId: string;
  ready: boolean;
  missingRoles: ProjectWorkflowRoleId[];
  bindings: ProjectWorkflowRoleBindingItem[];
};

export type ReplaceUserRolesInput = {
  roles: Array<{ projectId?: string | null; roleId: BackendRoleId }>;
};

export type RegistrationRoleRequestStatus = "pending" | "approved" | "rejected";
export type RegistrationRoleRequestListStatus = "pending" | "decided";
export type RegistrationDecisionOutcome = "requested-role-enabled" | "basic-enabled" | "rejected-disabled" | "rejected-preserved";

export type OrganizationDto = {
  id: string;
  name: string;
  createdAt: string;
};

export type UpdateOrganizationInput = {
  name: string;
};

export type RegistrationRoleRequestDto = {
  id: string;
  organizationId: string;
  organizationName: string;
  userId: string;
  userName: string;
  username: string | null;
  currentRoleId: BackendRoleId;
  requestedRoleId: BackendRoleId;
  status: RegistrationRoleRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionOutcome: RegistrationDecisionOutcome | null;
  decisionCanLogin: boolean | null;
  decisionRoleIds: BackendRoleId[] | null;
  accountChanged: boolean;
};
