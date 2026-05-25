import { createApiClient } from "./apiClient";
import { wiseEffApiBaseUrl } from "./runtimeMode";

export type AuthContextDto = {
  user: {
    id: string;
    organizationId: string;
    name: string;
    email: string;
    title: string;
    isActive: boolean;
  };
  organization: {
    id: string;
    name: string;
  };
  roles: Array<{
    projectId: string | null;
    roleId: string;
  }>;
  permissions: string[];
};

export function createAuthClient(apiClient = createApiClient({ baseUrl: wiseEffApiBaseUrl })) {
  return {
    getCurrentAuthContext: () => apiClient.get<AuthContextDto>("/api/v1/me")
  };
}
