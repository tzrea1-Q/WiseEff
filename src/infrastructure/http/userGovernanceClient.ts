import { pickPrimaryPlatformRoleId, type PlatformRoleId, type UserAccount } from "@/domain/users/types";
import { createApiClient } from "./apiClient";
import { createDefaultApiClient, type DefaultApiClientOptions } from "./defaultApiClient";
import type { LocalAuthPublicConfigDto } from "./authClient";
import type { AuthContextDto } from "./authClient";
import { withOrganizationScope } from "./organizationScope";
import type { InvitationInput, OrganizationInvitationDto } from "./organizationInvitationsClient";

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
  oidcIdentity?: { issuer: string; subject: string };
  legacyOidcEmail?: string;
};

export type RegistrationRoleRequestDto = {
  id: string;
  organizationId: string;
  organizationName?: string;
  userId: string;
  userName: string;
  username: string | null;
  currentRoleId: PlatformRoleId;
  requestedRoleId: PlatformRoleId;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decidedByUserId: string | null;
  decisionOutcome?: "requested-role-enabled" | "basic-enabled" | "rejected-disabled" | "rejected-preserved" | null;
  decisionCanLogin?: boolean | null;
  decisionRoleIds?: PlatformRoleId[] | null;
  accountChanged?: boolean;
};

type ItemsEnvelope<T> = { items: T[] };
type ItemEnvelope<T> = { item: T };

export type OrganizationRecordDto = {
  id: string;
  name: string;
  createdAt: string;
};
export type OrganizationTeamDto = { id: string; organizationId: string; name: string; memberIds: string[] };
export type OrganizationTeamsClient = Pick<ReturnType<typeof createUserGovernanceClient>, "listTeams" | "createTeam" | "renameTeam" | "replaceTeamMembers" | "deleteTeam" | "listUsers">;

