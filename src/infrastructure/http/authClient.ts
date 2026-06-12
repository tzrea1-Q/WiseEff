import { createDefaultApiClient } from "./defaultApiClient";

export type AuthContextDto = {
  user: {
    id: string;
    organizationId: string;
    name: string;
    email?: string;
    username?: string;
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

export type AuthSessionDto = {
  auth: AuthContextDto;
  token: string;
  expiresAt: string;
};

export type RegisterLocalAccountInput = {
  organization: string;
  name: string;
  username: string;
  roleId: string;
  password: string;
  organizationName?: string;
  title?: string;
};

export type LoginLocalAccountInput = {
  username: string;
  password: string;
};

export type UpdateCurrentUserProfileInput = {
  name?: string;
  title?: string;
};

export const LOCAL_AUTH_TOKEN_STORAGE_KEY = "wiseeff.localAuthToken";

function storageAvailable() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readLocalAuthToken() {
  if (!storageAvailable()) return undefined;
  const token = window.localStorage.getItem(LOCAL_AUTH_TOKEN_STORAGE_KEY);
  return token?.trim() || undefined;
}

export function writeLocalAuthToken(token: string) {
  if (!storageAvailable()) return;
  window.localStorage.setItem(LOCAL_AUTH_TOKEN_STORAGE_KEY, token);
}

export function clearLocalAuthToken() {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(LOCAL_AUTH_TOKEN_STORAGE_KEY);
}

export function createAuthClient(apiClient = createDefaultApiClient()) {
  return {
    getCurrentAuthContext: () => apiClient.get<AuthContextDto>("/api/v1/me"),
    async register(input: RegisterLocalAccountInput) {
      const response = await apiClient.post<AuthSessionDto>("/api/v1/auth/register", input);
      writeLocalAuthToken(response.token);
      return response;
    },
    async login(input: LoginLocalAccountInput) {
      const response = await apiClient.post<AuthSessionDto>("/api/v1/auth/login", input);
      writeLocalAuthToken(response.token);
      return response;
    },
    async logout() {
      try {
        await apiClient.post<{ ok: true }>("/api/v1/auth/logout", {});
      } finally {
        clearLocalAuthToken();
      }
    },
    updateCurrentUserProfile: (input: UpdateCurrentUserProfileInput) => apiClient.patch<AuthContextDto>("/api/v1/me/profile", input)
  };
}
