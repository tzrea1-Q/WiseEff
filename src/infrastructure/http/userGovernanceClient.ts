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
  email: string | null;
  username?: string | null;
  title: string;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  roles: RoleBindingDto[];
};

export type RegistrationRoleRequestDto = {
  id: string;
  organizationId: string;
  userId: string;
  userName: string;
  username: string | null;
  currentRoleId: PlatformRoleId;
  requestedRoleId: PlatformRoleId;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
};

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

export type CreateGovernedUserInput = {
  name: string;
  username: string;
  title: string;
  password: string;
  roleId: PlatformRoleId;
  projectId?: string | null;
};

export const createDefaultUserGovernanceApiClient = (options: DefaultApiClientOptions = {}) => createDefaultApiClient(options);

function userFromDto(dto: UserGovernanceDto): UserAccount {
  const primaryRole = dto.roles[0];
  return {
    id: dto.id,
    name: dto.name,
    ...(dto.email ? { email: dto.email } : {}),
    ...(dto.username ? { username: dto.username } : {}),
    title: dto.title,
    roleId: primaryRole?.roleId ?? "guest",
    isActive: dto.isActive,
    createdAt: dto.createdAt,
    lastActive: dto.lastActiveAt ?? "never"
  };
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
        username: input.username,
        title: input.title,
        password: input.password,
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
    },
    async listRegistrationRoleRequests() {
      const response = await apiClient.get<ItemsEnvelope<RegistrationRoleRequestDto>>("/api/v1/users/registration-role-requests");
      return response.items;
    },
    async approveRegistrationRoleRequest(requestId: string) {
      const response = await apiClient.post<ItemEnvelope<RegistrationRoleRequestDto>>(
        `/api/v1/users/registration-role-requests/${encodeURIComponent(requestId)}/approve`,
        {}
      );
      return response.item;
    },
    async rejectRegistrationRoleRequest(requestId: string) {
      const response = await apiClient.post<ItemEnvelope<RegistrationRoleRequestDto>>(
        `/api/v1/users/registration-role-requests/${encodeURIComponent(requestId)}/reject`,
        {}
      );
      return response.item;
    }
  };
}