export type CreateGovernedUserInput = {
  name: string;
  username: string;
  title: string;
  password: string;
  roleId: PlatformRoleId;
  projectId?: string | null;
} | { authentication: "oidc"; name: string; title: string; issuer: string; subject: string; email?: string; roleId: PlatformRoleId };

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
  const organizationRoles = dto.roles.filter((role) => role.projectId === null);
  return {
    id: dto.id,
    ...(dto.oidcIdentity ? { oidcIdentity: dto.oidcIdentity } : {}),
    ...(dto.legacyOidcEmail ? { legacyOidcEmail: dto.legacyOidcEmail } : {}),
    name: dto.name,
    ...(dto.email ? { email: dto.email } : {}),
    ...(dto.username ? { username: dto.username } : {}),
    title: dto.title,
    roleId: pickPrimaryPlatformRoleId(organizationRoles.map((role) => role.roleId)),
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
  apiClient: ApiClient = createDefaultUserGovernanceApiClient(),
  organizationId?: string
) {
  const scoped = (path: string) => withOrganizationScope(path, organizationId);
  return {
    async listInvitations() { return (await apiClient.get<ItemsEnvelope<OrganizationInvitationDto>>(scoped("/api/v1/organization/invitations"))).items; },
    async issueInvitation(input: InvitationInput, id?: string) { return apiClient.post<{ item: OrganizationInvitationDto; token: string }>(scoped(id ? `/api/v1/organization/invitations/${encodeURIComponent(id)}/regenerate` : "/api/v1/organization/invitations"), input); },
    async revokeInvitation(id: string) { return (await apiClient.post<ItemEnvelope<OrganizationInvitationDto>>(scoped(`/api/v1/organization/invitations/${encodeURIComponent(id)}/revoke`), {})).item; },
    async listTeams() {
      return (await apiClient.get<ItemsEnvelope<OrganizationTeamDto>>(scoped("/api/v1/organization/teams"))).items;
    },
    async createTeam(name: string) {
      return (await apiClient.post<ItemEnvelope<OrganizationTeamDto>>(scoped("/api/v1/organization/teams"), { name })).item;
    },
    async renameTeam(id: string, name: string) {
      return (await apiClient.patch<ItemEnvelope<OrganizationTeamDto>>(scoped(`/api/v1/organization/teams/${encodeURIComponent(id)}`), { name })).item;
    },
    async replaceTeamMembers(id: string, userIds: string[]) {
      return (await apiClient.put<ItemEnvelope<OrganizationTeamDto>>(scoped(`/api/v1/organization/teams/${encodeURIComponent(id)}/members`), { userIds })).item;
    },
    async deleteTeam(id: string) {
      await apiClient.delete<null>(scoped(`/api/v1/organization/teams/${encodeURIComponent(id)}`));
    },
    enterOperatingContext: () => apiClient.post<{ actor: AuthContextDto; organization: { id: string; name: string } }>("/api/v1/organization/operating-scope", { organizationId }),
    async listProjectCandidates() {
      return (await apiClient.get<ItemsEnvelope<{ id: string; name: string }>>(scoped("/api/v1/organization/project-candidates"))).items;
    },
    async listUsers() {
      const response = await apiClient.get<ItemsEnvelope<UserGovernanceDto>>(scoped("/api/v1/users"));
      return response.items.map(userFromDto);
    },
    async createUser(input: CreateGovernedUserInput) {
      const response = await apiClient.post<ItemEnvelope<UserGovernanceDto>>(scoped("/api/v1/users"), {
        ...("authentication" in input ? { authentication: input.authentication, issuer: input.issuer, subject: input.subject, ...(input.email ? { email: input.email } : {}),name: input.name,title: input.title }
          : { name: input.name,username: input.username,title: input.title,password: input.password }),
        roles: [{ projectId: "projectId" in input ? input.projectId ?? null : null, roleId: input.roleId }]
      });
      return userFromDto(response.item);
    },
    getAuthenticationConfig: () => apiClient.get<LocalAuthPublicConfigDto>("/api/v1/auth/local-config"),
    async setOidcIdentity(userId: string, input: { issuer: string; subject: string; email?: string; expectedIdentity: { issuer: string; subject: string } | null }) {
      const response = await apiClient.put<ItemEnvelope<UserGovernanceDto>>(scoped(`/api/v1/users/${encodeURIComponent(userId)}/oidc-identity`),input);
      return userFromDto(response.item);
    },
    async assignUserRole(userId: string, roleId: PlatformRoleId, projectId: string | null = null) {
      const response = await apiClient.put<ItemEnvelope<UserGovernanceDto>>(
        scoped(`/api/v1/users/${encodeURIComponent(userId)}/roles`),
        roleBody(roleId, projectId)
      );
      return userFromDto(response.item);
    },
    async updateOrganizationRoles(userId: string, input: UpdateOrganizationRolesInput) {
      const response = await apiClient.put<ItemEnvelope<UserGovernanceDto>>(
        scoped(`/api/v1/users/${encodeURIComponent(userId)}/organization-roles`),
        input
      );
      return userFromDto(response.item);
    },
    async getProjectWorkflowRoleBindings(projectId: string): Promise<ProjectWorkflowRoleBindingsDto> {
      const response = await apiClient.get<Omit<ProjectWorkflowRoleBindingsDto, "bindings"> & {
        bindings: Array<Omit<ProjectWorkflowRoleBindingItem, "name" | "email" | "title"> & { userName: string }>;
      }>(
        scoped(`/api/v1/projects/${encodeURIComponent(projectId)}/workflow-role-bindings`)
      );
      return { ...response, bindings: response.bindings.map((binding) => ({ ...binding, name: binding.userName, email: null, title: "" })) };
    },
    async updateProjectWorkflowRoleBindings(
      projectId: string,
      userId: string,
      input: UpdateProjectWorkflowRoleBindingsInput
    ) {
      return apiClient.put<{ item: { projectId: string; userId: string; roles: ProjectWorkflowRoleId[] } }>(
        scoped(`/api/v1/projects/${encodeURIComponent(projectId)}/workflow-role-bindings/${encodeURIComponent(userId)}`),
        input
      );
    },
    async setUserActive(userId: string, isActive: boolean) {
      const response = await apiClient.patch<ItemEnvelope<UserGovernanceDto>>(scoped(`/api/v1/users/${encodeURIComponent(userId)}/activation`), {
        isActive
      });
      return userFromDto(response.item);
    },
    async updateUserProfile(userId: string, input: { name: string; title: string }) {
      const response = await apiClient.patch<ItemEnvelope<UserGovernanceDto>>(scoped(`/api/v1/users/${encodeURIComponent(userId)}`), input);
      return userFromDto(response.item);
    },
    async deleteUser(userId: string) {
      await apiClient.delete<null>(scoped(`/api/v1/users/${encodeURIComponent(userId)}`));
    },
    async resetUserPassword(userId: string, password: string) {
      const response = await apiClient.post<ItemEnvelope<UserGovernanceDto>>(
        scoped(`/api/v1/users/${encodeURIComponent(userId)}/password`),
        { password }
      );
      return userFromDto(response.item);
    },
    async listRegistrationRoleRequests(status: "pending" | "decided" = "pending") {
      const response = await apiClient.get<ItemsEnvelope<RegistrationRoleRequestDto>>(scoped(`/api/v1/users/registration-role-requests${status === "decided" ? "?status=decided" : ""}`));
      return response.items;
    },
    async approveRegistrationRoleRequest(requestId: string) {
      const response = await apiClient.post<ItemEnvelope<RegistrationRoleRequestDto>>(
        scoped(`/api/v1/users/registration-role-requests/${encodeURIComponent(requestId)}/approve`),
        {}
      );
      return response.item;
    },
    async rejectRegistrationRoleRequest(requestId: string) {
      const response = await apiClient.post<ItemEnvelope<RegistrationRoleRequestDto>>(
        scoped(`/api/v1/users/registration-role-requests/${encodeURIComponent(requestId)}/reject`),
        {}
      );
      return response.item;
    },
    async enableBasicRegistrationRoleRequest(requestId: string) {
      return (await apiClient.post<ItemEnvelope<RegistrationRoleRequestDto>>(scoped(`/api/v1/users/registration-role-requests/${encodeURIComponent(requestId)}/enable-basic`), {})).item;
    },
    async getOrganization() {
      const response = await apiClient.get<{ organization: OrganizationRecordDto }>(scoped("/api/v1/organization"));
      return response.organization;
    },
    async updateOrganization(input: { name: string }) {
      const response = await apiClient.patch<{ organization: OrganizationRecordDto }>(scoped("/api/v1/organization"), input);
      return response.organization;
    }
  };
}

export function createOrganizationWorkspaceClient(api = createDefaultUserGovernanceApiClient()) {
  return {
    async enterOperatingContext(organizationId?: string) {
      if (organizationId !== undefined) return createUserGovernanceClient(api, organizationId).enterOperatingContext();
      const actor = await api.get<AuthContextDto>("/api/v1/me");
      return { actor, organization: actor.organization };
    },
    forOrganization: (organizationId: string) => createUserGovernanceClient(api, organizationId)
  };
}
export type OrganizationWorkspaceClient = ReturnType<typeof createOrganizationWorkspaceClient>;
