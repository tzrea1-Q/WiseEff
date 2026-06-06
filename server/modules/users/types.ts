import type { BackendRoleId, RoleBinding } from "../auth/types";

export type UserGovernanceDto = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  roles: RoleBinding[];
};

export type CreateUserInput = {
  name: string;
  email: string;
  title?: string;
  roles: Array<{ projectId?: string | null; roleId: BackendRoleId }>;
};

export type UpdateUserProfileInput = {
  name?: string;
  email?: string;
  title?: string;
};

export type UpdateUserActiveInput = {
  isActive: boolean;
};

export type ReplaceUserRolesInput = {
  roles: Array<{ projectId?: string | null; roleId: BackendRoleId }>;
};
