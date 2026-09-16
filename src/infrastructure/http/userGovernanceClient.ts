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

export type OrganizationRecordDto = {
  id: string;
  name: string;
  createdAt: string;
};

export type CreateGovernedUserInput = {
  name: string;
  username: string;
  title: string;
  password: string;
  roleId: PlatformRoleId;
  projectId?: string | null;
};

export type ProjectWorkflowRoleId = "hardware-committer" | "software-committer" | "software-user";

export type ProjectWorkflowRoleBindingItem = {
  userId: string;
  name: string;
  username: string | null;
  email: string | null;
  title: string;
  isActive: boolean;
  roles: ProjectWorkflowRoleId[];
};

export type ProjectWorkflowRoleBindingsDto = {
  projectId: string;
  ready: boolean;
  missingRoles: ProjectWorkflowRoleId[];
  bindings: ProjectWorkflowRoleBindingItem[];
};

export type UpdateProjectWorkflowRoleBindingsInput = {
  roles: ProjectWorkflowRoleId[];
  expectedRoles: ProjectWorkflowRoleId[];
};

export type UpdateOrganizationRolesInput = {
  roles: PlatformRoleId[];
  expectedRoles: PlatformRoleId[];
};

export const createDefaultUserGovernanceApiClient = (options: DefaultApiClientOptions = {}) => createDefaultApiClient(options);

function userFromDto(dto: UserGovernanceDto): UserAccount {
  const primaryOrgRole = dto.roles.find((r) => r.projectId === null) ?? dto.roles[0];
  return {
    id: dto.id,
    name: dto.name,
    ...(dto.email ? { email: dto.email } : {}),
    ...(dto.username ? { username: dto.username } : {}),
    title: dto.title,
    roleId: primaryOrgRole?.roleId ?? "guest",
    roles: dto.roles,
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
    async updateOrganizationRoles(userId: string, input: UpdateOrganizationRolesInput) {
      const response = await apiClient.put<ItemEnvelope<UserGovernanceDto>>(
        `/api/v1/users/${encodeURIComponent(userId)}/organization-roles`,
        input
      );
      return userFromDto(response.item);
    },
    async getProjectWorkflowRoleBindings(projectId: string): Promise<ProjectWorkflowRoleBindingsDto> {
      return apiClient.get<ProjectWorkflowRoleBindingsDto>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/workflow-role-bindings`
      );
    },
    async updateProjectWorkflowRoleBindings(
      projectId: string,
      userId: string,
      input: UpdateProjectWorkflowRoleBindingsInput
    ) {
      return apiClient.put<{ item: { projectId: string; userId: string; roles: ProjectWorkflowRoleId[] } }>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/workflow-role-bindings/${encodeURIComponent(userId)}`,
        input
      );
    },
    async setUserActive(userId: string, isActive: boolean) {
      const response = await apiClient.patch<ItemEnvelope<UserGovernanceDto>>(`/api/v1/users/${encodeURIComponent(userId)}/activation`, {
        isActive
      });
      return userFromDto(response.item);
    },
    async deleteUser(userId: string) {
      await apiClient.delete<null>(`/api/v1/users/${encodeURIComponent(userId)}`);
    },
    async resetUserPassword(userId: string, password: string) {
      const response = await apiClient.post<ItemEnvelope<UserGovernanceDto>>(
        `/api/v1/users/${encodeURIComponent(userId)}/password`,
        { password }
      );
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
    },
    async getOrganization() {
      const response = await apiClient.get<{ organization: OrganizationRecordDto }>("/api/v1/organization");
      return response.organization;
    },
    async updateOrganization(input: { name: string }) {
      const response = await apiClient.patch<{ organization: OrganizationRecordDto }>("/api/v1/organization", input);
      return response.organization;
    }
  };
}
