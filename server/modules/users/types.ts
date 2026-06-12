import type { BackendRoleId, RoleBinding } from "../auth/types";

export type UserGovernanceDto = {
  id: string;
  organizationId: string;
  name: string;
  email: string | null;
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

export type RegistrationRoleRequestStatus = "pending" | "approved" | "rejected";

export type RegistrationRoleRequestDto = {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  username: string | null;
  currentRoleId: BackendRoleId;
  requestedRoleId: BackendRoleId;
  status: RegistrationRoleRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
};
