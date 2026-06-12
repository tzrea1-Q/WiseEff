import type { PlatformRoleId, UserAccount } from "@/domain/users/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient, type DefaultApiClientOptions } from "./defaultApiClient";

type ApiClient = ReturnType<typeof createApiClient>;

type RoleBindingDto = {
  projectId: string | null;
  roleId: PlatformRoleId;
};

type UserGovernanceDto = {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  title: string;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  roles: RoleBindingDto[];
};

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };
const workflowRolePriority: PlatformRoleId[] = [
  "hardware-committer",
  "software-committer",
  "software-user",
  "hardware-user",
  "admin",
  "guest"
];

export type CreateGovernedUserInput = {
  name: string;
  email: string;
  title: string;
  roleId: PlatformRoleId;
  projectId?: string | null;
};

export const createDefaultUserGovernanceApiClient = (options: DefaultApiClientOptions = {}) => createDefaultApiClient(options);

function userFromDto(dto: UserGovernanceDto): UserAccount {
  const primaryRole = choosePrimaryRole(dto.roles);
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    title: dto.title,
    roleId: primaryRole?.roleId ?? "guest",
    isActive: dto.isActive,
    createdAt: dto.createdAt,
    lastActive: dto.lastActiveAt ?? "never"
  };
}

function choosePrimaryRole(roles: RoleBindingDto[]) {
  return [...roles].sort((left, right) => {
    const leftProjectPriority = left.projectId ? 0 : 1;
    const rightProjectPriority = right.projectId ? 0 : 1;
    if (leftProjectPriority !== rightProjectPriority) {
      return leftProjectPriority - rightProjectPriority;
    }

    return workflowRolePriority.indexOf(left.roleId) - workflowRolePriority.indexOf(right.roleId);
  })[0];
}

function roleBody(roleId: PlatformRoleId, projectId: string | null = null) {
  return {
    roles: [{ projectId, roleId }]
  };
}

export function createUserGovernanceClient(
  apiClient: ApiClient = createDefaultUserGovernanceApiClient()
) {
  return {
    async listUsers() {
      const response = await apiClient.get<ItemsEnvelope<UserGovernanceDto>>("/api/v1/users");
      return response.items.map(userFromDto);
    },
    async createUser(input: CreateGovernedUserInput) {
      const response = await apiClient.post<ItemEnvelope<UserGovernanceDto>>("/api/v1/users", {
        name: input.name,
        email: input.email,
        title: input.title,
        roles: [{ projectId: input.projectId ?? null, roleId: input.roleId }]
      });
      return userFromDto(response.item);
    },
    async assignUserRole(userId: string, roleId: PlatformRoleId, projectId: string | null = null) {
      const response = await apiClient.put<ItemEnvelope<UserGovernanceDto>>(
        `/api/v1/users/${encodeURIComponent(userId)}/roles`,
        roleBody(roleId, projectId)
      );
      return userFromDto(response.item);
    },
    async setUserActive(userId: string, isActive: boolean) {
      const response = await apiClient.patch<ItemEnvelope<UserGovernanceDto>>(`/api/v1/users/${encodeURIComponent(userId)}/activation`, {
        isActive
      });
      return userFromDto(response.item);
    }
  };
}
