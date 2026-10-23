import type { PlatformRoleId } from "@/domain/users/types";
import { createApiClient } from "./apiClient";
import { resolveWiseEffApiBaseUrl } from "./runtimeMode";
import type { ProjectMemberRoleId } from "./userGovernanceClient";

export type InvitationProjectPreset = { projectId: string; roles: ProjectMemberRoleId[] };
export type OrganizationInvitationDto = { id: string; organizationId: string; label: string; roles: PlatformRoleId[]; status: "pending" | "expired" | "revoked" | "accepted"; expiresAt: string; createdAt: string; acceptedUserId: string | null;
  teams: Array<{ id: string; name: string }>; projects: Array<InvitationProjectPreset & { name: string }> };
export type InvitationInput = { label: string; roles: PlatformRoleId[]; expiresInDays: number; teamIds?: string[]; projects?: InvitationProjectPreset[] };
export type OrganizationInvitationsClient = {
  getAuthenticationConfig(): Promise<{ provider: string }>;
  listInvitations(): Promise<OrganizationInvitationDto[]>;
  listTeams(): Promise<Array<{ id: string; name: string }>>;
  listProjectCandidates(): Promise<Array<{ id: string; name: string }>>;
  issueInvitation(input: InvitationInput, id?: string): Promise<{ item: OrganizationInvitationDto; token: string }>;
  revokeInvitation(id: string): Promise<OrganizationInvitationDto>;
};

/** Public invitation links carry the token in a fragment; API paths and access logs stay token-free. */
export function createPublicInvitationClient() {
  const api = createApiClient({ baseUrl: resolveWiseEffApiBaseUrl() });
  return {
    async preview(token: string) { return (await api.post<{ item: OrganizationInvitationDto & { organizationName: string } }>("/api/v1/auth/invitations/preview", { token })).item; },
    accept(token: string, input: { name: string; username: string; password: string }) { return api.post<{ userId: string; organizationId: string }>("/api/v1/auth/invitations/accept", { token, ...input }); }
  };
}
